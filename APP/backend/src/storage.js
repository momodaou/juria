// JURIA — stockage des fichiers de la GED.
// En production : Google Cloud Storage (variable GED_BUCKET + identifiants ADC).
// En local / dev : repli sur le disque (dossier backend/uploads).
const fs = require("fs");
const path = require("path");

let bucket = null;
if (process.env.GED_BUCKET) {
  try {
    const { Storage } = require("@google-cloud/storage");
    bucket = new Storage().bucket(process.env.GED_BUCKET);
  } catch (e) {
    console.warn("Cloud Storage indisponible, repli local :", e.message);
  }
}

const LOCAL_DIR = path.join(__dirname, "..", "uploads");

// Enregistre un fichier ; renvoie le chemin de stockage (gs://... ou file://...)
async function saveObject(buffer, destName, mime) {
  if (bucket) {
    const file = bucket.file(destName);
    await file.save(buffer, { contentType: mime, resumable: false });
    return `gs://${process.env.GED_BUCKET}/${destName}`;
  }
  fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const local = path.join(LOCAL_DIR, destName.replace(/[\/\\]/g, "_"));
  fs.writeFileSync(local, buffer);
  return `file://${local}`;
}

// Lit un fichier stocké ; renvoie un Buffer (comportement uniforme GCS / local)
async function readObject(cheminStorage) {
  if (bucket && cheminStorage.startsWith("gs://")) {
    const name = cheminStorage.replace(`gs://${process.env.GED_BUCKET}/`, "");
    const [buf] = await bucket.file(name).download();
    return buf;
  }
  const p = cheminStorage.replace("file://", "");
  return fs.readFileSync(p);
}

module.exports = { saveObject, readObject };
