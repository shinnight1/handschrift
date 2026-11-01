// Google-Anmeldung und eine Datei im versteckten App-Ordner von Google Drive.
// Kein eigener Server: Der Browser holt sich bei Google ein Zugriffstoken (gilt
// etwa eine Stunde) und spricht damit direkt mit der Drive-API. Der Zugriff
// "drive.appdata" sieht nur den eigenen Ordner der App, keine anderen Dateien.
// Neue Tokens gibt Google nur nach einem Tipp heraus (Anmeldefenster).

// OAuth-Client-ID aus der Google Cloud Console, Projekt "siebwrite" (öffentlich, kein Geheimnis).
// Erlaubte Adressen dort: https://siebwrite.de, https://www.siebwrite.de, http://localhost:5190.
// Leer: Die Google-Knöpfe bleiben ausgeblendet.
const CLIENT_ID = '537877104088-2en7gnibmhk4t6e7o5pmm07d32s5reiq.apps.googleusercontent.com';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_URL = 'https://accounts.google.com/gsi/client';
const FILE_NAME = 'handschrift.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

const configured = () => CLIENT_ID !== '';

// Fehler mit Code: 'auth' (Token abgelaufen oder entzogen), 'denied' (Drive-Zugriff
// nicht erlaubt), 'closed' (Fenster zugemacht), 'blocked' (Fenster blockiert),
// 'load' (Google nicht erreichbar), 'net' (sonstiger Fehler).
class DriveError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Google-Skript erst laden, wenn jemand Google nutzen will.
let gisPromise = null;
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      s.remove();
      reject(new DriveError('load', 'Google ließ sich nicht laden. Ist das Netz da?'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

let tokenClient = null;
let pending = null; // {resolve, reject} der laufenden Anmeldung

function prepare() {
  return loadGis().then(() => {
    tokenClient ??= google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        const p = pending;
        pending = null;
        if (!p) return;
        if (resp.error) p.reject(new DriveError('denied', 'Google hat die Anmeldung abgelehnt.'));
        else if (!google.accounts.oauth2.hasGrantedAllScopes(resp, SCOPE)) {
          p.reject(new DriveError('denied', 'Ohne den Zugriff geht die Anmeldung nicht.'));
        } else p.resolve({ token: resp.access_token, expires: Date.now() + (Number(resp.expires_in) || 3600) * 1000 });
      },
      error_callback: (err) => {
        const p = pending;
        pending = null;
        if (err?.type === 'popup_failed_to_open') p?.reject(new DriveError('blocked', 'Das Google-Fenster wurde blockiert.'));
        else p?.reject(new DriveError('closed', 'Anmeldung abgebrochen.'));
      },
    });
  });
}

/**
 * Neues Token. Muss direkt aus einem Tipp heraus laufen (sonst blockiert der
 * Browser das Fenster), also erst nach prepare().
 * @param {string} [email]  bekanntes Konto: Google fragt dann nicht nach der Auswahl
 */
function requestToken(email) {
  if (!tokenClient) return Promise.reject(new DriveError('load', 'Google ist noch nicht geladen.'));
  pending?.reject(new DriveError('closed', 'Anmeldung abgebrochen.'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    tokenClient.requestAccessToken(email ? { prompt: '', login_hint: email } : { prompt: 'select_account' });
  });
}

function revoke(token) {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
}

async function call(token, url, init = {}) {
  let res;
  try {
    res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError('net', 'Google Drive nicht erreichbar.');
  }
  if (res.status === 401) throw new DriveError('auth', 'Anmeldung abgelaufen.');
  if (res.status === 403) throw new DriveError('denied', 'Google Drive verweigert den Zugriff.');
  if (!res.ok) throw new DriveError('net', `Google Drive meldet Fehler ${res.status}.`);
  return res;
}

// Name und Adresse des Kontos, für die Anzeige und als Hinweis bei der nächsten Anmeldung.
async function whoAmI(token) {
  const res = await call(token, `${API}/about?fields=user(displayName,emailAddress)`);
  const { user } = await res.json();
  return { email: user?.emailAddress ?? '', name: user?.displayName ?? '' };
}

/**
 * Die eine Datei im App-Ordner als {read, write} für syncProfile().
 * @param {string} token
 * @param {string|null} fileId  bekannte Datei-ID, spart die Suche
 * @param {(id: string|null) => void} onId  neue oder gefundene ID merken (null: keine Datei)
 */
function appFile(token, fileId, onId) {
  let id = fileId;
  const find = async () => {
    const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
    const res = await call(token, `${API}/files?spaces=appDataFolder&q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id)`);
    return (await res.json()).files?.[0]?.id ?? null;
  };
  return {
    async read() {
      id ??= await find();
      if (!id) return null;
      try {
        return await (await call(token, `${API}/files/${id}?alt=media`)).text();
      } catch (e) {
        if (e.code !== 'net') throw e;
        // Gemerkte Datei weg (z. B. in Drive gelöscht): neu suchen.
        id = await find();
        return id ? (await call(token, `${API}/files/${id}?alt=media`)).text() : null;
      } finally {
        onId(id);
      }
    },
    async write(text) {
      if (id) {
        await call(token, `${UPLOAD}/files/${id}?uploadType=media`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
        });
        return;
      }
      const meta = { name: FILE_NAME, parents: ['appDataFolder'], mimeType: 'application/json' };
      const body = new FormData();
      body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
      body.append('file', new Blob([text], { type: 'application/json' }));
      const res = await call(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', body });
      id = (await res.json()).id;
      onId(id);
    },
  };
}

export { configured, prepare, requestToken, revoke, whoAmI, appFile, DriveError };
