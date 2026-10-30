// ARACHNE straight over USB: the servo adapter plugged into the tablet (or laptop), no Pi and no server.
// Links: the app's native UsbSerial plugin, Web Serial (Chrome desktop/Android) or WebUSB (CDC-ACM by hand).
// Poses and the dance come precomputed from tools/usb_plan.py (web/usb_plan.json), the same maths as stand.py / dance.py.
'use strict';

const BAUD = 1000000;
const A = {TORQUE: 40, ACC: 41, GOAL: 42, LIMIT: 48, POS: 56, VOLT: 62};
const LOW_V = 10.2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- links: all offer open() and xfer(bytes, nRead, ms) -> Uint8Array (nRead bytes or fewer on timeout) ----------
class StreamLink {          // Web Serial and WebUSB both deliver a byte stream: keep a buffer, wait on it
  constructor() { this.buf = []; this.wake = null; }
  push(u8) { for (const b of u8) this.buf.push(b); if (this.wake) this.wake(); }
  async xfer(bytes, n, ms) {
    this.buf = []; await this.write(bytes);
    const t0 = performance.now();
    while (this.buf.length < n && performance.now() - t0 < ms)
      await new Promise(r => { this.wake = r; setTimeout(r, Math.max(1, ms - (performance.now() - t0))); });
    this.wake = null; return Uint8Array.from(this.buf.splice(0, this.buf.length));
  }
}

class WebSerialLink extends StreamLink {
  name = 'Web Serial';
  async open() {
    this.port = await navigator.serial.requestPort();
    await this.port.open({baudRate: BAUD, bufferSize: 4096});
    this.writer = this.port.writable.getWriter();
    (async () => {
      while (this.port.readable) {
        const rd = this.port.readable.getReader();
        try { for (;;) { const {value, done} = await rd.read(); if (done) break; this.push(value); } }
        catch (e) { } finally { rd.releaseLock(); }
        if (this.closed) break;
      }
      this.onlost && this.onlost();
    })();
  }
  write(b) { return this.writer.write(b); }
}

class WebUsbLink extends StreamLink {
  name = 'WebUSB';
  async open() {
    const d = this.dev = await navigator.usb.requestDevice({filters: [{vendorId: 0x1a86}, {classCode: 2}, {classCode: 10}]});
    await d.open(); if (!d.configuration) await d.selectConfiguration(1);
    const ifs = d.configuration.interfaces;
    const data = ifs.find(i => i.alternate.interfaceClass === 10) || ifs.find(i => i.alternate.endpoints.length >= 2);
    const ctrl = ifs.find(i => i.alternate.interfaceClass === 2);
    if (!data) throw new Error('geen seriële interface op dit USB-apparaat');
    if (ctrl) await d.claimInterface(ctrl.interfaceNumber);
    await d.claimInterface(data.interfaceNumber);
    this.in = data.alternate.endpoints.find(e => e.direction === 'in' && e.type === 'bulk').endpointNumber;
    this.out = data.alternate.endpoints.find(e => e.direction === 'out' && e.type === 'bulk').endpointNumber;
    const idx = ctrl ? ctrl.interfaceNumber : data.interfaceNumber;
    const lc = new Uint8Array([BAUD & 255, BAUD >> 8 & 255, BAUD >> 16 & 255, BAUD >> 24 & 255, 0, 0, 8]);   // SET_LINE_CODING 8N1
    await d.controlTransferOut({requestType: 'class', recipient: 'interface', request: 0x20, value: 0, index: idx}, lc);
    await d.controlTransferOut({requestType: 'class', recipient: 'interface', request: 0x22, value: 3, index: idx});   // DTR+RTS
    (async () => {
      try { for (;;) { const r = await d.transferIn(this.in, 512); if (r.data && r.data.byteLength) this.push(new Uint8Array(r.data.buffer)); } }
      catch (e) { this.onlost && this.onlost(); }
    })();
  }
  write(b) { return this.dev.transferOut(this.out, b); }
}

class NativeLink {           // Android app: be.arachne.spin UsbSerialPlugin (write + read in one native call)
  name = 'USB (app)';
  get P() { return window.Capacitor.Plugins.UsbSerial; }
  async open() { await this.P.open({baud: BAUD}); }
  async xfer(bytes, n, ms) {
    const r = await this.P.xfer({data: btoa(String.fromCharCode(...bytes)), read: n, timeout: ms});
    return Uint8Array.from(atob(r.data || ''), c => c.charCodeAt(0));
  }
}

