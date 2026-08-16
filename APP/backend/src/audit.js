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

module.exports = { logAudit };
