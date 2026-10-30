// ARACHNE app: new web files without a new APK. Compares www/manifest.json here with the one on GitHub (published by
// arachne-app/publish.sh); the native LiveUpdate plugin downloads only what changed, then asks "Ja, nu updaten".
// Checks at start and every 3 minutes; with the app closed, UpdateJob (native) posts an Android notification.
// During a move the update waits until the robot stands still. Outside the app this does nothing.
(function () {
  const P = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LiveUpdate;
  if (!P) return;
  const REPO = 'KVR-CIBER/arachne-app', store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }};
  const json = (u, ms = 8000) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return fetch(u, {cache: 'no-store', signal: c.signal}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); };

  const css = document.createElement('style');
  css.textContent = `#arachne-upd{position:fixed;inset:0;z-index:99;display:flex;align-items:center;justify-content:center;background:rgba(2,6,9,.55);
      backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);font:15px system-ui,sans-serif;color:#e4f6ff}
    #arachne-upd .card{width:min(420px,calc(100vw - 32px));padding:22px;border-radius:20px;background:rgba(12,22,28,.92);border:1px solid rgba(120,220,255,.35);box-shadow:0 0 40px rgba(95,225,255,.18)}
    #arachne-upd h3{margin:0 0 6px;font-size:18px}#arachne-upd p{margin:0 0 18px;color:#9fbac6;font-size:14px;line-height:1.4}
    #arachne-upd .row{display:flex;gap:10px}#arachne-upd button{flex:1;font:600 15px system-ui,sans-serif;border-radius:14px;padding:14px;border:1px solid rgba(120,220,255,.3);background:rgba(95,225,255,.06);color:#e4f6ff}
    #arachne-upd button.yes{background:#5fe1ff;border-color:#5fe1ff;color:#03202a}
    #arachne-upd-bar{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 10px);transform:translateX(-50%);z-index:98;padding:8px 14px;border-radius:999px;
      background:rgba(12,22,28,.85);border:1px solid rgba(120,220,255,.3);color:#e4f6ff;font:13px system-ui,sans-serif}`;
  document.head.appendChild(css);
  const bar = t => { let b = document.getElementById('arachne-upd-bar'); if (!t) return b && b.remove();
    if (!b) { b = document.createElement('div'); b.id = 'arachne-upd-bar'; document.body.appendChild(b); } b.textContent = t; };
  const when = v => new Date(v * 1000).toLocaleString('nl-BE', {day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit'});

  let asked = 0;
  function ask(r) {
    if (document.getElementById('arachne-upd') || asked === r.version) return;
    const d = document.createElement('div'); d.id = 'arachne-upd';
    d.innerHTML = `<div class="card"><h3>Nieuwe versie klaar</h3><p>Versie van ${when(r.version)} staat al op de tablet. Updaten duurt een seconde.</p>
      <div class="row"><button class="later">Later</button><button class="yes">Ja, nu updaten</button></div></div>`;
    document.body.appendChild(d);
    d.querySelector('.later').onclick = () => { asked = r.version; d.remove(); };
    d.querySelector('.yes').onclick = async () => {
      d.remove();
      while (window.ArachneBusy && window.ArachneBusy()) { bar('update wacht tot de spin stilstaat…'); await new Promise(x => setTimeout(x, 500)); }
      bar('updaten…'); P.apply({path: r.path});
    };
  }

  let cur = 0, busy = false;
  async function check() {
    if (busy) return; busy = true;
    try {
      let ready = store.get('arachneUpdate'); if (ready && ready.version <= cur) ready = null;
      let rem = null, base = null;
      try {
        const sha = (await json(`https://api.github.com/repos/${REPO}/commits/main`)).sha;     // fresh, then immutable files
        base = `https://raw.githubusercontent.com/${REPO}/${sha}/www/`; rem = await json(base + 'manifest.json');
      } catch (e) {
        try { base = `https://raw.githubusercontent.com/${REPO}/main/www/`; rem = await json(base + 'manifest.json'); } catch (e2) { }
      }
      if (rem && rem.version > cur && (!ready || ready.version < rem.version)) {
        bar('nieuwe versie downloaden…');
        try { const r = await P.download({base, version: rem.version, files: rem.files}); ready = {version: rem.version, path: r.path}; store.set('arachneUpdate', ready); bar(); }
        catch (e) { bar('update mislukt: ' + (e.message || e)); setTimeout(() => bar(), 6000); }
      }
      if (ready) ask(ready);
    } finally { busy = false; }
  }
  (async () => {
    cur = (await json('manifest.json').catch(() => ({version: 0}))).version;
    P.setCurrent && P.setCurrent({version: cur}).catch(() => {});
    check(); setInterval(check, 180000);
  })();
})();
