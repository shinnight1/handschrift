// Dateien an die Person geben: auf Touch-Geräten über das Teilen-Menü (dort
// steht GoodNotes zur Wahl), sonst als normaler Download.

const MIME = {
  pdf: 'application/pdf',
  json: 'application/json',
  goodnotes: 'application/octet-stream',
};

const isTouch = () => matchMedia('(pointer: coarse)').matches;

// list: [{name, bytes}]. Liefert 'shared' oder 'downloaded', wirft
// {code: 'declined'} beim Abbrechen. Alle Dateien gehen in einem Teilen-Menü
// raus: ein zweites ohne neuen Tipp lässt der Browser nicht zu.
async function saveFiles(list) {
  const files = list.map(({ name, bytes }) =>
    new File([bytes], name, { type: MIME[name.split('.').pop()] ?? 'application/octet-stream' }));
  if (isTouch() && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') throw { code: 'declined', message: 'Abgebrochen.' };
      // sonst normal herunterladen
    }
  }
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  return 'downloaded';
}

const saveFile = (filename, bytes) => saveFiles([{ name: filename, bytes }]);

// Liest eine vom Nutzer gewählte Datei als Text.
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export { isTouch, saveFile, saveFiles, readFileText };
