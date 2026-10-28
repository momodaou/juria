// JURIA — numérotation du registre du courrier (extrait de routes/courriers.js le 28/10/2026
// pour être partagé avec l'Atelier d'actes : un acte « courrier départ » réserve son numéro
// dans le même registre, avec la même règle et le même verrou).
// Génère la référence ARR-2026-000123 / DEP-2026-000045 (par sens + année).
async function genererReference(client, sens, dateCourrier) {
  const prefixe = sens === "arrivee" ? "ARR" : "DEP";
  const annee = new Date(dateCourrier || Date.now()).getFullYear();
  // 21/10/2026 — « plus grand numéro + 1 » (et non « nombre de courriers + 1 ») + verrou de
  // transaction : même défaut que les numéros de dossier et de facture (doublon après suppression
  // ou lors de deux enregistrements simultanés).
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`reference_courrier_${sens}`]);
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(substring(reference from '-([0-9]+)$') AS integer)), 0) + 1 AS n
     FROM courriers WHERE reference LIKE $1`,
    [`${prefixe}-${annee}-%`]
  );
  return `${prefixe}-${annee}-${String(rows[0].n).padStart(6, "0")}`;
}

module.exports = { genererReference };
