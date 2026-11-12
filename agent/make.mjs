// Siebwrite ohne Browser: Text → .goodnotes-Dateien oder PDF, für KI-Agenten und die
// Kommandozeile (siebwrite.mjs). Satz und Ausgabe sind dieselben wie in der App
// (src/compose.js, layout.js, render.js); nur das Vorschaubild, das in der App ein
// Canvas malt, kommt aus thumbnail.mjs.

import { layoutText } from '../src/layout.js';
import { glyphTable, parseProfile, filledCount } from '../src/profile.js';
import { pagesToGoodNotes, pagesToPdf, inkRgb } from '../src/render.js';
import { PRESETS, presetById, loadFonts, presetProfile } from '../src/presets.js';
import { DEFAULT_SETTINGS, pickSettings, layoutOptions, fileBase } from '../src/compose.js';
import { textLink } from '../src/textlink.js';
import { thumbnailJpeg } from './thumbnail.mjs';

const HANDS = ['own', ...PRESETS.map((p) => p.id)];
const CHOICES = {
  hand: HANDS.join(', '),
  paper: 'lined (wide ruled), narrow (narrow ruled), grid, blank',
  ink: 'blau (blue ballpoint), schwarz (black), dunkelblau (ink), grau (pencil) or #rrggbb',
  format: 'a4, a5, a3, standard (GoodNotes page size)',
};

class UsageError extends Error {}

/**
 * @param {object} o
 * @param {string} o.text
 * @param {object|string} [o.profile]  Inhalt einer Handschrift-Profil.json: die eigene Handschrift
 * @param {string} [o.hand]    'own' oder eine fertige: cursive, elegant, quill, print, playful
 * @param {string} [o.paper]   lined (breit liniert), narrow (schmal liniert), grid, blank
 * @param {string} [o.ink]     blau, schwarz, dunkelblau, grau oder #rrggbb (auch blue, black …)
 * @param {string} [o.format]  a4, a5, a3 oder standard
 * @param {'goodnotes'|'pdf'} [o.output]
 * @param {number} [o.seed]    andere Zahl, andere Varianten (wie „Mischen“ in der App)
 * @param {string} [o.name]    Dateiname ohne Endung
 * @param {'de'|'en'} [o.lang] Sprache von Dateinamen und Link
 * @returns {Promise<{files: {name: string, bytes: Uint8Array}[], pages: number, missing: string[], settings: object, link: string}>}
 */
async function makeHandwriting(o) {
  const text = String(o.text ?? '').replace(/\r\n?/g, '\n');
  if (!text.trim()) throw new UsageError('The text is empty.');
  const output = o.output ?? 'goodnotes';
  if (!['goodnotes', 'pdf'].includes(output)) throw new UsageError(`Unknown output "${output}". Use goodnotes or pdf.`);
  const lang = o.lang === 'en' ? 'en' : 'de';

  const { settings: picked, invalid } = pickSettings(o);
  if (invalid.length) {
    throw new UsageError(invalid.map((k) => `Unknown ${k} "${o[k]}". Use ${CHOICES[k]}.`).join(' '));
  }
  let profile = null;
  if (o.profile) {
    try {
      profile = parseProfile(o.profile);
    } catch (e) {
      throw new UsageError(`The profile is not a Siebwrite handwriting file (Handschrift-Profil.json): ${e.message}`);
    }
    if (!filledCount(profile)) throw new UsageError('The handwriting profile is empty. Write the alphabet in the Siebwrite app first.');
  }
  const hand = picked.hand ?? (profile ? 'own' : 'cursive');
  if (hand === 'own' && !profile) {
    throw new UsageError(`hand "own" needs the user's handwriting file (Handschrift-Profil.json, saved with "Sichern"/"Save" in the Siebwrite app). Without it use a ready-made one: ${PRESETS.map((p) => p.id).join(', ')}.`);
  }
  const seed = o.seed === undefined || o.seed === null || o.seed === '' ? DEFAULT_SETTINGS.seed : Math.round(Number(o.seed));
  if (!Number.isFinite(seed)) throw new UsageError('seed must be a number.');
  const settings = { ...DEFAULT_SETTINGS, ...picked, hand, seed };

  const preset = presetById(hand);
  const table = preset
    ? glyphTable(presetProfile(preset.id, await loadFonts()), { snap: 0 })
    : glyphTable(profile);
  const layout = layoutText(text, table, layoutOptions(settings, preset));
  const ink = inkRgb(settings.ink);

  const base = String(o.name ?? '').trim() || fileBase(text, lang === 'en' ? 'Handwriting' : 'Handschrift');
  let files;
  if (output === 'pdf') {
    files = [{ name: `${base}.pdf`, bytes: pagesToPdf(layout.pages, { paper: settings.paper, ink, layout }) }];
  } else {
    const pageWord = lang === 'en' ? 'Page' : 'Seite';
    const thumbnail = (page) => thumbnailJpeg(page, { paper: settings.paper, ink, layout });
    const all = pagesToGoodNotes(layout.pages, { paper: settings.paper, ink, layout, thumbnail });
    files = all.map((bytes, i) => ({ name: all.length > 1 ? `${base} (${pageWord} ${i + 1}).goodnotes` : `${base}.goodnotes`, bytes }));
  }
  const { hand: h, paper, ink: inkName, format } = settings;
  return {
    files,
    pages: layout.pages.length,
    missing: layout.missing,
    settings: { hand: h, paper, ink: inkName, format, seed },
    link: textLink({ text, hand: h, paper, ink: inkName, format, lang }),
  };
}

export { makeHandwriting, UsageError, HANDS, CHOICES };
