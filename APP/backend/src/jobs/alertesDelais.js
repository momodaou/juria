// JURIA — job d'alertes de délais (J-30/J-15/J-7/J-1/J0).
// Extrait de routes/evenements.js le 18/08/2026 pour être appelable à la
// fois par la route existante (déclenchement manuel, authentifié) et par
// le nouveau point d'entrée planifié (routes/internal-jobs.js, appelé par
// Cloud Scheduler) — même logique, deux façons de la déclencher.
async function executerJobAlertesDelais(pool) {
  const { rows } = await pool.query(
    `SELECT e.id, e.titre, e.date_echeance, e.dossier_id, d.numero AS dossier_numero,
            e.responsable_id, (e.date_echeance::date - current_date) AS jours_restants,
            e.alerte_j30, e.alerte_j15, e.alerte_j7, e.alerte_j1, e.alerte_j0
     FROM evenements e JOIN dossiers d ON d.id = e.dossier_id
     WHERE e.statut = 'a_venir' AND e.date_echeance::date >= current_date`
  );
  const aNotifier = [];
  for (const e of rows) {
    const j = Number(e.jours_restants);
    let col = null;
    if (j === 0 && !e.alerte_j0) col = "alerte_j0";
    else if (j <= 1 && !e.alerte_j1) col = "alerte_j1";
    else if (j <= 7 && !e.alerte_j7) col = "alerte_j7";
    else if (j <= 15 && !e.alerte_j15) col = "alerte_j15";
    else if (j <= 30 && !e.alerte_j30) col = "alerte_j30";
    if (col) {
      await pool.query(`UPDATE evenements SET ${col} = true WHERE id = $1`, [e.id]);
      aNotifier.push({ id: e.id, dossier: e.dossier_numero, titre: e.titre, jours: j, seuil: col });
    }
  }
  // TODO (prod) : envoyer e-mail / notification interne pour chaque élément de aNotifier.
  return { traites: rows.length, notifies: aNotifier.length, details: aNotifier };
}

module.exports = { executerJobAlertesDelais };
