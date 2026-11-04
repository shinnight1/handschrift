#!/usr/bin/env node
// Siebwrite für KI-Agenten und die Kommandozeile: Text → Handschrift als .goodnotes oder PDF.
//
//   node agent/siebwrite.mjs --text "Liebe Oma, …" --hand cursive --out .
//   node agent/siebwrite.mjs --text-file brief.txt --profile Handschrift-Profil.json --json
//   node agent/siebwrite.mjs mcp        MCP-Server über stdin/stdout (Claude Desktop, Cursor …)
//
// Nur Node.js ab Version 18, keine Pakete, kein Netz. Anleitung für Agenten: agent/SKILL.md,
// für Menschen: siebwrite.de/ki/. Texte für Agenten auf Englisch, die verstehen das überall.

import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeHandwriting, UsageError, HANDS, CHOICES } from './make.mjs';
import { textLink } from '../src/textlink.js';
import { pickSettings } from '../src/compose.js';

const VERSION = '1.0.0';
globalThis.crypto ??= webcrypto; // Node 18 hat crypto noch nicht global

const HELP = `Siebwrite: turn text into handwriting as an erasable GoodNotes file or a PDF.

Usage:
  node siebwrite.mjs [options] [text]
  node siebwrite.mjs mcp                 run as an MCP server (stdio)

Text (one of):
  --text, -t "…"            the text
  --text-file, -f file.txt  read the text from a file ("-" = stdin)
  [text]                    or as the last argument

Options:
  --hand cursive            ready-made: cursive (default), elegant, quill, print, playful
  --profile, -p file.json   the user's own handwriting (Handschrift-Profil.json, exported
                            with "Sichern"/"Save" in the app at https://siebwrite.de/app/)
  --paper lined             lined (default), grid, blank
  --ink blau                blau (default), schwarz, dunkelblau, grau, or #rrggbb
  --format a4               a4 (default) or standard (GoodNotes' own page size)
  --pdf                     write a PDF instead of .goodnotes files
  --out, -o folder          where to save (default: current folder)
  --name "…"                file name without extension
  --seed 1                  another number gives other letter variants
  --lang de                 de or en: file names and link language
  --link                    only print a siebwrite.de link that opens the text in the app
  --json                    print the result as JSON

GoodNotes gets one .goodnotes file per page. Characters the handwriting does not have
are left out and listed as "missing".`;

const expandHome = (p) => (typeof p === 'string' && /^~(?=$|[\\/])/.test(p) ? join(homedir(), p.slice(1)) : p);

async function readProfile(path) {
  const file = resolve(expandHome(path));
  let text;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new UsageError(`Cannot read the handwriting file ${file}.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${file} is not a Siebwrite handwriting file (Handschrift-Profil.json).`);
  }
}

// Erzeugen und speichern; Pfade absolut, damit Agenten sie weiterreichen können.
async function create(options, outDir) {
  const result = await makeHandwriting(options);
  const dir = resolve(expandHome(outDir));
  await mkdir(dir, { recursive: true });
  const paths = [];
  for (const f of result.files) {
    const path = join(dir, f.name);
    await writeFile(path, f.bytes);
    paths.push(path);
  }
  return { ...result, files: paths };
}

function summary(r, output) {
  const kind = output === 'pdf' ? 'PDF' : `GoodNotes file${r.files.length > 1 ? 's' : ''}`;
  const lines = [
    `Saved ${r.files.length} ${kind} (${r.pages} page${r.pages > 1 ? 's' : ''}), handwriting ${r.settings.hand}, paper ${r.settings.paper}, ink ${r.settings.ink}, format ${r.settings.format}:`,
    ...r.files,
  ];
  if (r.missing.length) lines.push(`Left out, not in this handwriting: ${r.missing.join(' ')}`);
  if (output !== 'pdf') {
    lines.push('Into GoodNotes: on a Mac open the file with GoodNotes; on iPad or iPhone tap the file, then the share button, then GoodNotes.');
  }
  return lines.join('\n');
}

// ---------- Kommandozeile ----------

