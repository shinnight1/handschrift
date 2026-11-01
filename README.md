# Handschrift

Eigene Buchstaben mit Stift, Finger oder Maus erfassen, Text damit setzen und als echte,
radierbare `.goodnotes`-Datei oder als PDF ausgeben. Reines HTML, CSS und JavaScript: kein
Framework, kein Build-Schritt, keine Abhängigkeiten.

Seite: https://siebwrite.de/ (die alte Adresse https://shinnight1.github.io/handschrift/ leitet dorthin um).
Auf `/` liegt die Startseite, die App selbst unter `/app/`. Links mit `#gn…`, `#schreiben` oder
`#setzen` auf die Startseite leitet sie in die App weiter, damit ältere Links und das Artifact
weiter ankommen.

## So geht's

1. **Schreiben:** Jedes Kästchen zeigt ein Zeichen. Auf die Grundlinie schreiben. Nach dem ersten
   Durchgang (87 Zeichen) geht Setzen schon, weitere Varianten machen die Schrift lebendiger.
   Wer noch mehr Abwechslung will, schaltet „+ 5 Durchgänge“ dazu: noch fünfmal alles, freiwillig.
2. **Setzen:** Text eintippen, Format, Papier, Farbe und Abstände einstellen. „Mischen“ würfelt
   die Varianten neu. Steht oben „Fehlt: *“, führt ein Tipp darauf direkt zum Kästchen für das
   Zeichen. Zeichen, die nicht in der Liste sind (z. B. `*`, `#`, `§`), bekommen dabei ein eigenes
   Kästchen unter „Eigene Zeichen“.
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

prüft Mitnehmen-Link, Profil, Abgleich mit Google Drive, Satz, LZ4, TPL, die `.goodnotes`-Datei und
das PDF ohne Browser.

Für die Google-Anmeldung lokal muss `http://localhost:5190` in der Google Cloud Console beim
OAuth-Client unter „Autorisierte JavaScript-Quellen“ stehen.

Vor jedem Veröffentlichen:

```
node tools/version.mjs
```

zählt die Versionsnummer hoch, die an Stylesheets und an jedem Modul hängt (über eine Import Map in
`index.html` und `app/index.html`). GitHub Pages lässt Browser Dateien 10 Minuten zwischenspeichern;
ohne neue Nummer mischt der Browser neue und alte Module, und die App bleibt leer. Der Test schlägt
fehl, wenn ein Modul in der Import Map fehlt.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `landing/style.css` | Startseite, Farbwelt „Tinte und Papier“ (Blauschwarz, Papier, Königsblau) |
| `landing/sheet.js` | Blatt im Hero: Getipptes schreibt ein Füller sofort von Hand, sonst Beispiele |
| `landing/note.js` | Haftnotiz: Buchstaben des Getippten selbst schreiben; landen auf dem Blatt und beim Weg in die App als Kästchen |
| `landing/eraser.js` | „Radier ruhig“: eingefügter Text gegen Handschrift, die sich wegradieren lässt |
| `landing/playground.js` | „Jeder Buchstabe ein Regler“: Siebwrite als neun Spielzeuge für die Einstellungen der App (angeregt von inkandswitch.com) |
| `landing/scribble.js` | Handgeschriebene Wörter, Ziffern und Zettel, die sich beim Hinscrollen schreiben |
| `landing/film.js`, `landing/hand-font.js` | Film auf der Startseite: SVG-Szene, für jede Zeit berechnet; `Hand` schreibt Text in der Handschrift aus EMS Felix (`tools/build-hand-font.mjs`) |
| `datenschutz/index.html` | Datenschutzerklärung (auch für den Google-Zustimmungsbildschirm) |
| `og.png`, `tools/build-og-image.mjs` | Vorschaubild für geteilte Links (1200 × 630), ohne Abhängigkeiten gezeichnet: `node tools/build-og-image.mjs` |
| `app/index.html`, `style.css` | App und Aussehen |
| `src/app.js` | Steuerung beider Schritte |
| `src/charset.js` | welche Zeichen in welcher Reihenfolge erfasst werden |
| `src/draw.js` | Schreibkästchen, Stift-Erkennung, Rückgängig |
| `src/profile.js`, `src/store.js` | Profil, Glyphen-Maße, Speichern im Browser |
| `src/layout.js`, `src/random.js` | Text setzen, Varianten und Schwankungen |
| `src/render.js`, `src/pdf.js` | Vorschau, PDF, Papierlinien |
| `src/handoff.js` | Mitnehmen-Link |
| `src/sync.js` | Abgleich-Regeln: wer gewinnt, was hoch- und was runterkommt |
| `src/drive.js` | Google-Anmeldung (Token) und die Datei im App-Ordner von Google Drive |
| `src/cloud.js` | Knopf, Status und Fenster „Mit Google anmelden“, Abgleich nach Änderungen |
| `src/save.js` | Teilen-Menü oder Download |
| `src/goodnotes/*` | `.goodnotes`-Writer |

## Das .goodnotes-Format

Nicht dokumentiert; der Aufbau folgt InkLift (siehe `THIRD_PARTY_NOTICES.md`).

- Die Datei ist ein ZIP mit unkomprimierten Einträgen.
- `notes/<Seiten-UUID>` ist der Strich-Stream der Seite: varint-längenpräfixierte
  Protobuf-Datensätze, pro Strich ein Kopf- und ein Inhaltsdatensatz.
- Die Punkte eines Strichs stecken als TPL-Abbild (`vuA(v)A(S(uu))A(S(uuuu))vA(f)`, Kugelschreiber)
  in einem Apple-LZ4-Rahmen (`bv41` … `bv4$`).
- Indizes, Ereignisprotokoll und Seitenhintergrund (ein PDF mit den Papierlinien) kommen aus einer
  geprüften Ein-Seiten-Vorlage. Für A4 wird nur die Seitengröße im Ereignisprotokoll umgeschrieben;
  das ist ungetestet, deshalb „Beta“.
