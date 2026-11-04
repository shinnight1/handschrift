# Handschrift

Eigene Buchstaben mit Stift, Finger oder Maus erfassen, Text damit setzen und als echte,
radierbare `.goodnotes`-Datei oder als PDF ausgeben. Reines HTML, CSS und JavaScript: kein
Framework, kein Build-Schritt, keine Abhängigkeiten.

Seite: https://siebwrite.de/ (die alte Adresse https://shinnight1.github.io/handschrift/ leitet dorthin um).
Auf `/` liegt die Startseite, die App selbst unter `/app/`. Links mit `#gn…`, `#schreiben` oder
`#setzen` auf die Startseite leitet sie in die App weiter, damit ältere Links und das Artifact
weiter ankommen. Englisch unter `/en/` (App `/en/app/`, Datenschutz `/en/privacy/`), siehe
„Zwei Sprachen“ unten.

## So geht's

1. **Schreiben:** Jedes Kästchen zeigt ein Zeichen. Auf die Grundlinie schreiben. Nach dem ersten
   Durchgang (87 Zeichen) geht Setzen schon, weitere Varianten machen die Schrift lebendiger.
   Wer noch mehr Abwechslung will, schaltet „+ 5 Durchgänge“ dazu: noch fünfmal alles, freiwillig.
2. **Setzen:** Oben die Handschrift wählen: „Meine“ oder eine der fünf fertigen (Schreibschrift,
   Elegant, Feder, Druckschrift, Verspielt). Text eintippen, Format, Papier, Farbe und Abstände
   einstellen; das `+` hinter den Farben öffnet das Farbfeld des Browsers für jede andere Farbe
   (gespeichert werden die letzten sechs). „Mischen“ würfelt die Varianten neu. Steht oben
   „Fehlt: *“, führt ein Tipp darauf direkt zum Kästchen für das Zeichen. Zeichen, die nicht in
   der Liste sind (z. B. `*`, `#`, `§`), bekommen dabei ein eigenes Kästchen unter „Eigene Zeichen“.
   Bei fertigen Handschriften lässt sich nichts nachschreiben; dort fehlt aber kaum etwas.
3. **Als GoodNotes importieren:** auf iPad und Handy öffnet sich das Teilen-Menü, dort GoodNotes
   wählen. Am PC wird die `.goodnotes`-Datei heruntergeladen. Jede Seite wird eine eigene Datei.

## Wo die Handschrift liegt

Im Browser des Geräts (localStorage). Auf ein anderes Gerät kommt sie so:

- **Mit Google anmelden** (freiwillig): Die Handschrift liegt dann zusätzlich als `handschrift.json`
  im versteckten App-Ordner des eigenen Google Drive (Zugriff `drive.appdata`, sieht keine anderen
  Dateien). Kein eigener Server: Der Browser holt sich ein Token (gilt etwa eine Stunde) und spricht
  direkt mit der Drive-API. Abgleich 2 s nach jeder Änderung, solange das Token gilt, danach auf
  einen Tipp. Beim ersten Anmelden bleibt alles auf dem Gerät; aus Drive kommen nur Kästchen dazu,
  die hier leer sind. Regeln in `src/sync.js`. Ohne Client-ID in `src/drive.js` bleibt der Knopf
  ausgeblendet.
- **Mitnehmen:** erzeugt einen Link mit Handschrift, Text und Einstellungen. Auf iPad und Handy
  über das Teilen-Menü, am PC in die Zwischenablage. Auf dem anderen Gerät öffnen, fertig. Die
  Daten stehen komprimiert hinter dem `#`; diesen Teil schickt der Browser nie an den Server, und
  die Seite nimmt ihn nach dem Laden aus der Adresszeile. Der Link ersetzt die Handschrift auf
  dem Zielgerät.
- **Sichern / Laden:** dasselbe als Datei `Handschrift-Profil.json`.

Das Handschrift-Artifact auf claude.ai erzeugt dieselben Links (Format `v1` in `src/handoff.js`).
Eigene Zeichen stehen im zusätzlichen Feld `u`, die Zusatz-Durchgänge hinter den bisherigen
Kästchen (ab Index 196). Ältere Leser wie das Artifact übergehen beides.

