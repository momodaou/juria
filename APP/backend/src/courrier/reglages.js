// JURIA — Générateur de courriers (lot 1, 05/11/2026) : réglages du cabinet, cachet et signatures.
//
// - Les mesures du papier à en-tête sont des RÉGLAGES (table parametres_cabinet) : un écart constaté à
//   l'impression se corrige ici, sans modifier le code.
// - Le cachet et les signatures sont des PNG transparents stockés dans le bucket privé. Aucune route ne les
//   renvoie : seul le serveur les lit (lireCachet / lireSignature), au moment d'apposer (lot 5).
const { pool } = require("../db");
const { saveObject, readObject } = require("../storage");
const { MESURES } = require("./mesures");

const MAX_OCTETS = 2 * 1024 * 1024;       // 2 Mo
const MAX_PIXELS = 5000;                  // côté maximal
const CHEMIN_CACHET = "courrier/prive/cachet-cabinet.png";
const cheminSignature = (userId) => "courrier/prive/signature-" + userId + ".png";

// Réglages modifiables : colonne -> règle de validation (bornes larges : un mauvais chiffre ne doit pas déformer toute la mise en page).
const REGLAGES = {
  courrier_logo_defaut: { enum: ["mali", "std"] },
  courrier_decor: { bool: true },
  courrier_texte_x_page1_cm: { min: 4, max: 9, nom: "Retrait du texte (page 1)" },
  courrier_colonne_droite_cm: { min: 8, max: 14, nom: "Colonne de droite" },
  courrier_page1_haut_cm: { min: 2.5, max: 8, nom: "Première ligne (page 1)" },
  courrier_page1_bas_cm: { min: 20, max: 28.5, nom: "Dernière ligne (page 1)" },
  courrier_cachet_largeur_cm: { min: 3, max: 9, nom: "Largeur du cachet" },
};

function validerReglages(corps) {
  const valeurs = {};
  for (const [col, regle] of Object.entries(REGLAGES)) {
    if (corps[col] === undefined || corps[col] === null || corps[col] === "") continue;
    const v = corps[col];
    if (regle.enum) {
      if (!regle.enum.includes(v)) return { erreur: "Logo : valeurs permises " + regle.enum.join(", ") + "." };
      valeurs[col] = v;
    } else if (regle.bool) {
      valeurs[col] = v === true || v === "true";
    } else {
      const n = Number(v);
      if (!Number.isFinite(n) || n < regle.min || n > regle.max) {
        return { erreur: regle.nom + " : entre " + regle.min + " et " + regle.max + " cm." };
      }
      valeurs[col] = Math.round(n * 100) / 100;
    }
  }
  return { valeurs };
}

// PNG avec canal alpha (fond transparent), taille et dimensions bornées. Lit l'en-tête IHDR sans bibliothèque.
function validerPng(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) return { erreur: "Fichier vide ou illisible." };
  if (buffer.length > MAX_OCTETS) return { erreur: "Fichier trop lourd (2 Mo au maximum)." };
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.slice(0, 8).equals(signature)) return { erreur: "Format PNG requis (fond transparent)." };
  if (buffer.slice(12, 16).toString("latin1") !== "IHDR") return { erreur: "PNG invalide." };
  const largeur = buffer.readUInt32BE(16), hauteur = buffer.readUInt32BE(20), typeCouleur = buffer[25];
  if (!largeur || !hauteur || largeur > MAX_PIXELS || hauteur > MAX_PIXELS) return { erreur: "Dimensions hors limites (" + MAX_PIXELS + " px au maximum)." };
  if (typeCouleur !== 6 && typeCouleur !== 4) return { erreur: "Le PNG doit avoir un fond transparent (canal alpha)." };
  return { largeur, hauteur };
}

async function lireReglages(db = pool) {
  const { rows: [p] } = await db.query(
    "SELECT courrier_logo_defaut, courrier_decor, courrier_texte_x_page1_cm, courrier_colonne_droite_cm, " +
    "courrier_page1_haut_cm, courrier_page1_bas_cm, courrier_cachet_largeur_cm, " +
    "courrier_cachet_chemin IS NOT NULL AS cachet_present, courrier_cachet_maj_le " +
    "FROM parametres_cabinet WHERE id = 1");
  return {
    logo_defaut: p.courrier_logo_defaut,
    decor: p.courrier_decor,
    texte_x_page1_cm: Number(p.courrier_texte_x_page1_cm),
    colonne_droite_cm: Number(p.courrier_colonne_droite_cm),
    page1_haut_cm: Number(p.courrier_page1_haut_cm),
    page1_bas_cm: Number(p.courrier_page1_bas_cm),
    cachet_largeur_cm: Number(p.courrier_cachet_largeur_cm),
    cachet: { present: p.cachet_present, maj_le: p.courrier_cachet_maj_le },
  };
}

// Mesures effectives du moteur : valeurs par défaut du code, surchargées par les réglages du cabinet.
async function mesuresEffectives(db = pool) {
  const r = await lireReglages(db);
  return {
    ...MESURES,
    page1: { ...MESURES.page1, texteX: r.texte_x_page1_cm, haut: r.page1_haut_cm, bas: r.page1_bas_cm },
    droiteX: r.colonne_droite_cm,
    cachet: { largeur: r.cachet_largeur_cm },
  };
}

async function lireCachet(db = pool) {
  const { rows: [p] } = await db.query("SELECT courrier_cachet_chemin AS c FROM parametres_cabinet WHERE id = 1");
  return p && p.c ? readObject(p.c) : null;
}
async function lireSignature(userId, db = pool) {
  const { rows: [u] } = await db.query("SELECT signature_chemin AS c FROM utilisateurs WHERE id = $1::uuid", [userId]);
  return u && u.c ? readObject(u.c) : null;
}

async function deposerCachet(buffer, db = pool) {
  const chemin = await saveObject(buffer, CHEMIN_CACHET, "image/png");
  await db.query("UPDATE parametres_cabinet SET courrier_cachet_chemin = $1, courrier_cachet_maj_le = now() WHERE id = 1", [chemin]);
}
async function deposerSignature(userId, buffer, db = pool) {
  const chemin = await saveObject(buffer, cheminSignature(userId), "image/png");
  await db.query("UPDATE utilisateurs SET signature_chemin = $1, signature_maj_le = now() WHERE id = $2::uuid", [chemin, userId]);
}

module.exports = {
  REGLAGES, validerReglages, validerPng, lireReglages, mesuresEffectives,
  lireCachet, lireSignature, deposerCachet, deposerSignature, MAX_OCTETS,
};
