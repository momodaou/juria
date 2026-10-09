// JURIA — journal d'audit (traçabilité des connexions et actions sensibles).
// Best-effort : une erreur d'écriture du journal ne doit jamais faire échouer
// l'action métier elle-même.
const { pool } = require("./db");

async function logAudit({ utilisateurId, action, entite, entiteId, details, ip }) {
  try {
    await pool.query(
      `INSERT INTO journal_audit (utilisateur_id, action, entite, entite_id, details, adresse_ip)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [utilisateurId || null, action, entite || null, entiteId || null,
       details ? JSON.stringify(details) : null, ip || null]
    );
  } catch (e) {
    console.error("Écriture du journal d'audit impossible :", e.message);
  }
}

// Calcule les champs réellement modifiés entre deux lectures d'une même
// ligne (09/10/2026, traçabilité procédurale — voir CLAUDE.md) : compare
// uniquement les colonnes listées dans `champs`, ignore un champ absent
// des deux côtés, et rend { champ: { avant, apres } } — vide si rien n'a
// changé (l'appelant ne journalise alors rien, pour ne pas polluer le
// journal d'une écriture qui n'a en réalité rien touché).
function diffChamps(avant, apres, champs) {
  const changements = {};
  for (const c of champs) {
    const v1 = avant?.[c] ?? null;
    const v2 = apres?.[c] ?? null;
    if (String(v1) !== String(v2)) changements[c] = { avant: v1, apres: v2 };
  }
  return changements;
}

module.exports = { logAudit, diffChamps };