Die Handschrift hängt an der Adresse der Seite. Was unter `shinnight1.github.io` gespeichert war,
ist unter `siebwrite.de` nicht zu sehen: dort per „Sichern“ und „Laden“ umziehen.

## Lokal starten und testen

```
node tools/serve.mjs
```

Dann http://localhost:5190/ öffnen (die App: http://localhost:5190/app/). `file://` geht nicht, weil Browser ES-Module von dort
blockieren.

```
node --test
```

prüft Mitnehmen-Link, Profil, Abgleich mit Google Drive, Satz, LZ4, TPL, die `.goodnotes`-Datei,
das PDF, die fertigen Handschriften, eigene Farben, die englische Fassung und den Weg für
KI-Agenten (Text-Link, Kommandozeile, MCP-Server, ZIP) ohne Browser.

Für die Google-Anmeldung lokal muss `http://localhost:5190` in der Google Cloud Console beim
OAuth-Client unter „Autorisierte JavaScript-Quellen“ stehen.

Vor jedem Veröffentlichen:

```
node tools/version.mjs
```

zählt die Versionsnummer hoch, die an Stylesheets und an jedem Modul hängt (über eine Import Map in
allen sechs Seiten, deutsch und englisch). GitHub Pages lässt Browser Dateien 10 Minuten zwischenspeichern;
ohne neue Nummer mischt der Browser neue und alte Module, und die App bleibt leer. Der Test schlägt
fehl, wenn ein Modul in der Import Map fehlt.

## KI-Assistenten und Agenten

Erklärt für alle unter `/ki/` (englisch `/en/ai/`), für Crawler in `llms.txt`. Drei Wege, alle ohne
eigenen Server:

- **Text-Link:** `https://siebwrite.de/app/#text=…&hand=cursive&paper=lined&ink=blau&format=a4`
  öffnet die App mit dem Text, gesetzt in der Handschrift auf diesem Gerät (oder der genannten
  fertigen). Den Link kann jeder Chatbot bauen. Alles steht hinter dem `#`; die App nimmt es nach
  dem Lesen aus der Adresszeile, „Rückgängig“ in der Meldung holt den vorigen Text zurück. Leser und
  Bauer: `src/textlink.js`; er verzeiht vergessene `&`-Kodierung und Namen wie `blue` oder `kariert`
  (`src/compose.js`). Die Startseite leitet `#text=` an die App weiter.
- **Skill / Kommandozeile:** `agent/siebwrite.mjs` macht ohne Browser dieselben `.goodnotes`-Dateien
  und PDFs wie die App (gemeinsame Einstellungen in `src/compose.js`; das Vorschaubild, das in der App
  ein Canvas malt, rastert `agent/thumbnail.mjs` selbst und speichert es als JPEG). Nur Node.js ab 18,
  keine Pakete: `node agent/siebwrite.mjs --help`. Anleitung für Agenten: `agent/SKILL.md`.
- **MCP-Server:** `node agent/siebwrite.mjs mcp` (stdio) mit den Werkzeugen `create_handwriting`
  und `handwriting_link`. `SIEBWRITE_PROFILE` zeigt auf eine `Handschrift-Profil.json`,
  `SIEBWRITE_OUT` auf den Zielordner (sonst Downloads).

Zum Herunterladen liegt alles als `agent/siebwrite-skill.zip` bereit (Claude-Skill, entpackt auch
Kommandozeile und MCP). Nach jeder Änderung an `agent/` oder an einem Modul, das es nutzt:

```
node tools/build-agent.mjs
```