async function cli(argv) {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      text: { type: 'string', short: 't' },
      'text-file': { type: 'string', short: 'f' },
      hand: { type: 'string' },
      profile: { type: 'string', short: 'p' },
      paper: { type: 'string' },
      ink: { type: 'string' },
      format: { type: 'string' },
      pdf: { type: 'boolean' },
      out: { type: 'string', short: 'o' },
      name: { type: 'string' },
      seed: { type: 'string' },
      lang: { type: 'string' },
      link: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  if (v.help) { console.log(HELP); return; }
  if (v.version) { console.log(VERSION); return; }

  let text = v.text;
  if (text === undefined && v['text-file'] !== undefined) {
    if (v['text-file'] === '-') {
      const chunks = [];
      for await (const c of process.stdin) chunks.push(c);
      text = Buffer.concat(chunks).toString('utf8');
    } else {
      try {
        text = await readFile(resolve(expandHome(v['text-file'])), 'utf8');
      } catch {
        throw new UsageError(`Cannot read the text file ${v['text-file']}.`);
      }
    }
  }
  if (text === undefined && positionals.length) text = positionals.join(' ');
  if (text === undefined) throw new UsageError('No text. Use --text "…", --text-file file.txt or see --help.');

  if (v.link) {
    const { invalid } = pickSettings(v);
    if (invalid.length) throw new UsageError(invalid.map((k) => `Unknown ${k} "${v[k]}". Use ${CHOICES[k]}.`).join(' '));
    const link = textLink({ text, hand: v.hand, paper: v.paper, ink: v.ink, format: v.format, lang: v.lang });
    console.log(v.json ? JSON.stringify({ ok: true, link }) : link);
    return;
  }

  const output = v.pdf ? 'pdf' : 'goodnotes';
  const profile = v.profile ? await readProfile(v.profile) : undefined;
  const r = await create({ ...v, text, profile, output }, v.out ?? '.');
  if (v.json) console.log(JSON.stringify({ ok: true, ...r }, null, 2));
  else console.log(summary(r, output));
}

// ---------- MCP-Server (stdio, JSON-RPC 2.0, eine Nachricht pro Zeile) ----------

const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const HAND_PROP = {
  type: 'string',
  enum: HANDS,
  description: "Ready-made handwriting: cursive, elegant, quill, print, playful. 'own' = the user's own handwriting (needs profile_path or the SIEBWRITE_PROFILE setting). Default: own if a profile is set, else cursive.",
};
const STYLE_PROPS = {
  paper: { type: 'string', enum: ['lined', 'grid', 'blank'], description: 'Paper. Default: lined.' },
  ink: { type: 'string', description: 'blau (blue ballpoint, default), schwarz (black), dunkelblau (ink), grau (pencil), or a colour as #rrggbb.' },
  format: { type: 'string', enum: ['a4', 'standard'], description: "Page size: a4 (default) or standard (GoodNotes' own page size)." },
};
const TEXT_PROP = {
  type: 'string',
  description: 'Plain text to write by hand. Line breaks and blank lines are kept. No Markdown: # * | would be drawn as characters.',
};

