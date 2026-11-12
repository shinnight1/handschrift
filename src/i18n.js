// Sprache: <html lang="en"> (Seiten unter /en/) → Englisch, sonst Deutsch. Die Texte stehen
// auf Deutsch im Code; tr() liefert auf der englischen Seite die Übersetzung aus EN.
// Platzhalter in geschweiften Klammern: tr('Seite {a} von {b}', { a: 1, b: 3 }).
// Fehlt eine Übersetzung, bleibt der deutsche Text (der Test prüft, dass keine fehlt).

const lang = typeof document !== 'undefined' && document.documentElement.lang.toLowerCase().startsWith('en') ? 'en' : 'de';

const EN = {
  // Allgemein
  'Handschrift': 'Handwriting',
  'Handschrift-Profil': 'Handwriting-Profile',
  'Meine Handschrift': 'My handwriting',
  'Rückgängig': 'Undo',
  'Zurückgeholt': 'Restored',
  'Abbrechen': 'Cancel',
  'Löschen': 'Delete',
  'Gelöscht': 'Deleted',
  'Alles löschen': 'Delete all',
  'Alle Felder löschen?': 'Delete all cells?',
  'Gesichert': 'Saved',
  'Gespeichert': 'Saved',
  'PDF gespeichert': 'PDF saved',
  '{n} Dateien gespeichert': '{n} files saved',
  'Speichern fehlgeschlagen': 'Saving failed',
  'Sichern fehlgeschlagen': 'Saving failed',
  'Datei nicht lesbar': 'File not readable',
  'Seite': 'Page',
  'Seite {a} von {b}': 'Page {a} of {b}',

  // Schreiben
  'Basis': 'Basics',
  'Varianten, freiwillig': 'Variants, optional',
  'Alles ausgefüllt.': 'All filled in.',
  'Alle Zeichen da. Varianten sind freiwillig.': 'Every character is there. Variants are optional.',
  'Jedes Zeichen einmal. Noch {n}.': 'Every character once. {n} to go.',
  'Zusatz-Durchgänge ausblenden': 'Hide extra rounds',
  '+ {n} Durchgänge für mehr Abwechslung': '+ {n} rounds for more variety',
  'Noch fünfmal alles, freiwillig': 'Five more rounds of everything, if you like',
  'Nichts rückgängig zu machen': 'Nothing to undo',
  'Kleinbuchstaben': 'Lowercase',
  'Großbuchstaben': 'Uppercase',
  'Ziffern': 'Digits',
  'Satzzeichen': 'Punctuation',
  '2. Variante': '2nd variant',
  '3. Variante': '3rd variant',
  '4. Variante': '4th variant',
  'Zusatz {a}/{b}': 'Extra {a}/{b}',
  'Eigene Zeichen': 'Extra characters',
  'Kästchen {n} ({char}) leeren': 'Clear cell {n} ({char})',
  'Feld leeren': 'Clear cell',
  'Schreibfeld für {char}': 'Writing cell for {char}',
  '{n} Felder geladen': '{n} cells loaded',
  '{n} Kästchen von deinen anderen Geräten dazu': '{n} cells added from your other devices',
  'Neuer Stand von einem anderen Gerät': 'Updated from another device',
  'Handschrift geladen': 'Handwriting loaded',

  // Mitnehmen
  'Noch nichts geschrieben': 'Nothing written yet',
  'Link kopiert: auf dem anderen Gerät öffnen': 'Link copied. Open it on your other device.',
  'Link ging nicht, „Sichern“ geht immer': "The link didn't work, but Save always does",
  'Der Link ist unvollständig. Am besten neu erzeugen und ganz kopieren.': 'The link is incomplete. Make a new one and copy all of it.',
  'Der Link ist beschädigt. Am besten neu erzeugen und ganz kopieren.': 'The link is damaged. Make a new one and copy all of it.',
  'Dieser Link ist von einer anderen Version.': 'This link is from a different version.',
  'Dieser Browser kann den Link nicht entpacken. Ein aktueller Browser hilft.': "This browser can't open the link. An up-to-date one can.",
  'Bisherige Handschrift ersetzt': 'Previous handwriting replaced',
  'Handschrift übernommen ({n} Felder). Sie ersetzt die bisherige auf diesem Gerät.': 'Handwriting received ({n} cells). It replaces the previous one on this device.',
  'Text aus dem Link übernommen': 'Text taken from the link',
  'Der Link ließ sich nicht lesen.': 'The link could not be read.',
  'Das ist keine Handschrift-Profildatei.': 'This is not a handwriting profile file.',
  'Die Profildatei ist von einer neueren Version.': 'The profile file is from a newer version.',

  // Setzen
  'Leeren': 'Clear',
  'Zurückholen': 'Restore',
  'Fehlt: {chars}': 'Missing: {chars}',
  'Fehlende Zeichen jetzt schreiben': 'Write the missing characters now',
  'Dieses Zeichen lässt sich nicht schreiben': "This character can't be written",
  'Hier schreiben, dann zurück zum Setzen': 'Write it here, then go back to Compose',
  'Im Teilen-Menü GoodNotes wählen.': 'Choose GoodNotes in the share menu.',
  'Lädt die .goodnotes-Datei herunter.': 'Downloads the .goodnotes file.',
  'Eine Datei pro Seite.': 'One file per page.',
  '{format} ist Beta.': '{format} is beta.',
  'Liniertes Papier gibt den Zeilenabstand vor': 'Ruled paper sets the line spacing',
  'Abgebrochen.': 'Cancelled.',

  // Arbeitsblatt
  'Arbeitsblatt': 'Worksheet',
  'Arbeitsblätter sind in GoodNotes noch Beta.': 'Worksheets are still beta in GoodNotes.',
  'Öffnen': 'Open',
  'Anderes': 'Change',
  'Öffne {name} …': 'Opening {name} …',
  'Seite {a} von {b} …': 'Page {a} of {b} …',
  'Nur die ersten {n} Seiten': 'Only the first {n} pages',
  'Der Browser speichert das Blatt nicht: Es bleibt nur bis zum Neuladen.': "This browser won't store the worksheet: it stays until you reload.",
  'Tippe auf eine Linie, und es entsteht ein Feld': 'Tap a line to make a field there',
  'Das Blatt ließ sich nicht öffnen.': "The worksheet couldn't be opened.",
  'Das Blatt ist zu groß für diesen Browser.': 'The worksheet is too large for this browser.',
  'Der PDF-Leser ließ sich nicht laden. Ist das Netz da?': "The PDF reader couldn't load. Are you online?",
  'Das PDF ist mit einem Passwort geschützt.': 'The PDF is password-protected.',
  'Das PDF ließ sich nicht öffnen.': "The PDF couldn't be opened.",
  'Das PDF hat keine Seiten.': 'The PDF has no pages.',
  'Das Bild ließ sich nicht öffnen. PDF, JPG oder PNG gehen.': "The image couldn't be opened. PDF, JPG or PNG work.",
  'Arbeitsblatt entfernt': 'Worksheet removed',
  'Feld {n}': 'Field {n}',
  'Feld {n}, Seite {p}': 'Field {n}, page {p}',
  'Text für Feld {n}': 'Text for field {n}',
  'Feld löschen': 'Delete field',
  'Feld {n} löschen': 'Delete field {n}',
  'Feld gelöscht': 'Field deleted',
  '{n} Feld ausgefüllt': '{n} field filled in',
  '{n} Felder ausgefüllt': '{n} fields filled in',
  'Nichts zum Verteilen gefunden': 'Found nothing to fill in',

  // Fertige Handschriften
  'Meine': 'Mine',
  'Noch nicht geschrieben': 'Not written yet',
  'Schreibschrift': 'Cursive',
  'Elegant': 'Elegant',
  'Feder': 'Quill',
  'Druckschrift': 'Print',
  'Verspielt': 'Playful',
  'Diese Handschrift hat das Zeichen nicht': "This handwriting doesn't have that character",
  'Fertige Handschriften ließen sich nicht laden. Ist das Netz da?': "Couldn't load the ready-made handwritings. Are you online?",

  // Farben
  'Schwarz': 'Black',
  'Kuli-Blau': 'Ballpoint blue',
  'Tinte': 'Ink',
  'Bleistift': 'Pencil',
  'Eigene Farbe': 'Custom color',
  'Eigene Farbe wählen': 'Pick your own color',

  // Google Drive
  'Nicht gespeichert: Speicher gesperrt': 'Not saved: storage blocked',
  'Gleiche ab': 'Syncing',
  'Gleiche gleich ab': 'Syncing shortly',
  'Nicht abgeglichen': 'Not synced',
  'Auf allen Geräten': 'On all your devices',
  'Mit Google anmelden': 'Sign in with Google',
  'Angemeldet': 'Signed in',
  'Abgemeldet': 'Signed out',
  'Abgeglichen': 'Synced',
  'Alles schon gleich': 'Already in sync',
  'dein Google-Konto': 'your Google account',
  'Kein Zugriff bei Google': 'No access at Google',
  'Google nicht erreichbar': 'Google unreachable',
  'Das Google-Fenster wurde blockiert. Pop-ups erlauben.': 'The Google window was blocked. Allow pop-ups.',
  'Das Google-Fenster wurde blockiert.': 'The Google window was blocked.',
  'Google ließ sich nicht laden. Ist das Netz da?': 'Google could not be loaded. Are you online?',
  'Google hat die Anmeldung abgelehnt.': 'Google declined the sign-in.',
  'Ohne den Zugriff geht die Anmeldung nicht.': "Signing in won't work without that access.",
  'Anmeldung abgebrochen.': 'Sign-in cancelled.',
  'Google ist noch nicht geladen.': "Google hasn't loaded yet.",
  'Google Drive nicht erreichbar.': 'Google Drive unreachable.',
  'Anmeldung abgelaufen.': 'Sign-in expired.',
  'Google Drive verweigert den Zugriff.': 'Google Drive denies access.',
  'Google Drive meldet Fehler {status}.': 'Google Drive reports error {status}.',
  'Die Kopie in Google Drive ist nicht lesbar.': 'The copy in Google Drive is not readable.',

  // Startseite: Haftnotiz, Radierer, Blatt
  'Schreib ein {char}': 'Write the {char}',
  'Fertig': 'Done',
  'Alles in deiner Schrift.': 'All in your handwriting.',
  'Steckt jetzt in jedem Wort.': "Now it's in every word.",
  'Schon auf dem Blatt.': 'Already on the sheet.',
  'Wisch über die Handschrift.': 'Swipe over the handwriting.',
  'Alles weg. Genau wie in GoodNotes.': 'All gone. Just like in GoodNotes.',
  '{n} Strich wegradiert.': '{n} stroke erased.',
  '{n} Striche wegradiert.': '{n} strokes erased.',
  'Blatt Papier, auf dem der getippte Text in Handschrift erscheint': 'A sheet of paper where whatever you type appears in handwriting',

  // Film
  'Abspielen': 'Play',
  'Pause': 'Pause',
};

function tr(text, vars) {
  let out = lang === 'en' ? (EN[text] ?? text) : text;
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return out;
}

export { lang, tr, EN };
