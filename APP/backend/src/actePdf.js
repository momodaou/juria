// JURIA — Génération du PDF d'un acte (Atelier d'actes, 13/09/2026).
//
// Contexte : jusqu'ici un acte généré n'avait aucun rendu « papier » —
// juste un fichier .txt brut en GED, affiché en <pre> à l'écran. Même
// choix technique que facturePdf.js (pdfkit, dessin direct, pas de
// navigateur headless) mais bien plus simple : pas de tableau de montants,
// juste un en-tête cabinet + le texte libre de l'acte, tel qu'édité.
//
// Générée à la volée à chaque téléchargement (GET /api/actes/:id/pdf),
// PAS persistée en GED — le texte source (documents.ocr_texte) reste la
// seule version faisant foi, modifiable ensuite ; le PDF n'est qu'une
// vue imprimable du texte courant à l'instant du téléchargement.
const path = require("path");
const PDFDocument = require("pdfkit");

const LOGO_PATH = path.join(__dirname, "../assets/logo-jfc.png");

// Même palette que facturePdf.js (extraite du logo du cabinet) — dupliquée
// plutôt qu'importée pour garder les deux générateurs PDF indépendants
// (aucun des deux n'a besoin de l'autre pour fonctionner).
const STYLE = {
  bleu: "#005DAC",
  orange: "#DB8B2D",
  texte: "#1a1a1a",
  gris: "#555555",
  grisClair: "#888888",
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

function fmtDateLettres(d) {
  const date = new Date(d);
  return `${date.getDate()} ${MOIS[date.getMonth()]} ${date.getFullYear()}`;
}

async function chargerDonnees(pool, docId) {
  const r = await pool.query(
    `SELECT doc.id, doc.nom, doc.categorie, doc.statut, doc.version, doc.ocr_texte, doc.cree_le, doc.modifie_le,
            doc.dossier_id, d.numero AS dossier_numero, d.intitule AS dossier_intitule,
            aut.prenom || ' ' || aut.nom AS auteur
     FROM documents doc
     JOIN dossiers d ON d.id = doc.dossier_id
     LEFT JOIN utilisateurs aut ON aut.id = COALESCE(doc.modifie_par, doc.auteur_id)
     WHERE doc.id = $1`,
    [docId]
  );
  if (!r.rows[0]) return null;
  const acte = r.rows[0];
  const cab = await pool.query("SELECT * FROM parametres_cabinet WHERE id = 1");
  return { acte, cab: cab.rows[0] || {} };
}

// Pure fonction (doc, données) -> contenu PDF — aucun accès base/réseau,
// même esprit que dessinerFacture() dans facturePdf.js.
function dessinerActe(doc, { acte, cab }) {
  const xLabel = 50, largeurPage = 495;

  const yHeader = 42;
  try {
    doc.image(LOGO_PATH, xLabel, yHeader, { width: 80 });
  } catch (e) {
    // Pas de logo trouvé (environnement de test, etc.) : jamais bloquant.
  }
  doc.fontSize(8).font("Helvetica").fillColor(STYLE.grisClair);
  const detailsCabinet = [cab.forme, cab.adresse, [cab.telephone, cab.email].filter(Boolean).join(" — ")].filter(Boolean);
  let yDetail = yHeader + 48;
  for (const ligne of detailsCabinet) { doc.text(ligne, xLabel, yDetail, { width: 320 }); yDetail += 11; }
  doc.fillColor(STYLE.texte);

  doc.fontSize(9).font("Helvetica").fillColor(STYLE.gris)
    .text(`Bamako, le ${fmtDateLettres(acte.modifie_le || acte.cree_le)}`, xLabel, yHeader + 3, { width: largeurPage, align: "right" });
  doc.fillColor(STYLE.texte);

  const yFilet = Math.max(yHeader + 48, yDetail) + 6;
  doc.rect(xLabel, yFilet, largeurPage * 0.62, 2.5).fill(STYLE.bleu);
  doc.rect(xLabel + largeurPage * 0.62, yFilet, largeurPage * 0.38, 2.5).fill(STYLE.orange);
  doc.fillColor(STYLE.texte);
  doc.y = yFilet + 12;

  doc.fontSize(8).font("Helvetica").fillColor(STYLE.grisClair)
    .text(`Réf. dossier : ${acte.dossier_numero} — ${acte.dossier_intitule}`, xLabel, doc.y, { width: largeurPage });
  doc.fillColor(STYLE.texte);
  doc.moveDown(1);

  // Corps libre de l'acte, tel qu'édité — aucune mise en forme imposée
  // au-delà de la police/marges (l'auteur maîtrise la structure du texte).
  doc.fontSize(10).font("Helvetica").text(acte.ocr_texte || "", xLabel, doc.y, { width: largeurPage, align: "left" });
}

async function envoyerActePdf(pool, docId, res) {
  const donnees = await chargerDonnees(pool, docId);
  if (!donnees) return false;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${donnees.acte.nom.replace(/[^\w.-]/g, "_")}.pdf"`);

  const doc = new PDFDocument({ size: "A4", margin: 50, compress: false });
  doc.pipe(res);
  dessinerActe(doc, donnees);
  doc.end();
  return true;
}

module.exports = { envoyerActePdf, chargerDonnees, dessinerActe, STYLE };
