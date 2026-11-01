// Neue Version für Browser-Caches: node tools/version.mjs [Nummer]
// GitHub Pages lässt Browser jede Datei 10 Minuten zwischenspeichern. Ohne Versionsnummer
// an jedem Modul lädt der Browser nach einem Update die neue app.js, aber alte Bausteine
// dazu, und die Seite bleibt leer. Deshalb bekommt jedes Modul über eine Import Map
// dieselbe Nummer wie Stylesheet und Einstieg. Ohne Nummer wird die bisherige um eins erhöht.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PAGES = ['index.html', 'app/index.html', 'datenschutz/index.html'];

async function modules(dir) {
  const out = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await modules(path));
    else if (entry.name.endsWith('.js')) out.push(path);
  }
  return out;
}

export async function moduleList() {
  return [...await modules('src'), ...await modules('landing')].sort();
}

export function importMap(page, files, version) {
  const base = dirname(page);
  const imports = {};
  for (const f of files) {
    let rel = relative(base, f).split('\\').join('/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    imports[rel] = `${rel}?v=${version}`;
  }
  return `<script type="importmap">${JSON.stringify({ imports }, null, 2).replace(/\n/g, '\n  ')}</script>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const files = await moduleList();
  const first = await readFile(join(ROOT, PAGES[1]), 'utf8');
  const current = Number(/\?v=(\d+)/.exec(first)?.[1] ?? 0);
  const version = process.argv[2] ?? String(current + 1);
  for (const page of PAGES) {
    let html = await readFile(join(ROOT, page), 'utf8');
    const map = importMap(page, files, version);
    html = /<script type="importmap">[\s\S]*?<\/script>/.test(html)
      ? html.replace(/<script type="importmap">[\s\S]*?<\/script>/, map)
      : html.replace(/(\n\s*)(<script type="module")/, `$1${map}$1$2`);
    html = html.replace(/\?v=\d+/g, `?v=${version}`);
    await writeFile(join(ROOT, page), html);
  }
  console.log(`Version ${version}: ${files.length} Module in ${PAGES.join(', ')}`);
}