function pickLink() {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) return new NativeLink();
  if (navigator.serial) return new WebSerialLink();
  if (navigator.usb) return new WebUsbLink();
  return null;
}

// ---------- Feetech STS3215 protocol ----------
class Bus {
  constructor(link) { this.link = link; this.q = Promise.resolve(); }
  locked(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => {}); return p; }   // one packet on the bus at a time
  static pkt(id, instr, params = []) {
    const body = [id, params.length + 2, instr, ...params];
    return Uint8Array.from([0xff, 0xff, ...body, ~body.reduce((a, b) => a + b, 0) & 255]);
  }
  static parse(r, n) {
    for (let i = 0; i + 6 + n <= r.length; i++) {
      if (r[i] !== 0xff || r[i + 1] !== 0xff) continue;
      const p = r.slice(i, i + 6 + n);
      if ((~p.slice(2, -1).reduce((a, b) => a + b, 0) & 255) === p[p.length - 1]) return p.slice(5, 5 + n);
    }
    return null;
  }
  read(id, addr, n) { return this.locked(async () => Bus.parse(await this.link.xfer(Bus.pkt(id, 2, [addr, n]), 6 + n, 40), n)); }
  write(id, addr, data) { return this.locked(async () => Bus.parse(await this.link.xfer(Bus.pkt(id, 3, [addr, ...data]), 6, 30), 0) !== null); }
  sync(addr, perId) {            // {id: [bytes]} of equal length, no replies
    const n = Object.values(perId)[0].length, params = [addr, n];
    for (const [id, d] of Object.entries(perId)) params.push(+id, ...d);
    return this.locked(() => this.link.xfer(Bus.pkt(0xfe, 0x83, params), 0, 0));
  }
  async read16(id, addr) { const r = await this.read(id, addr, 2); return r ? (r[0] | r[1] << 8) : null; }
}

// ---------- the robot ----------
class Robot {
  constructor(plan, onState) {
    this.p = plan; this.onState = onState;
    this.found = []; this.volt = null; this.temp = null; this.torque = null;
    this.ticks = plan.lie.slice(); this.temps = plan.sid.map(() => null); this.onPose = null;   // for the hologram
    this.loads = plan.sid.map(() => null); this.volts = plan.sid.map(() => null);                // for the specs panel
    this.gait = null; this.gk = 0; this.want = null; this.level = 'normaal';                   // walking: cycle + frame
    this.onBeat = null; this.puppetOn = false; this.puppetGoal = null;
    this.pose = 'onbekend'; this.action = null; this.stopReq = false; this.link = null;
  }
  emit(msg) { this.onState(this, msg); }
  goal(t, speed = 0) { return [t & 255, t >> 8, 0, 0, speed & 255, speed >> 8]; }
  clamp(i, t) { return Math.max(this.p.min[i], Math.min(this.p.max[i], Math.round(t))); }

  async connect() {
    const link = pickLink();
    if (!link) throw new Error('deze browser kan geen USB: open de ARACHNE-app of Chrome');
    await link.open(); this.link = link; this.bus = new Bus(link);
    link.onlost = () => { this.found = []; this.emit('USB-verbinding weg'); };
    await this.scan(); return link.name;
  }
  async scan() {
    this.found = [];
    for (const id of this.p.sid) if (await this.bus.read(id, A.TORQUE, 1)) this.found.push(id);
    await this.health(); this.emit(`${this.found.length}/18 servo's gevonden`);
  }
  async readPos() {               // present position of every servo (the hologram follows the real robot)
    for (let i = 0; i < this.p.sid.length; i++) {
      if (!this.found.includes(this.p.sid[i])) continue;
      const t = await this.bus.read16(this.p.sid[i], A.POS); if (t !== null) this.ticks[i] = t;
    }
    this.onPose && this.onPose();
  }
  async health() {                 // per servo in one read (56..63: position, speed, load, voltage, temperature) + torque
    let v = 99, t = 0, on = 0;
    for (const id of this.found) {
      const r = await this.bus.read(id, A.POS, 8), i = this.p.sid.indexOf(id);
      if (r) {
        this.ticks[i] = r[0] | r[1] << 8; this.loads[i] = ((r[4] | r[5] << 8) & 0x3ff) / 10;   // load: bit 10 = direction
        this.volts[i] = r[6] / 10; this.temps[i] = r[7]; v = Math.min(v, r[6] / 10); t = Math.max(t, r[7]);
      }
      const q = await this.bus.read(id, A.TORQUE, 1); if (q && q[0]) on++;
    }
    this.volt = v < 99 ? v : null; this.temp = t || null; this.torque = on;
  }
  need18() { if (this.found.length < 18) throw new Error(`maar ${this.found.length}/18 servo's: controleer kabels en 12 V`); }

