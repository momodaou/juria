// JURIA — stock de chemises à rabat (20/10/2026). Le stock est la somme des
// mouvements ; ce module porte la correspondance couleur de dossier → couleur
// de chemise physique et la sortie d'une chemise à la création d'un dossier.

const COULEURS = ["bleu", "dore", "rouge", "vert", "violet"];

// Le gris (Conseil et divers) n'a pas de chemise physique. « jaune » et
// « orange » sont d'anciennes valeurs mortes fusionnées dans le doré (09/10/2026).
function couleurStock(couleurDossier) {
  if (!couleurDossier) return null;
  if (["jaune", "orange"].includes(couleurDossier)) return "dore";
  return COULEURS.includes(couleurDossier) ? couleurDossier : null;
}

// Sortie d'une chemise pour un dossier. Sans effet tant que le stock n'est pas
// initialisé (les dossiers antérieurs passent par la régularisation, après aperçu).
// Idempotente (index unique par dossier) ; ne bloque jamais la création du dossier en cas d'erreur.
async function deduireChemise(db, dossier, userId, motif = "Création du dossier") {
  try {
    const couleur = couleurStock(dossier.couleur_chemise);
    if (!couleur) return false;
    const r = await db.query(
      `INSERT INTO stock_chemises_mouvements (couleur, quantite, type, dossier_id, motif, cree_par)
       SELECT $1, -1, 'dossier', $2::uuid, $3, $4::uuid
       WHERE EXISTS (SELECT 1 FROM stock_chemises_mouvements WHERE type = 'initial')
       ON CONFLICT (dossier_id) WHERE type IN ('dossier','regularisation') AND dossier_id IS NOT NULL DO NOTHING`,
      [couleur, dossier.id, motif, userId || null]
    );
    return r.rowCount > 0;
  } catch (e) {
    console.error("Déduction de chemise impossible :", e.message);
    return false;
  }
}

async function etatStock(db) {
  const { rows } = await db.query(
    `SELECT s.couleur, s.seuil, COALESCE(sum(m.quantite), 0)::int AS quantite
     FROM stock_chemises_seuils s
     LEFT JOIN stock_chemises_mouvements m ON m.couleur = s.couleur
     GROUP BY s.couleur, s.seuil`
  );
  const ordre = Object.fromEntries(COULEURS.map((c, i) => [c, i]));
  return rows
    .map((r) => ({ ...r, bas: r.quantite <= r.seuil }))
    .sort((a, b) => ordre[a.couleur] - ordre[b.couleur]);
}

module.exports = { COULEURS, couleurStock, deduireChemise, etatStock };