Der Test schlägt fehl, wenn das ZIP nicht mehr zum Code passt.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `landing/style.css` | Startseite, Farbwelt „Sternenhimmel“ (tiefe Nacht, Mondlicht, leuchtende Handschrift; Papier bleibt hell) |
| `landing/glass.js` | Liquid Glass für alle Seiten: Glanzlicht unter Zeiger oder Finger, Glastropfen hinter der Wahl in Segmentschaltern und Schritten, Kopf wird beim Scrollen zur Glaskapsel, Abschnitte tauchen beim Hinscrollen auf, Zähler hüpft |
| `landing/sky.js` | Sternenhimmel hinter allen Seiten: Sterne mit Funkeln und Tiefe beim Scrollen, Sternschnuppen, Sternbilder aus Buchstaben der Handschrift; in der App ruhig (`calm`) |
| `landing/sheet.js` | Blatt im Hero: Getipptes schreibt ein Füller sofort von Hand, sonst Beispiele |
| `landing/note.js` | Haftnotiz: Buchstaben des Getippten selbst schreiben; landen auf dem Blatt und beim Weg in die App als Kästchen |
| `landing/eraser.js` | „Radier ruhig“: eingefügter Text gegen Handschrift, die sich wegradieren lässt |
| `landing/scribble.js` | Handgeschriebene Wörter, Ziffern und Zettel, die sich beim Hinscrollen schreiben |
| `landing/film.js`, `landing/hand-font.js` | Film auf der Startseite: SVG-Szene, für jede Zeit berechnet; `Hand` schreibt Text in der Handschrift aus EMS Felix (`tools/build-hand-font.mjs`) |
| `datenschutz/index.html` | Datenschutzerklärung (auch für den Google-Zustimmungsbildschirm) |
| `goodnotes-text-in-handschrift/`, `handschrift-als-schriftart/` (englisch unter `en/goodnotes-text-to-handwriting/`, `en/handwriting-font/`) | Ratgeber für die häufigsten Suchanfragen: Anleitung mit Vergleich der Wege, Schriftart oder echte Striche. Fakten zu fremden Angeboten mit Stand und Quelle |
| `llms.txt`, `sitemap.xml`, `robots.txt` | Für Suchmaschinen und KI-Crawler. Neue Seiten in die Sitemap (mit `hreflang`) und in `tools/version.mjs` eintragen |
| `tools/structured-data.mjs` | Zieht die FAQ in den strukturierten Daten (JSON-LD) aus den sichtbaren Fragen nach: nach jeder geänderten Frage `node tools/structured-data.mjs`. `tests/seo.test.mjs` prüft das, dazu Canonical, Sitemap und hreflang |
| `impressum/index.html`, `en/legal/index.html` | Impressum nach § 5 DDG und § 18 Abs. 1 MStV; von jeder Seite klein im Footer verlinkt (Pflicht: „leicht erkennbar“), `noindex` und nicht in der Sitemap, damit die Anschrift nicht in Suchergebnissen steht. Der Test prüft die Links. |
| `en/index.html`, `en/app/index.html`, `en/privacy/index.html`, `en/legal/index.html` | Englische Fassung der Seiten (siehe „Zwei Sprachen“) |
| `og.png`, `og-en.png`, `tools/build-og-image.mjs` | Vorschaubild für geteilte Links (1200 × 630), ohne Abhängigkeiten gezeichnet: `node tools/build-og-image.mjs` (deutsch) bzw. `… en` (englisch) |
| `sitemap.xml`, `robots.txt` | Für Suchmaschinen: alle Seiten mit ihrer Fassung in der anderen Sprache |
| `app/index.html`, `style.css` | App und Aussehen |
| `src/app.js` | Steuerung beider Schritte |
| `src/charset.js` | welche Zeichen in welcher Reihenfolge erfasst werden |
| `src/draw.js` | Schreibkästchen, Stift-Erkennung, Rückgängig |
| `src/profile.js`, `src/store.js` | Profil, Glyphen-Maße, Speichern im Browser |
| `src/layout.js`, `src/random.js` | Text setzen, Varianten und Schwankungen |
| `src/render.js`, `src/pdf.js` | Vorschau, PDF, Papierlinien, Farben (feste und eigene `#rrggbb`) |
| `src/presets.js`, `src/presets-data.js` | Fertige Handschriften: Daten aus `tools/build-presets.mjs`, Varianten, Profil wie das eigene |
| `src/i18n.js` | Sprache der Seite und Übersetzungen (`tr()`) |
| `src/handoff.js` | Mitnehmen-Link |
| `src/textlink.js` | Text-Link für Chatbots und Agenten (`#text=…`) |
| `src/compose.js` | Satz-Einstellungen, die App und `agent/` teilen: Standardwerte, Prüfung, Optionen für den Satz, Dateiname |
| `agent/*`, `tools/build-agent.mjs` | Siebwrite für KI-Agenten: Kommandozeile, MCP-Server, Skill, Vorschaubild ohne Canvas; das ZIP zum Herunterladen |
| `ki/index.html`, `en/ai/index.html` | Seite „Mit KI“: Link-Vorlage für Chatbots, Skill zum Herunterladen, MCP |
| `src/sync.js` | Abgleich-Regeln: wer gewinnt, was hoch- und was runterkommt |
| `src/drive.js` | Google-Anmeldung (Token) und die Datei im App-Ordner von Google Drive |
| `src/cloud.js` | Konto oben rechts (Anmeldeknopf oder Profilbild mit Punkt für den Abgleich), Fenster zum An- und Abmelden, Abgleich nach Änderungen |
| `src/save.js` | Teilen-Menü oder Download |
| `src/goodnotes/*` | `.goodnotes`-Writer |

