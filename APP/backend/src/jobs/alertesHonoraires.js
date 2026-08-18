// JURIA — job d'alertes honoraires (anti-dissimulation, ajout 18/08/2026).
// Repère les dossiers sous le seuil d'honoraires applicable (classique ou
// pro bono, voir routes/dossiers.js pour le même calcul) et notifie par
// paliers croissants d'audience : J+3 le responsable seul, J+7 + la
// direction (associés), J+15 + comptabilité/administration. Idempotent
// (colonnes booléennes par dossier) et sans notion d'"apporteur" distincte
// de dossiers.responsable_id, qui n'existe pas dans le schéma actuel.
//
// Persistance dans une table dédiée (alertes_honoraires) plutôt que dans
// le système de messagerie (conversations/messages, pensé pour le chat
// humain, auteur_id NOT NULL) — ce n'est pas une conversation. bus.publier()
// est réutilisé uniquement pour la poussée temps réel (SSE), pas pour
// l'écriture.
async function executerJobAlertesHonoraires(pool, bus) {
  const { rows: dossiers } = await pool.query(`
    SELECT d.id, d.numero, d.responsable_id,
           (current_date - d.date_ouverture) AS jours,
           d.alerte_honoraires_j3, d.alerte_honoraires_j7, d.alerte_honoraires_j15,
           COALESCE(fh.cumul_xof, 0) AS cumul_xof,
           (CASE WHEN d.pro_bono THEN p.frais_procedure_pro_bono_min_xof ELSE p.honoraires_min_xof END) AS seuil_xof
    FROM dossiers d
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(f.montant_ttc_xof), 0) AS cumul_xof
      FROM factures f WHERE f.dossier_id = d.id AND f.statut <> 'annulee'
    ) fh ON true
    CROSS JOIN parametres_cabinet p
    WHERE d.statut IN ('ouvert','en_cours') AND d.mode_honoraires IS DISTINCT FROM 'abonnement'
  `);

  const direction = await pool.query(
    "SELECT id FROM utilisateurs WHERE actif AND role IN ('associe','associe_fondateur')"
  );
  const finance = await pool.query(
    "SELECT id FROM utilisateurs WHERE actif AND role IN ('comptable','assistant_comptable','admin_general','admin_it')"
  );
  const directionIds = direction.rows.map((r) => r.id);
  const financeIds = finance.rows.map((r) => r.id);

  const resultats = [];
  for (const d of dossiers) {
    if (Number(d.cumul_xof) >= Number(d.seuil_xof)) continue; // seuil déjà atteint, rien à faire

    const jours = Number(d.jours);
    let palier = null;
    if (jours >= 15 && !d.alerte_honoraires_j15) palier = "j15";
    else if (jours >= 7 && !d.alerte_honoraires_j7) palier = "j7";
    else if (jours >= 3 && !d.alerte_honoraires_j3) palier = "j3";
    if (!palier) continue;

    // Si le job n'a pas tourné depuis un moment, un dossier peut franchir
    // plusieurs paliers d'un coup : on notifie une seule fois au palier le
    // plus haut (audience la plus large), et on marque aussi les paliers
    // inférieurs comme traités pour ne pas les redéclencher plus tard.
    const colonnes =
      palier === "j15" ? ["alerte_honoraires_j3", "alerte_honoraires_j7", "alerte_honoraires_j15"]
      : palier === "j7" ? ["alerte_honoraires_j3", "alerte_honoraires_j7"]
      : ["alerte_honoraires_j3"];
    await pool.query(
      `UPDATE dossiers SET ${colonnes.map((c) => `${c} = TRUE`).join(", ")} WHERE id = $1`,
      [d.id]
    );

    let destinataires = [d.responsable_id];
    if (palier === "j7" || palier === "j15") destinataires = [...new Set([...destinataires, ...directionIds])];
    if (palier === "j15") destinataires = [...new Set([...destinataires, ...financeIds])];

    for (const destId of destinataires) {
      await pool.query(
        "INSERT INTO alertes_honoraires (dossier_id, niveau, destinataire_id) VALUES ($1,$2,$3)",
        [d.id, palier, destId]
      );
    }
    if (bus) {
      await bus.publier(pool, destinataires, {
        type: "alerte_honoraires",
        dossier: { id: d.id, numero: d.numero },
        niveau: palier,
      });
    }
    resultats.push({ dossier: d.numero, niveau: palier, destinataires: destinataires.length });
  }
  return { traites: dossiers.length, notifies: resultats.length, details: resultats };
}

module.exports = { executerJobAlertesHonoraires };
