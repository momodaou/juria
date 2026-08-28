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

// Levée par readObject quand le fichier référencé en base n'existe plus
// dans le stockage — distinct d'une erreur serveur générique pour que les
// routes appelantes puissent renvoyer un 404 clair plutôt qu'un 500 muet
// (28/08/2026, diagnostic « aperçu GED ne fonctionne pas » : le cas réel
// rencontré était des documents chargés avant le correctif du 21/08/2026
// — GED_BUCKET absent, fichiers écrits sur le disque éphémère du conteneur
// puis perdus au redéploiement suivant — jamais distingué d'une panne).
class FichierIntrouvableError extends Error {}

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
    try {
      const [buf] = await bucket.file(name).download();
      return buf;
    } catch (e) {
      if (e.code === 404) throw new FichierIntrouvableError(`Objet absent du bucket : ${name}`);
      throw e;
    }
  }
  const p = cheminStorage.replace("file://", "");
  try {
    return fs.readFileSync(p);
  } catch (e) {
    if (e.code === "ENOENT") throw new FichierIntrouvableError(`Fichier absent du disque local : ${p}`);
    throw e;
  }
}

// Supprime un fichier stocké — tolérant à un objet déjà absent (28/08/2026,
// ajouté pour DELETE /api/documents/:id : ne doit jamais faire échouer la
// suppression de la LIGNE en base sous prétexte que le fichier physique
// avait déjà disparu, ex. le cas des documents perdus avant le correctif
// GED du 21/08/2026 — voir FichierIntrouvableError ci-dessus).
async function deleteObject(cheminStorage) {
  if (!cheminStorage) return;
  if (bucket && cheminStorage.startsWith("gs://")) {
    const name = cheminStorage.replace(`gs://${process.env.GED_BUCKET}/`, "");
    try {
      await bucket.file(name).delete();
    } catch (e) {
      if (e.code !== 404) throw e;
    }
    return;
  }
  const p = cheminStorage.replace("file://", "");
  try {
    fs.unlinkSync(p);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

module.exports = { saveObject, readObject, deleteObject, FichierIntrouvableError };
