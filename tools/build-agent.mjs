// Paket für KI-Agenten bauen: node tools/build-agent.mjs
// Schreibt agent/siebwrite-skill.zip, zum Herunterladen auf siebwrite.de/ki/. Darin ein Ordner
// "siebwrite" mit SKILL.md (Anleitung für den Agenten), agent/siebwrite.mjs (Kommandozeile und
// MCP-Server), allen Modulen aus src/, die es braucht, und den Lizenzhinweisen. So lässt es sich
// als Claude-Skill hochladen oder entpackt mit Node starten.
// Das ZIP ist bei gleichem Inhalt Byte für Byte gleich (keine Zeitstempel). Der Test in
// tests/agent.test.mjs schlägt fehl, wenn jemand ein enthaltenes Modul ändert und das
// Neubauen vergisst.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ZipWriter } from '../src/goodnotes/zip.js';
import { utf8 } from '../src/goodnotes/bytes.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const ZIP_PATH = 'agent/siebwrite-skill.zip';
const FOLDER = 'siebwrite';
const ENTRY = 'agent/siebwrite.mjs';
const EXTRA = ['THIRD_PARTY_NOTICES.md', 'licenses/Apache-2.0.txt', 'licenses/OFL-1.1.txt'];
const PACKAGE = { name: 'siebwrite', private: true, type: 'module', bin: { siebwrite: ENTRY } };

const IMPORTS = /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|\bimport\s*['"](\.{1,2}\/[^'"]+)['"]/g;

// Alle Dateien, die der Einstieg über relative Importe braucht, als Pfade ab ROOT.
async function closure(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const code = await readFile(join(ROOT, file), 'utf8');
    for (const m of code.matchAll(IMPORTS)) {
      const target = relative(ROOT, resolve(ROOT, dirname(file), m[1] ?? m[2] ?? m[3])).split('\\').join('/');
      if (!existsSync(join(ROOT, target))) throw new Error(`${file}: Import ${target} gibt es nicht`);
      queue.push(target);
    }
  }
  return [...seen];
}

/** Inhalt des ZIPs: [{name, bytes}], sortiert. */
export async function agentFiles() {
  const files = [...await closure(ENTRY), ...EXTRA].map((f) => normalize(f).split('\\').join('/'));
  const entries = await Promise.all(files.map(async (f) => ({ name: `${FOLDER}/${f}`, bytes: new Uint8Array(await readFile(join(ROOT, f))) })));
  entries.push({ name: `${FOLDER}/SKILL.md`, bytes: new Uint8Array(await readFile(join(ROOT, 'agent/SKILL.md'))) });
  entries.push({ name: `${FOLDER}/package.json`, bytes: utf8(`${JSON.stringify(PACKAGE, null, 2)}\n`) });
  return entries.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export async function buildAgentZip() {
  const zip = new ZipWriter({ dosDate: (1 << 5) | 1 }); // 1. Januar 1980, fest: gleicher Inhalt, gleiches ZIP
  for (const e of await agentFiles()) zip.add(e.name, e.bytes);
  return zip.finish();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bytes = await buildAgentZip();
  await writeFile(join(ROOT, ZIP_PATH), bytes);
  console.log(`${ZIP_PATH}: ${(await agentFiles()).length} Dateien, ${Math.round(bytes.length / 1024)} KB`);
}
