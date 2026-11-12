# Drittanbieter-Hinweise

Die Indexdateien der Ein-Seiten-Vorlage in `index.html` (Modul `src/goodnotes/template-data.js`)
stammen unverändert aus InkLift, das sie aus einem Beispiel von parser-for-goodnotes ableitet.
Der Aufbau des GoodNotes-Writers folgt InkLift. Beide Projekte stehen unter der MIT-Lizenz.

## InkLift — https://github.com/yellowHatpro/InkLift

MIT License

Copyright (c) 2026 Ashutosh Aswal

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## parser-for-goodnotes — https://github.com/Kaih1825/parser-for-goodnotes

MIT License

Copyright (c) 2025 Document Parser for GoodNotes contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## PDF.js — https://github.com/mozilla/pdf.js

Liest Arbeitsblätter als PDF im Browser (`src/sheet.js`). Unverändert unter
`vendor/pdfjs-6.4.299/`: die Legacy-Fassung aus dem npm-Paket `pdfjs-dist` 6.4.299
(`legacy/build/pdf.min.mjs` und `pdf.worker.min.mjs`, als `.js` gespeichert) und die
WebAssembly-Decoder aus `wasm/`. Copyright Mozilla Foundation, Apache-2.0
(`vendor/pdfjs-6.4.299/LICENSE`, auch `licenses/Apache-2.0.txt`). Die Decoder enthalten
Code von PDFium (JBIG2, BSD-3-Clause), OpenJPEG (BSD-2-Clause) und qcms (MIT); die
Lizenztexte liegen daneben in `vendor/pdfjs-6.4.299/wasm/LICENSE_*`.

## Google-Knopf — https://uiverse.io/Yaya12085/sharp-quail-80

Aussehen des Knopfs „Weiter mit Google“ in der App (`.btn-google` in `style.css`, Logo in
`app/index.html`), auf eine eigene Klasse bezogen und um einen gesperrten Zustand ergänzt.

MIT License

Copyright (c) 2026 Yaya12085 (Yaya Mohamed)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## EMS Felix — Schrift im Film der Startseite (`landing/hand-font.js`)

Einstrich-Schrift von Sheldon B. Michaels, abgeleitet von Felipa (Fontstage), als SVG-Font
umgewandelt von Windell H. Oskay (Evil Mad Scientist), verteilt im npm-Paket `hersheytext`.
Lizenz: SIL Open Font License 1.1, Text in `licenses/OFL-1.1.txt` (https://openfontlicense.org).
Die Glyphen werden mit `tools/build-hand-font.mjs` nur ins JS-Format übertragen, nicht verändert.

## Fertige Handschriften (`src/presets-data.js`)

Die fünf fertigen Handschriften entstehen mit `tools/build-presets.mjs` aus Einstrich-SVG-Schriften
des npm-Pakets `hersheytext` (Version 2.0.0, Ordner `svg_fonts`). Dabei werden die Glyphen
verändert: auf die Kästchenhöhe skaliert, Kurven in Geraden zerlegt, vereinfacht, bei
Schreibschrift und Elegant Ober- und Unterlängen gestaucht, zu breite Ränder gekürzt; in der App
kommen leicht verzogene Varianten dazu und ein aus zwei S gebautes „§“. Die veränderten Daten
stehen unter derselben Lizenz wie ihre Vorlage. Die Namen in der App (Schreibschrift, Elegant,
Feder, Druckschrift, Verspielt) sind eigene; Namen der Vorlagen werden nicht verwendet.

| In der App | Vorlage | Herkunft | Lizenz |
| --- | --- | --- | --- |
| Schreibschrift (`cursive`) | Hershey Script 1-stroke | Dr. A. V. Hershey; SVG von Windell H. Oskay | Hershey-Bedingungen, unten |
| Elegant (`elegant`) | EMS Allure | Sheldon B. Michaels nach Allura (Rob Leuschke, TypeSETit; Copyright 2010 The Allura Project Authors); SVG von Windell H. Oskay | SIL OFL 1.1 |
| Feder (`quill`) | EMS Felix | Sheldon B. Michaels nach Felipa (Copyright (c) 2011 Fontstage, Reserved Font Name „Felipa“); SVG von Windell H. Oskay | SIL OFL 1.1 |
| Druckschrift (`print`) | EMS Tech | Sheldon B. Michaels nach Architects Daughter (Copyright (c) 2010, Kimberly Geswein); SVG von Windell H. Oskay | SIL OFL 1.1 |
| Verspielt (`playful`) | EMS Elfin | Sheldon B. Michaels nach Mountains of Christmas (Crystal Kluge, Tart Workshop); SVG von Windell H. Oskay | SIL OFL 1.1 laut Schrift; Google führt die Vorlage unter Apache 2.0 (`licenses/Apache-2.0.txt`) |

Lizenztexte: `licenses/OFL-1.1.txt` (SIL Open Font License 1.1) und `licenses/Apache-2.0.txt`.

Für die Hershey-Schrift gelten diese Bedingungen (unverändert aus der Schriftdatei):

```
The Hershey Fonts are a set of vector fonts with a liberal license.

USE RESTRICTION:
    This distribution of the Hershey Fonts may be used by anyone for
    any purpose, commercial or otherwise, providing that:
        1. The following acknowledgements must be distributed with
            the font data:
            - The Hershey Fonts were originally created by Dr.
                A. V. Hershey while working at the U. S.
                National Bureau of Standards.
            - The format of the Font data in this distribution
                was originally created by
                    James Hurt
                    Cognition, Inc.
                    900 Technology Park Drive
                    Billerica, MA 01821
                    (mit-eddie!ci-dandelion!hurt)
        2. The font data in this distribution may be converted into
            any other format *EXCEPT* the format distributed by
            the U.S. NTIS where each point is described
            in eight bytes as "xxx yyy:", where xxx and yyy are
            the coordinate values as ASCII numbers.
```

Hershey Script 1-stroke wurde 2011 von Windell H. Oskay (www.evilmadscientist.com) aufbereitet und
2019 in SVG umgewandelt, nach emergent.unpythonic.net/software/hershey über „Hershey Fonts in SVG“
von Marty McGuire (http://www.thingiverse.com/thing:6168).

## hersheytext — https://github.com/techninja/hersheytextjs

Aus dem Paket stammen nur die Schriftdateien (Lizenzen oben), kein Code. Das Paket selbst steht
unter der MIT-Lizenz, Copyright (c) 2014 James T.