## Fertige Handschriften

Fünf Handschriften aus freien Einstrich-Schriften (Plotter-Schriften: jede Linie ein Strich, keine
Umrisse), deshalb in GoodNotes genauso radierbar wie die eigene. Erzeugt mit

```
npm pack hersheytext && tar xzf hersheytext-*.tgz
node tools/build-presets.mjs package/svg_fonts
```

Das Werkzeug skaliert jede Schrift auf die x-Höhe der Kästchen, zerlegt Kurven, staucht bei den
Schreibschriften Ober- und Unterlängen (sonst berühren sich die Zeilen) und kürzt Tabellenränder
von Ziffern. Die App (`src/presets.js`) lädt die Daten erst, wenn jemand „Setzen“ öffnet (ca. 33 KB
gzip), macht aus jedem Zeichen 2–4 leicht verzogene Varianten und setzt nach den Vorschüben der
Schrift statt nach dem Umriss: so bleibt Schreibschrift verbunden. Akzente (é, ñ, ç …) und
Sonderzeichen kommen aus der Schrift, das fehlende „§“ wird aus zwei S gebaut. Die Ids
(`cursive`, `elegant`, `quill`, `print`, `playful`) stehen in Einstellungen und Links: nicht ändern.
`app/?hand=cursive#setzen` öffnet die App gleich mit einer fertigen Handschrift. Lizenzen:
`THIRD_PARTY_NOTICES.md`, Texte in `licenses/`.

## Zwei Sprachen

Deutsch unter `/`, Englisch unter `/en/`. Die Sprache kommt aus `<html lang>`; dieselben Module
laufen auf beiden Seiten. Im Code stehen die Texte auf Deutsch in `tr('…')`, die englischen in `EN`
in `src/i18n.js`. Der Test sucht alle `tr('…')` in `src/` und `landing/` und schlägt fehl, wenn eine
Übersetzung fehlt. Die englischen HTML-Seiten sind übersetzte Kopien der deutschen; ein Test prüft,
dass beide dieselben Element-Ids haben. Wer also die deutsche Seite ändert, ändert die englische
mit. Auf Englisch sind die Umlaut-Kästchen (ä ö ü ß Ä Ö Ü) freiwillig: 80 statt 87 Zeichen, die
Schritte heißen `#write` und `#compose`. Beide Seiten verweisen per `hreflang` aufeinander.

## Das .goodnotes-Format

Nicht dokumentiert; der Aufbau folgt InkLift (siehe `THIRD_PARTY_NOTICES.md`).

- Die Datei ist ein ZIP mit unkomprimierten Einträgen.
- `notes/<Seiten-UUID>` ist der Strich-Stream der Seite: varint-längenpräfixierte
  Protobuf-Datensätze, pro Strich ein Kopf- und ein Inhaltsdatensatz.
- Die Punkte eines Strichs stecken als TPL-Abbild (`vuA(v)A(S(uu))A(S(uuuu))vA(f)`, Kugelschreiber)
  in einem Apple-LZ4-Rahmen (`bv41` … `bv4$`).
- Indizes und Ereignisprotokoll kommen aus einer geprüften Ein-Seiten-Vorlage. Für A4 wird die
  Seitengröße im Ereignisprotokoll umgeschrieben; das ist ungetestet, deshalb „Beta“.
- Der Seitenhintergrund ist ein eigenes PDF mit den Papierlinien (liniert, kariert, blanko). Die
  Vorlage stammt aus einem Heft auf Goodnotes' eingebautem Punktpapier; mit dessen Namen an der Seite
  zeigt Goodnotes sein Punktraster statt unseres PDFs. Deshalb fällt der Vorlagenname weg, der Anhang
  bekommt pro Datei eine eigene UUID und seine echte Größe im Ereignisprotokoll.
