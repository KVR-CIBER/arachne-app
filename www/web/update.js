// ARACHNE app: new web files without a new APK. Compares www/manifest.json here with the one on GitHub (published by
// arachne-app/publish.sh); the native LiveUpdate plugin downloads only what changed. The start page switches at once,
// the robot pages show a button so an update never reloads in the middle of a move. Outside the app this does nothing.
(async function () {
  const P = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.LiveUpdate;
  if (!P) return;
  const REPO = 'KVR-CIBER/arachne-app', store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }};
  const json = (u, ms = 8000) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return fetch(u, {cache: 'no-store', signal: c.signal}).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }); };

  const css = document.createElement('style');
  css.textContent = `#arachne-upd{position:fixed;left:50%;top:calc(env(safe-area-inset-top) + 10px);transform:translateX(-50%);z-index:99;display:flex;gap:10px;align-items:center;
    padding:8px 8px 8px 14px;border-radius:999px;background:rgba(12,22,28,.85);border:1px solid rgba(120,220,255,.3);color:#e4f6ff;font:13px system-ui,sans-serif;
    backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}#arachne-upd button{font:600 13px system-ui,sans-serif;border:0;border-radius:999px;padding:7px 12px;background:#5fe1ff;color:#03202a}`;
  document.head.appendChild(css);
  function banner(text, btn, fn) {
    let b = document.getElementById('arachne-upd');
    if (!b) { b = document.createElement('div'); b.id = 'arachne-upd'; document.body.appendChild(b); }
    b.innerHTML = '<span></span>' + (btn ? '<button></button>' : ''); b.firstChild.textContent = text;
    if (btn) { b.lastChild.textContent = btn; b.lastChild.onclick = fn; }
  }
  const apply = r => P.apply({path: r.path});
  function offer(r) {
    if (document.body.dataset.autoupdate !== undefined) return apply(r);          // start page: just switch
    banner('nieuwe versie klaar', 'herladen', () => {
      if (window.ArachneBusy && window.ArachneBusy()) return banner('eerst stoppen, dan herladen', 'herladen', () => offer(r));
      apply(r);
    });
  }

  const cur = (await json('manifest.json').catch(() => ({version: 0}))).version;
  let ready = store.get('arachneUpdate'); if (ready && ready.version <= cur) ready = null;
  let rem = null, base = null;
  try {
    const sha = (await json(`https://api.github.com/repos/${REPO}/commits/main`)).sha;     // fresh, then immutable files
    base = `https://raw.githubusercontent.com/${REPO}/${sha}/www/`;
    rem = await json(base + 'manifest.json');
  } catch (e) {
    try { base = `https://raw.githubusercontent.com/${REPO}/main/www/`; rem = await json(base + 'manifest.json'); } catch (e2) { }
  }
  if (rem && rem.version > cur && (!ready || ready.version < rem.version)) {
    const busy = store.get('arachneUpdateBusy');
    if (busy && Date.now() - busy < 180000) return;            // another page is already downloading it
    store.set('arachneUpdateBusy', Date.now()); banner('update downloaden…');
    try { const r = await P.download({base, version: rem.version, files: rem.files}); ready = {version: rem.version, path: r.path}; store.set('arachneUpdate', ready); }
    catch (e) { banner('update mislukt: ' + (e.message || e)); setTimeout(() => { const b = document.getElementById('arachne-upd'); b && b.remove(); }, 6000); }
    store.set('arachneUpdateBusy', 0);
  }
  if (ready) offer(ready);
})();
