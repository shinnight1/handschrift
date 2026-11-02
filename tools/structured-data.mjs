// Strukturierte Daten nachziehen: node tools/structured-data.mjs
// Jede Seite mit FAQ trägt im <script type="application/ld+json"> einen FAQPage-Eintrag. Google
// verlangt, dass er wörtlich dem sichtbaren Text entspricht; deshalb kommt er hier aus den
// <details>-Fragen der Seite, statt von Hand gepflegt zu werden. Der Test in tests/seo.test.mjs
// schlägt fehl, wenn jemand eine Frage ändert und das Skript vergisst.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('..', import.meta.url);

export const FAQ_PAGES = [
  'index.html',
  'en/index.html',
  'goodnotes-text-in-handschrift/index.html',
  'en/goodnotes-text-to-handwriting/index.html',
  'handschrift-als-schriftart/index.html',
  'en/handwriting-font/index.html',
];

// Sichtbarer Text ohne Tags, so wie ihn Suchmaschinen lesen
export function plain(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function visibleFaq(html) {
  return [...html.matchAll(/<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => ({
    '@type': 'Question',
    name: plain(m[1]),
    acceptedAnswer: { '@type': 'Answer', text: plain(m[2]) },
  }));
}

const BLOCK = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/;

export function withFaq(html) {
  const m = BLOCK.exec(html);
  if (!m) return html;
  const data = JSON.parse(m[2]);
  const node = (data['@graph'] ?? [data]).find((n) => n['@type'] === 'FAQPage');
  if (!node) return html;
  node.mainEntity = visibleFaq(html);
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c').replace(/\n/g, '\n  ');
  return html.replace(BLOCK, (_, open, __, close) => `${open}\n  ${json}\n  ${close}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const page of FAQ_PAGES) {
    const url = new URL(page, ROOT);
    let html;
    try { html = await readFile(url, 'utf8'); } catch { continue; }
    const next = withFaq(html);
    if (next !== html) await writeFile(url, next);
    console.log(`${page}: ${visibleFaq(html).length} Fragen`);
  }
}
