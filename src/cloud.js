// "Mit Google sichern": Knopf und Status unten, Fenster zum Anmelden, Abgleich
// nach jeder Änderung. Die Handschrift bleibt zuerst im Browser; Google Drive
// ist eine zusätzliche Kopie (Regeln in sync.js, Google in drive.js).

import { configured, prepare, requestToken, revoke, whoAmI, appFile } from './drive.js';
import { syncProfile, fingerprint } from './sync.js';

const KEY = 'handschrift.google.v1';
const DELAY = 2000; // nach der letzten Änderung, damit nicht jeder Strich hochgeladen wird

const $ = (id) => document.getElementById(id);

function readState() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') ?? {}; } catch { return {}; }
}

/**
 * @param {object} hooks
 * @param {() => object} hooks.getProfile
 * @param {(profile: object, action: string) => boolean} hooks.applyProfile  false: gerade nicht (Strich läuft)
 * @param {(message: string) => void} hooks.toast
 * @param {() => void} hooks.onChange  nach An- und Abmelden
 */
function createCloud(hooks) {
  let state = readState(); // {on, email, name, token, expires, base, fileId, syncedAt}
  let local = 'idle'; // Speichern im Browser: 'idle' | 'saved' | 'error'
  let busy = false;
  let again = false;
  let error = null;
  let dirty = false;
  let timer = null;

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* egal */ } };
  const hasToken = () => Boolean(state.token) && state.expires - 60000 > Date.now();

  function render() {
    const status = $('sync-status');
    const btn = $('cloud-btn');
    let text;
    let dot;
    if (local === 'error') { text = 'Nicht gespeichert: Speicher gesperrt'; dot = 'error'; }
    else if (!state.on) { text = local === 'saved' ? 'Im Browser gespeichert' : 'Im Browser'; dot = local; }
    else if (busy) { text = 'Gleiche ab'; dot = 'pending'; }
    else if (error) { text = error; dot = 'error'; }
    else if (dirty) { text = hasToken() ? 'Gleiche gleich ab' : 'Nicht abgeglichen'; dot = 'pending'; }
    else { text = 'Auf allen Geräten'; dot = 'cloud'; }
    status.textContent = text;
    status.dataset.state = dot;

    // Nicht angemeldet: der weiße Google-Knopf, danach ein ruhiger Knopf wie die übrigen.
    btn.hidden = !configured();
    btn.disabled = busy;
    btn.className = state.on ? 'btn btn-quiet' : 'btn-google';
    $('cloud-btn-label').textContent = !state.on ? 'Mit Google anmelden' : hasToken() && !error ? 'Google' : 'Abgleichen';
  }

  // Nach jeder Änderung am Profil (Strich, Laden, Löschen, Link).
  function changed() {
    if (!state.on) return;
    clearTimeout(timer);
    dirty = true; // bis zum Nachsehen: lieber "gleich" als zu früh "auf allen Geräten"
    render();
    timer = setTimeout(() => {
      dirty = fingerprint(hooks.getProfile()) !== state.base;
      if (dirty && hasToken()) sync();
      else render();
    }, DELAY);
  }

  async function sync() {
    if (busy) { again = true; return; }
    busy = true;
    error = null;
    render();
    let result = null;
    try {
      const before = hooks.getProfile();
      const remote = appFile(state.token, state.fileId ?? null, (id) => { state.fileId = id; });
      result = await syncProfile({ local: before, base: state.base ?? null, remote });
      // Hat sich hier während des Abgleichs etwas getan, kommt erst der nächste Durchgang.
      if (result.profile && (fingerprint(hooks.getProfile()) !== fingerprint(before) || !hooks.applyProfile(result.profile, result.action))) {
        again = true;
      } else {
        state.base = result.base;
        state.syncedAt = Date.now();
      }
      save();
    } catch (e) {
      if (e.code === 'auth') { state.token = null; save(); }
      else error = e.code === 'denied' ? 'Kein Zugriff bei Google' : 'Google nicht erreichbar';
      result = null;
    } finally {
      busy = false;
      dirty = fingerprint(hooks.getProfile()) !== state.base;
      render();
      renderDialog();
      if (again) { again = false; changed(); }
    }
    return result;
  }

  // Abgleich auf Tipp: holt bei Bedarf ein neues Token (Fenster von Google).
  async function syncNow() {
    if (!hasToken()) {
      try {
        Object.assign(state, await requestToken(state.email));
        save();
      } catch (e) {
        hooks.toast(e.code === 'blocked' ? 'Das Google-Fenster wurde blockiert. Pop-ups erlauben.' : e.message);
        return null;
      }
    }
    return sync();
  }

  // ---------- Fenster ----------

  function renderDialog() {
    const on = Boolean(state.on);
    $('cloud-title').textContent = on ? 'Angemeldet' : 'Mit Google anmelden';
    $('cloud-intro').hidden = on;
    $('cloud-account').hidden = !on;
    $('cloud-connect').hidden = on;
    $('cloud-sync-now').hidden = !on;
    $('cloud-disconnect').hidden = !on;
    $('cloud-sync-now').disabled = busy;
    if (on) $('cloud-email').textContent = state.email || 'dein Google-Konto';
  }

  function open() {
    renderDialog();
    $('cloud-dialog').showModal();
    if (state.on) return;
    // Google-Skript erst jetzt laden; der Anmelde-Knopf wartet darauf, denn das
    // Fenster von Google geht nur direkt aus einem Tipp heraus auf.
    const btn = $('cloud-connect');
    btn.disabled = true;
    prepare()
      .then(() => { btn.disabled = false; })
      .catch((e) => { $('cloud-dialog').close(); hooks.toast(e.message); });
  }

  async function connect() {
    let token;
    try {
      token = await requestToken();
    } catch (e) {
      $('cloud-dialog').close(); // sonst liegt die Meldung hinter dem Fenster
      hooks.toast(e.code === 'blocked' ? 'Das Google-Fenster wurde blockiert. Pop-ups erlauben.' : e.message);
      return;
    }
    $('cloud-dialog').close();
    // Neues Konto: nichts vom vorigen übernehmen, auch nicht den Stand (base).
    state = { on: true, ...token, base: null, fileId: null };
    try { Object.assign(state, await whoAmI(state.token)); } catch { /* Name ist nur Anzeige */ }
    save();
    hooks.onChange();
    const res = await sync();
    if (res?.action === 'upload' || res?.action === 'same') hooks.toast('Angemeldet');
  }

  function disconnect() {
    revoke(state.token);
    state = {};
    save();
    error = null;
    dirty = false;
    $('cloud-dialog').close();
    render();
    hooks.onChange();
    hooks.toast('Abgemeldet');
  }

  $('cloud-btn').addEventListener('click', () => {
    if (state.on && (!hasToken() || error)) syncNow();
    else open();
  });
  $('cloud-connect').addEventListener('click', connect);
  $('cloud-sync-now').addEventListener('click', async () => {
    const res = await syncNow();
    if (res) hooks.toast(res.action === 'same' ? 'Alles schon gleich' : 'Abgeglichen');
  });
  $('cloud-disconnect').addEventListener('click', disconnect);
  $('cloud-close').addEventListener('click', () => $('cloud-dialog').close());

  // Zurück in die App: nachsehen, ob ein anderes Gerät etwas geändert hat.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.on && hasToken()) sync();
  });

  return {
    get available() { return configured(); },
    get on() { return Boolean(state.on); },
    open,
    changed,
    // Ergebnis vom Speichern im Browser (store.js)
    localStatus(s) { local = s; render(); },
    start() {
      render();
      if (!configured() || !state.on) return;
      // Schon verbunden: Google vorladen, damit "Abgleichen" das Fenster sofort öffnen kann.
      prepare().catch(() => {});
      dirty = fingerprint(hooks.getProfile()) !== state.base;
      if (hasToken()) sync();
      else render();
    },
  };
}

export { createCloud };
