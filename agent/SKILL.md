---
name: siebwrite
description: Turns text into handwriting with Siebwrite (siebwrite.de) and saves it as an erasable GoodNotes file (.goodnotes with real pen strokes) or a PDF. Use when the user wants notes, a letter, a summary, flashcards or any text handwritten, "in my handwriting", "in Handschrift", "handgeschrieben" or "for GoodNotes", or uploads a Handschrift-Profil.json.
---

# Siebwrite: text to handwriting for GoodNotes

Siebwrite writes text letter by letter in a handwriting, with small natural variations, and saves it as

- `.goodnotes` files: real ballpoint strokes; the GoodNotes eraser and lasso work on them like on the user's own writing. One file per page.
- a PDF with vector strokes, for any other app or for printing.

Needs Node.js 18 or newer. Nothing to install, no network.

## Run it

Write the text to a file first (keeps quotes and line breaks intact), then run, from the folder this SKILL.md is in:

```bash
node agent/siebwrite.mjs --text-file /tmp/text.txt --hand cursive --out <output-folder> --json
```

The JSON lists the saved `files`, the number of `pages`, the characters that were left out (`missing`) and a `link` (see below). Save into the folder your environment hands to the user (on claude.ai that is `/mnt/user-data/outputs/`) and give the user the files.

| Option | Values |
| --- | --- |
| `--hand` | ready-made: `cursive` (default), `elegant`, `quill`, `print`, `playful` |
| `--profile <file>` | the user's own handwriting, a `Handschrift-Profil.json` |
| `--paper` | `lined` wide ruled (default), `narrow` narrow ruled, `grid`, `blank` |
| `--ink` | `blau` blue ballpoint (default), `schwarz` black, `dunkelblau` ink, `grau` pencil, or `#rrggbb` |
| `--format` | `a4` (default), `a5`, `a3` or `standard` (GoodNotes' own page size) |
| `--pdf` | a PDF instead of `.goodnotes` files |
| `--seed <n>` | other letter variants, if the user wants it to look different |
| `--lang en` | English file names and link (default `de`) |

## Whose handwriting

- **The user's own:** they write each character once at https://siebwrite.de/app/ (about five minutes), then save it with "Sichern" (English app: "Save"). That gives `Handschrift-Profil.json`. If they upload it, pass `--profile <path>`.
- **Ready-made:** without a profile, pick one of the five. Ask if the user cares; `cursive` is a good default.
- **Handwriting only in their browser:** use the link instead of a file (below).

## Text that works

- Plain text only. Markdown is drawn literally: no `#` headings, `**bold**`, `*` or `-` bullets, or tables. Use line breaks, an empty line between paragraphs, and numbers like `1.` for lists.
- The user's own handwriting has letters (with ä ö ü ß), digits and `. , ! ? : ; - ' " ( ) / & + = % € @`. Anything else (→, •, emoji, many symbols) is left out and reported in `missing`. Rephrase with words or allowed characters, or tell the user.
- An A4 page holds about 150 words in `cursive` and up to about 280 in `quill`; A5 and the `standard` page about half of that, A3 about twice. `narrow` paper fits more lines. Longer texts become several pages and files.

## Getting it into GoodNotes

- iPad or iPhone: open the file, tap the share button, choose GoodNotes.
- Mac: open the file with GoodNotes.

## Link instead of a file

```bash
node agent/siebwrite.mjs --text-file /tmp/text.txt --link
```

prints `https://siebwrite.de/app/#text=…`. Opening it shows the text in the Siebwrite app, set in the handwriting saved in that browser; one tap on "GoodNotes" imports it. The text sits behind `#` and is never sent to a server. Without Node, build it by hand: `https://siebwrite.de/app/#text=` plus the URL-encoded text (`encodeURIComponent`), optionally `&hand=cursive&paper=lined&ink=blau&format=a4`. English app: `https://siebwrite.de/en/app/#text=…`.

## As an MCP server

`node agent/siebwrite.mjs mcp` serves the same over MCP (stdio) with the tools `create_handwriting` and `handwriting_link`. Optional environment: `SIEBWRITE_PROFILE` (path to the user's Handschrift-Profil.json) and `SIEBWRITE_OUT` (output folder, default Downloads).