const TOOLS = [
  {
    name: 'create_handwriting',
    title: 'Write text by hand (GoodNotes / PDF)',
    description: 'Writes text in handwriting with Siebwrite and saves it as an erasable GoodNotes file (.goodnotes with real ballpoint strokes, one file per page; the GoodNotes eraser and lasso work on it) or as a vector PDF. Uses the user\'s own handwriting (Handschrift-Profil.json) or one of five ready-made ones. Returns the paths of the saved files and any characters that were left out.',
    inputSchema: {
      type: 'object',
      properties: {
        text: TEXT_PROP,
        hand: HAND_PROP,
        profile_path: { type: 'string', description: 'Path to the user\'s Handschrift-Profil.json (exported with "Sichern"/"Save" in the Siebwrite app). Implies hand "own".' },
        ...STYLE_PROPS,
        output: { type: 'string', enum: ['goodnotes', 'pdf'], description: 'goodnotes (default) or pdf.' },
        out_dir: { type: 'string', description: 'Folder to save into. Default: the SIEBWRITE_OUT setting, else the Downloads folder.' },
        name: { type: 'string', description: 'File name without extension. Default: from the first words of the text.' },
        seed: { type: 'number', description: 'Another number gives other letter variants.' },
        lang: { type: 'string', enum: ['de', 'en'], description: 'Language of the file names. Default: de.' },
      },
      required: ['text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'handwriting_link',
    title: 'Siebwrite link for the browser',
    description: 'Makes a siebwrite.de link that opens the text in the Siebwrite web app, set in the handwriting saved in that browser (or a ready-made one). The user taps "GoodNotes" there to import it. Good on iPad and iPhone, and when the user has no handwriting file. Nothing is sent to a server: the text sits behind the "#" of the link.',
    inputSchema: {
      type: 'object',
      properties: {
        text: TEXT_PROP,
        hand: { ...HAND_PROP, description: "Ready-made handwriting (cursive, elegant, quill, print, playful) or 'own' for the handwriting saved in the user's browser. Default: whatever the user picked last in the app." },
        ...STYLE_PROPS,
        lang: { type: 'string', enum: ['de', 'en'], description: 'Language of the app page. Default: de.' },
      },
      required: ['text'],
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const INSTRUCTIONS = 'Siebwrite turns text into handwriting for GoodNotes. create_handwriting saves erasable .goodnotes files (or a PDF) and returns their paths; give the user plain text without Markdown. handwriting_link returns a siebwrite.de link instead, which opens the text in the user\'s browser with the handwriting saved there.';

async function defaultOutDir() {
  if (process.env.SIEBWRITE_OUT) return process.env.SIEBWRITE_OUT;
  const downloads = join(homedir(), 'Downloads');
  try {
    if ((await stat(downloads)).isDirectory()) return downloads;
  } catch { /* kein Downloads-Ordner */ }
  return homedir();
}

async function callTool(name, args = {}) {
  if (name === 'handwriting_link') {
    if (typeof args.text !== 'string' || !args.text.trim()) throw new UsageError('The text is empty.');
    const { invalid } = pickSettings(args);
    if (invalid.length) throw new UsageError(invalid.map((k) => `Unknown ${k} "${args[k]}". Use ${CHOICES[k]}.`).join(' '));
    return textLink(args);
  }
  if (name === 'create_handwriting') {
    const output = args.output ?? 'goodnotes';
    const profilePath = args.profile_path ?? (args.hand === undefined || args.hand === 'own' ? process.env.SIEBWRITE_PROFILE : undefined);
    const profile = profilePath ? await readProfile(profilePath) : undefined;
    const r = await create({ ...args, profile, output }, args.out_dir ?? await defaultOutDir());
    return summary(r, output);
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { rpc: -32602 });
}

async function handle(msg) {
  if (!msg || typeof msg !== 'object' || typeof msg.method !== 'string') return null; // Antworten: wir fragen nichts
  const reply = (result) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id: msg.id ?? null, error: { code, message } });
  const isRequest = msg.id !== undefined && msg.id !== null;

  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'siebwrite', title: 'Siebwrite', version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return isRequest ? reply({}) : null;
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      try {
        const text = await callTool(msg.params?.name, msg.params?.arguments ?? {});
        return reply({ content: [{ type: 'text', text }] });
      } catch (e) {
        if (e.rpc) return fail(e.rpc, e.message);
        // Fehler beim Ausführen gehören ins Ergebnis, damit das Modell sie sieht und korrigiert.
        const message = e instanceof UsageError ? e.message : `Siebwrite failed: ${e?.message ?? e}`;
        return reply({ content: [{ type: 'text', text: message }], isError: true });
      }
    }
    default:
      if (!isRequest || msg.method.startsWith('notifications/')) return null;
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}

async function serveMcp() {
  const send = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    if (Array.isArray(msg)) { // Stapel aus älteren Protokollversionen
      const replies = [];
      for (const m of msg) {
        const r = await handle(m);
        if (r) replies.push(r);
      }
      if (replies.length) send(replies);
    } else {
      const r = await handle(msg);
      if (r) send(r);
    }
  }
}

// ---------- Start ----------

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === 'mcp') await serveMcp();
    else await cli(args);
  } catch (e) {
    const json = args.includes('--json');
    const message = e instanceof UsageError || e?.code?.startsWith?.('ERR_PARSE_ARGS') ? e.message : `Siebwrite failed: ${e?.stack ?? e}`;
    if (json) console.log(JSON.stringify({ ok: false, error: message }));
    else console.error(message);
    process.exitCode = 1;
  }
}

export { handle, TOOLS, VERSION };