  async run(name, fn) {
    if (this.action) return this.emit(`bezig met ${this.action}`);
    this.action = name; this.stopReq = false; this.emit(name + '…');
    try { if (name !== 'lopen' && name !== 'zoeken') await this.settle(); await fn(); } catch (e) { this.emit('fout: ' + e.message); }
    this.action = null; await this.health().catch(() => {}); this.emit();
  }

  // same as stand.py: torque on one servo at a time at 30 %, ramp 50/75/100 %, then one goal each so all arrive together
  async moveTo(target, sec) {
    this.need18();
    const ids = this.p.sid, now = [];
    for (const id of ids) now.push(await this.bus.read16(id, A.POS));
    if (now.some(x => x === null)) throw new Error('niet alle servo\'s antwoorden');
    let wasOff = false;
    for (let i = 0; i < ids.length; i++) {
      const on = await this.bus.read(ids[i], A.TORQUE, 1);
      if (on && on[0]) continue;
      wasOff = true;
      await this.bus.write(ids[i], A.LIMIT, [0x2c, 1]); await this.bus.write(ids[i], A.GOAL, this.goal(now[i]));
      await this.bus.write(ids[i], A.TORQUE, [1]); await sleep(100);
    }
    if (wasOff) for (const lim of [500, 750, 1000]) { for (const id of ids) await this.bus.write(id, A.LIMIT, [lim & 255, lim >> 8]); await sleep(150); }
    for (let i = 0; i < ids.length; i++) {
      const t = this.clamp(i, target[i]), sp = Math.max(50, Math.min(3400, Math.round(Math.abs(t - now[i]) / sec * 1.15)));
      await this.bus.write(ids[i], A.ACC, [40]); await this.bus.write(ids[i], A.GOAL, this.goal(t, sp));
    }
    const t0 = performance.now(); let k = 0;
    while (performance.now() - t0 < (sec + 1) * 1000) {
      await this.readPos();
      if (k++ % 4 === 0) { const r = await this.bus.read(ids[(k / 4 | 0) % ids.length], A.VOLT, 1); if (r) { this.volt = r[0] / 10; this.emit(); } }
      await sleep(30);
    }
  }
  stand(sec = 4) { return this.run('opstaan', async () => { await this.moveTo(this.p.stand, sec); this.pose = 'staat'; }); }
  setLevel(l) { this.level = l; this.emit(`snelheid ${l}`); }
  lie(sec = 4) { return this.run('liggen', async () => { await this.moveTo(this.p.lie, sec); this.pose = 'ligt'; }); }
  rest() {
    return this.run('rusten', async () => {
      if (this.pose !== 'ligt') { await this.moveTo(this.p.lie, 4); this.pose = 'ligt'; }
      const off = {}; for (const id of this.p.sid) off[id] = [0];
      await this.bus.sync(A.TORQUE, off);
    });
  }
  async play(frames, hz, check) {
    const ids = this.p.sid, t0 = performance.now();
    for (let k = 0; k < frames.length; k++) {
      const d = {}; frames[k].forEach((t, i) => d[ids[i]] = this.goal(this.clamp(i, t)));
      await this.bus.sync(A.GOAL, d);
      this.ticks = frames[k].slice(); this.onPose && this.onPose();
      if (check && await check(k)) return false;
      const dt = t0 + (k + 1) * 1000 / hz - performance.now(); if (dt > 0) await sleep(dt);
    }
    return true;
  }
  dance() {
    if (this.action === 'dansen') { this.stopReq = true; return this.emit('dans stopt na deze ronde…'); }
    return this.run('dansen', async () => {
      await this.needStand();
      const D = this.p.dance, ids = this.p.sid; let n = 0, low = false;
      const check = async k => {      // every second: one servo's voltage (too low -> stop at once); a stop waits for the end of the circle
        if (++n % D.hz === 0) {
          const r = await this.bus.read(ids[(n / D.hz) % ids.length], A.VOLT, 2);
          if (r) { this.volt = r[0] / 10; this.temp = Math.max(this.temp || 0, r[1]); this.emit(); }
          if (r && r[0] / 10 < LOW_V) { low = true; return true; }
        }
        return this.stopReq && k === D.loop.length - 1;
      };
      await this.play(D.in, D.hz);
      while (!this.stopReq && !low) await this.play(D.loop, D.hz, check);
      if (low) { await this.moveTo(this.p.stand, 1.5); this.emit(`spanning te laag (${this.volt} V): gestopt`); return; }
      await this.play(D.out, D.hz);
    });
  }
  sixSevenLoop() {    // 6-7 until Stop: lean + lift once, bob in a seamless 17-frame loop, a stop finishes the swing and lowers
    if (this.action === '6-7 ∞') { this.stopReq = true; return this.emit('6-7 stopt na deze zwaai…'); }
    return this.run('6-7 ∞', async () => {
      await this.needStand();
      const S = this.p.sixseven_loop, ids = this.p.sid; let n = 0, low = false;
      const check = async k => {
        if (++n % S.hz === 0) {
          const r = await this.bus.read(ids[(n / S.hz) % ids.length], A.VOLT, 2);
          if (r) { this.volt = r[0] / 10; this.temp = Math.max(this.temp || 0, r[1]); this.emit(); if (r[0] / 10 < LOW_V) { low = true; return true; } }
        }
        return this.stopReq && k === S.loop.length - 1;
      };
      await this.play(S.in, S.hz);
      while (!this.stopReq && !low) await this.play(S.loop, S.hz, check);
      if (low) { await this.moveTo(this.p.stand, 1.5); this.emit(`spanning te laag (${this.volt} V): terug recht`); return; }
      await this.play(S.out, S.hz);
    });
  }
  sixSeven() { return this.arms('6-7', this.p.sixseven); }     // lean back, front legs up like hands, bob them in turn
  clap() { return this.arms('klappen', this.p.clap); }         // same lean, hands swing together in front (14 cm apart, never touching)
  arms(name, S) {     // tools/six_seven.py moves; stop or low voltage = glide back to standing
    return this.run(name, async () => {
      await this.needStand();
      const ids = this.p.sid; let n = 0, low = false;
      const done = await this.play(S.frames, S.hz, async k => {
        if (S.beats && S.beats.includes(k) && this.onBeat) this.onBeat();
        if (++n % S.hz === 0) {
          const r = await this.bus.read(ids[(n / S.hz) % ids.length], A.VOLT, 2);
          if (r) { this.volt = r[0] / 10; this.emit(); if (r[0] / 10 < LOW_V) low = true; }
        }
        return low || this.stopReq;
      });
      if (!done) { await this.moveTo(this.p.stand, 1.5); this.emit(low ? `spanning te laag (${this.volt} V): terug recht` : 'gestopt, terug recht'); }
    });
  }
  async settle() {    // feet back home: a walk that stopped half-way (feet down, not home) first finishes its cycle
    if (!this.gait || !this.gk) return;
    const g = this.p.gaits[this.gait];
    await this.play(g.frames.slice(this.gk), g.hz); this.gk = 0;
  }
  async needStand() { if (this.pose !== 'staat') { await this.moveTo(this.p.stand, 4); this.pose = 'staat'; } }

