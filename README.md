# Handschrift

Eigene Buchstaben mit Stift, Finger oder Maus erfassen, Text damit setzen und als echte,
radierbare `.goodnotes`-Datei oder als PDF ausgeben. Reines HTML, CSS und JavaScript: kein
Framework, kein Build-Schritt, keine Abhängigkeiten.

Seite: https://shinnight1.github.io/handschrift/

## So geht's

1. **Schreiben:** Jedes Kästchen zeigt ein Zeichen. Auf die Grundlinie schreiben. Nach dem ersten
   Durchgang (87 Zeichen) geht Setzen schon, weitere Varianten machen die Schrift lebendiger.
2. **Setzen:** Text eintippen, Format, Papier, Farbe und Abstände einstellen. „Mischen“ würfelt
   die Varianten neu.
3. **Als GoodNotes importieren:** auf iPad und Handy öffnet sich das Teilen-Menü, dort GoodNotes
   wählen. Am PC wird die `.goodnotes`-Datei heruntergeladen. Jede Seite wird eine eigene Datei.

## Wo die Handschrift liegt

Nur im Browser des Geräts (localStorage), nirgends sonst. Auf ein anderes Gerät kommt sie so:

- **Mitnehmen:** erzeugt einen Link mit Handschrift, Text und Einstellungen. Auf iPad und Handy
  über das Teilen-Menü, am PC in die Zwischenablage. Auf dem anderen Gerät öffnen, fertig. Die
  Daten stehen komprimiert hinter dem `#`; diesen Teil schickt der Browser nie an den Server, und
  die Seite nimmt ihn nach dem Laden aus der Adresszeile. Der Link ersetzt die Handschrift auf
  dem Zielgerät.
- **Sichern / Laden:** dasselbe als Datei `Handschrift-Profil.json`.

Das Handschrift-Artifact auf claude.ai erzeugt dieselben Links (Format `v1` in `src/handoff.js`).

## Lokal starten und testen

```
node tools/serve.mjs
```

Dann http://localhost:5190/ öffnen. `file://` geht nicht, weil Browser ES-Module von dort
blockieren.

```
node --test
```

prüft Mitnehmen-Link, Profil, Satz, LZ4, TPL, die `.goodnotes`-Datei und das PDF ohne Browser.

## Aufbau

| Datei | Aufgabe |
| --- | --- |
| `index.html`, `style.css` | Seite und Aussehen |
| `src/app.js` | Steuerung beider Schritte |
| `src/charset.js` | welche Zeichen in welcher Reihenfolge erfasst werden |
| `src/draw.js` | Schreibkästchen, Stift-Erkennung, Rückgängig |
| `src/profile.js`, `src/store.js` | Profil, Glyphen-Maße, Speichern im Browser |
| `src/layout.js`, `src/random.js` | Text setzen, Varianten und Schwankungen |
| `src/render.js`, `src/pdf.js` | Vorschau, PDF, Papierlinien |
| `src/handoff.js` | Mitnehmen-Link |
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
