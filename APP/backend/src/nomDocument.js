// JURIA — nom d'une pièce de la GED (28/10/2026).
//
// Le nom affiché peut être choisi au téléversement et modifié ensuite ; le chemin dans
// le bucket (chemin_storage) ne change jamais. L'extension de la pièce est verrouillée :
// on ne peut ni la changer ni la retirer (sinon l'aperçu et l'ouverture se trompent de type).
const NOM_MAX = 240;

function extension(nom) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(String(nom || ""));
  return m ? m[0] : "";
}

function erreur(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// `souhaite` : nom saisi ; `reference` : nom du fichier d'origine (ou ancien nom du document).
// Renvoie le nom final, terminé par l'extension de `reference`.
function nomAvecExtension(souhaite, reference) {
  let nom = String(souhaite ?? "").replace(/[\u0000-\u001f\u007f\\/]+/g, " ").replace(/\s+/g, " ").trim();
  const ext = extension(reference);
  if (ext && nom.toLowerCase().endsWith(ext.toLowerCase())) nom = nom.slice(0, -ext.length).trim();
  if (!nom || nom === ".") throw erreur("Le nom du document ne peut pas être vide.");
  const complet = nom + ext;
  if (complet.length > NOM_MAX) throw erreur(`Le nom du document est trop long (${NOM_MAX} caractères au maximum, extension comprise).`);
  return complet;
}

module.exports = { nomAvecExtension, extension, NOM_MAX };
