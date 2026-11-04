// Text per Link: siebwrite.de/app/#text=…&hand=cursive&paper=lined&ink=blau&format=a4
// So schicken Chatbots und KI-Agenten Text in die App (Seite /ki/). Gesetzt wird mit der
// Handschrift, die auf dem Gerät gespeichert ist, oder mit der genannten fertigen. Alles
// steht hinter dem "#": diesen Teil schickt der Browser nie an den Server.
// Werte wie in compose.js pickSettings(), dazu gängige andere Namen (blue, squared …).

import { pickSettings } from './compose.js';

const SITE = 'https://siebwrite.de/';

const KEYS = new Set(['text', 'hand', 'paper', 'ink', 'format']);

// Prozent-Kodierung lesen wie ein Formular ("+" = Leerzeichen). Kaputte Stellen bleiben
// stehen, statt den ganzen Text zu verwerfen.
function decode(s) {
  const plus = s.replace(/\+/g, ' ');
  try {
    return decodeURIComponent(plus);
  } catch {
    return plus.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
      try { return decodeURIComponent(run); } catch { return run; }
    });
  }
}

// Teile "name=wert" hinter dem "#". Von Hand gebaute Links (Chatbots) vergessen gern, ein "&"
// im Text zu kodieren: Was nach "text=" kommt und nicht wie ein bekannter Teil aussieht,
// gehört deshalb noch zum Text.
function linkParts(query) {
  const raw = {};
  let last = null;
  for (const part of query.split('&')) {
    if (!part) continue; // "&&" oder "&" am Ende
    const eq = part.indexOf('=');
    const key = eq > 0 ? decode(part.slice(0, eq)).trim().toLowerCase() : '';
    if (KEYS.has(key)) {
      raw[key] = part.slice(eq + 1);
      last = key;
    } else if (last === 'text') {
      raw.text += `&${part}`;
    }
  }
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, decode(v)]));
}

// { text, settings } oder null, wenn kein Text drinsteht. Unbrauchbare Werte fallen weg.
function readTextLink(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#') || hash.startsWith('#gn')) return null;
  const parts = linkParts(hash.slice(1));
  if (parts.text === undefined) return null;
  return { text: parts.text.replace(/\r\n?/g, '\n'), settings: pickSettings(parts).settings };
}

/**
 * Link auf die App mit Text und Einstellungen.
 * @param {object} o  text, dazu wahlweise hand, paper, ink, format; lang 'de' oder 'en'
 */
function textLink({ text, lang = 'de', ...choices }, site = SITE) {
  const params = new URLSearchParams({ text: String(text) });
  for (const [k, v] of Object.entries(pickSettings(choices).settings)) params.set(k, v);
  // Leerzeichen als %20 statt "+": so liest jeder den Link richtig, auch von Hand gebaut.
  return `${site}${lang === 'en' ? 'en/app/' : 'app/'}#${params.toString().replace(/\+/g, '%20')}`;
}

export { readTextLink, textLink };
