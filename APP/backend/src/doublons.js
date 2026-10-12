// JURIA — "Doublons potentiels", filet de sécurité transverse (26/09/2026,
// audit doublons phase 5). Extrait de routes/dashboard.js le 12/10/2026 pour
// être réutilisé aussi par jobs/alertesDoublons.js — même principe que
// facturationDiscipline.js/abonnements.js/instanceActuelle.js : un seul
// calcul partagé, jamais recopié entre la tuile Tableau de bord et le job
// d'escalade e-mail.
//
// Rassemble, en une seule requête, les groupes de lignes probablement
// identiques déjà entrées dans les tables couvertes par les avertissements
// de doublon non bloquants (`verifier-doublon`, phases 1-4 de l'audit du
// 26/09/2026). `factures` en est volontairement absente (aucune clé
// naturelle fiable, voir l'audit d'origine). Normalisation espace/tiret sur
// les noms, même règle que GET /api/clients/verifier-doublon.
//
// 12/10/2026 — gap signalé par l'utilisateur (« toujours des problèmes de
// doublons... dossiers, clients ») : ni `dossiers` ni `clients` n'étaient
// couverts par ce filet de sécurité, alors qu'un incident réel les
// concernait tous les deux (CX-SOC-2026-0002/0003, « Cabinet CADET »
// dupliqué le 01/10/2026). Ajout de 2 catégories, même esprit « signale,
// ne bloque jamais » que le reste de ce fichier :
// - 'Client' : même nom normalisé (espace/tiret/casse ignorés) entre 2
//   fiches client — la cause racine la plus fréquente, un doublon de
//   dossier venant souvent d'un doublon de client en amont.
// - 'Dossier' : même client ET même matière sur plusieurs dossiers — signal
//   volontairement large (un vrai cabinet peut avoir plusieurs affaires
//   distinctes dans la même matière pour le même client), laissé à
//   l'appréciation de qui consulte la tuile, jamais un blocage.
const DOUBLONS_CTE = `
  WITH doublons AS (
    SELECT 'Partie de dossier'::text AS categorie, dp.dossier_id, d.numero AS dossier_numero,
           (dp.role::text || ' — ' || MIN(dp.denomination)) AS description, count(*) AS nb
    FROM dossier_parties dp JOIN dossiers d ON d.id = dp.dossier_id
    GROUP BY dp.dossier_id, d.numero, dp.role, regexp_replace(lower(dp.denomination), '[\\s\\-.,]', '', 'g')
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Instance', i.dossier_id, d.numero,
           (i.degre::text || ' — ' || COALESCE(i.juridiction, '—')), count(*)
    FROM instances i JOIN dossiers d ON d.id = i.dossier_id
    GROUP BY i.dossier_id, d.numero, i.degre, i.juridiction
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Audience', l.dossier_id, d.numero,
           ('Le ' || to_char(l.date_prevue, 'DD/MM/YYYY') || ' — ' || COALESCE(l.juridiction, '—')), count(*)
    FROM role_audience_lignes l JOIN dossiers d ON d.id = l.dossier_id
    GROUP BY l.dossier_id, d.numero, l.date_prevue, l.juridiction
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Dépense', dep.dossier_id, dos.numero,
           (dep.libelle || ' — ' || dep.montant::text || ' FCFA'), count(*)
    FROM depenses dep LEFT JOIN dossiers dos ON dos.id = dep.dossier_id
    GROUP BY dep.dossier_id, dos.numero, dep.libelle, dep.montant, dep.date_depense
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Rétrocession', r.dossier_id, d2.numero,
           (r.qualite::text || ' — ' || r.base_ht::text || ' FCFA'), count(*)
    FROM retrocessions r LEFT JOIN dossiers d2 ON d2.id = r.dossier_id
    GROUP BY r.dossier_id, d2.numero, r.beneficiaire_id, r.qualite, r.base_ht, r.facture_id
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Lien client', NULL::uuid, NULL::varchar,
           ('Lien client — ' || cl.nature), count(*)
    FROM client_liens cl
    GROUP BY cl.client_id, cl.lie_a_id, cl.nature
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Compte bancaire', NULL::uuid, NULL::varchar, cb.intitule, count(*)
    FROM comptes_bancaires cb
    GROUP BY cb.intitule
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Congé', NULL::uuid, NULL::varchar,
           (u.prenom || ' ' || u.nom || ' — du ' || to_char(c.date_debut, 'DD/MM/YYYY') || ' au ' || to_char(c.date_fin, 'DD/MM/YYYY')), count(*)
    FROM conges c JOIN utilisateurs u ON u.id = c.utilisateur_id
    GROUP BY c.utilisateur_id, u.prenom, u.nom, c.date_debut, c.date_fin
    HAVING count(*) > 1
    UNION ALL
    -- 26/09/2026 — vérifié sur données réalistes : les 3 échéances IS
    -- (acomptes provisionnels, même libellé/catégorie par design — voir
    -- CLAUDE.md 11/09/2026) ressortaient comme un faux positif permanent.
    -- prochaine_date (colonne brute, pas recalculée à la lecture comme le
    -- fait l'écran via calculerProchaineEcheance()) s'est révélée peu
    -- fiable pour les distinguer — 2 des 3 échéances IS réelles partagent
    -- la même valeur brute en base malgré des ancrages différents. Utilise
    -- plutôt jour_echeance/mois_echeance, le véritable ancrage saisi par
    -- l'utilisateur (un vrai doublon partage presque toujours aussi son
    -- ancrage, contrairement à des échéances récurrentes légitimement
    -- homonymes).
    SELECT 'Échéance administrative', NULL::uuid, NULL::varchar,
           (ea.libelle || ' — ' || ea.categorie), count(*)
    FROM echeances_administratives ea WHERE ea.actif = TRUE
    GROUP BY ea.libelle, ea.categorie, ea.jour_echeance, ea.mois_echeance
    HAVING count(*) > 1
    UNION ALL
    SELECT 'Diligence', dl.dossier_id, d3.numero,
           (dl.type_diligence || ' — ' || to_char(dl.date_diligence, 'DD/MM/YYYY')), count(*)
    FROM diligences dl LEFT JOIN dossiers d3 ON d3.id = dl.dossier_id
    GROUP BY dl.dossier_id, d3.numero, dl.date_diligence, dl.type_diligence
    HAVING count(*) > 1
    UNION ALL
    -- 12/10/2026 : même nom normalisé sur 2 fiches client (quel que soit
    -- le type) — même règle de normalisation que
    -- GET /api/clients/verifier-doublon. dossier_id/dossier_numero à NULL
    -- (plusieurs clients concernés, pas un seul dossier), comme
    -- 'Compte bancaire'/'Congé'/'Lien client' ci-dessus.
    SELECT 'Client', NULL::uuid, NULL::varchar,
           MIN(COALESCE(NULLIF(cl.denomination, ''), cl.prenom || ' ' || cl.nom)), count(*)
    FROM clients cl
    WHERE regexp_replace(lower(COALESCE(NULLIF(cl.denomination, ''), TRIM(COALESCE(cl.prenom,'') || ' ' || COALESCE(cl.nom,'')))), '[\\s\\-.,]', '', 'g') <> ''
    GROUP BY regexp_replace(lower(COALESCE(NULLIF(cl.denomination, ''), TRIM(COALESCE(cl.prenom,'') || ' ' || COALESCE(cl.nom,'')))), '[\\s\\-.,]', '', 'g')
    HAVING count(*) > 1
    UNION ALL
    -- 12/10/2026 : même client ET même matière sur plusieurs dossiers (le
    -- cas réel CX-SOC-2026-0002/0003). Signal volontairement large — un
    -- cabinet peut légitimement avoir 2 affaires distinctes dans la même
    -- matière pour le même client — laissé à l'appréciation humaine,
    -- jamais bloqué. dossier_id à NULL (plusieurs dossiers concernés).
    SELECT 'Dossier', NULL::uuid, NULL::varchar,
           ('Même client, même matière — ' || string_agg(d4.numero, ', ' ORDER BY d4.numero)), count(*)
    FROM dossiers d4
    WHERE d4.code_matiere IS NOT NULL
    GROUP BY d4.client_id, d4.code_matiere
    HAVING count(*) > 1
  )
`;

module.exports = { DOUBLONS_CTE };