  // walk while a button is held (drive(name)), drive(null) stops at the next moment all six feet are down (<= 1/3 cycle);
  // the same direction again resumes from there, another direction first finishes the cycle (gamepad_robot.py rules)
  drive(name) {
    this.want = name ? `${this.level}/${name}` : null;
    if (name && !this.action) this.run('lopen', () => this.walkLoop());
  }
  async walkLoop() {
    await this.needStand();
    const ids = this.p.sid; let n = 0;
    for (;;) {
      const want = this.stopReq ? null : this.want;
      if (want !== this.gait && this.gk === 0) { if (!want) break; this.gait = want; }
      const g = this.p.gaits[this.gait], third = g.frames.length / 3;
      if (!want && this.gk % third === 0) break;                    // stopped with all feet down
      const t0 = performance.now(), fr = g.frames[this.gk], d = {};
      fr.forEach((t, i) => d[ids[i]] = this.goal(this.clamp(i, t)));
      await this.bus.sync(A.GOAL, d); this.ticks = fr.slice(); this.onPose && this.onPose();
      this.gk = (this.gk + 1) % g.frames.length;
      if (++n % g.hz === 0) {
        const r = await this.bus.read(ids[(n / g.hz) % ids.length], A.VOLT, 1);
        if (r) { this.volt = r[0] / 10; this.emit(); if (this.volt < LOW_V) { this.want = null; this.emit(`spanning te laag (${this.volt} V)`); } }
      }
      const dt = t0 + 1000 / g.hz - performance.now(); if (dt > 0) await sleep(dt);
    }
  }
  wave() {            // surprise: tap the hologram and the spin waves back (tools/wave.py: L1, 3 times)
    return this.run('zwaaien', async () => {
      await this.needStand();
      const W = this.p.wave;
      if (!await this.play(W.frames, W.hz, async () => this.stopReq)) await this.moveTo(this.p.stand, 1.5);
    });
  }
  jump() {            // tools/jump.py: from lying, all 18 at full speed into a pose past standing, then settle into standing
    return this.run('springen', async () => {
      if (this.pose !== 'ligt') { await this.moveTo(this.p.lie, 3); this.pose = 'ligt'; await sleep(1200); }
      const J = this.p.jump, ids = this.p.sid, push = {}, stand = {};
      ids.forEach((id, i) => {
        const p = this.clamp(i, J.pose[i]), s = this.clamp(i, this.p.stand[i]);
        push[id] = [0, p & 255, p >> 8, 0, 0, 0, 0];                 // acc 0 + speed 0 = as fast as the servo can
        stand[id] = [40, s & 255, s >> 8, 0, 0, 1500 & 255, 1500 >> 8];
      });
      await this.bus.sync(A.ACC, push);
      const t0 = performance.now(); let vmin = 99;
      for (let k = 0; performance.now() - t0 < J.hold * 1000; k++) {
        const r = await this.bus.read(ids[k % ids.length], A.VOLT, 1);
        if (r) vmin = Math.min(vmin, r[0] / 10);
        if (vmin < 9.5) break;
      }
      await this.bus.sync(A.ACC, stand); this.pose = 'staat';
      for (const t = performance.now(); performance.now() - t < 1200;) await this.readPos();
      this.volt = vmin < 99 ? vmin : this.volt;
      this.emit(vmin < 9.5 ? `sprong afgebroken: ${vmin} V` : `gesprongen · laagste spanning ${vmin} V`);
    });
  }
  // puppet mode: the page drags one leg at a time (ticks for its 3 joints); a loop sends the newest goal at ~20 Hz,
  // speed-limited so the real leg glides after the finger. Leaving puppet mode puts every leg back in the stand pose.
  puppetStart() {
    if (this.action) return;
    this.puppetOn = true;
    return this.run('poppenspel', async () => {
      await this.needStand();
      while (this.puppetOn && !this.stopReq) {
        const g = this.puppetGoal; this.puppetGoal = null;
        if (g) { const d = {}; g.idx.forEach((i, k) => d[this.p.sid[i]] = this.goal(this.clamp(i, g.t[k]), 1200)); await this.bus.sync(A.GOAL, d); }
        else await this.readPos();
        await sleep(45);
      }
      await this.moveTo(this.p.stand, 1.5);
    });
  }
  puppetSet(idx, t) {
    t = t.map((v, k) => Math.max(this.p.min[idx[k]] + 40, Math.min(this.p.max[idx[k]] - 40, Math.round(v))));
    idx.forEach((i, k) => this.ticks[i] = t[k]); this.onPose && this.onPose();
    if (this.action === 'poppenspel') this.puppetGoal = {idx, t};
    return t;
  }
  puppetEnd() { this.puppetOn = false; }
  stop() {
    this.want = null;
    if (['dansen', '6-7', '6-7 ∞', 'klappen', 'lopen', 'zwaaien', 'poppenspel'].includes(this.action)) this.stopReq = true;
    this.emit(this.action ? 'stoppen…' : 'staat stil');
  }
}

window.ArachneUSB = {Robot, Bus, pickLink};
