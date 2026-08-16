-- =====================================================================
--  JURIA — Application de gestion de cabinet & de pratique juridique
--  JFC AVOCATS MALI
--  Schéma de base de données — MVP (PostgreSQL 15+)
--  Version 1.0 — 8 juillet 2026
-- ---------------------------------------------------------------------
--  Périmètre MVP : Utilisateurs/rôles · Clients + KYC + conflits ·
--  Dossiers + parties + intervenants · GED · Échéances/délais · Tâches ·
--  Temps & facturation · Communications · Journal d'audit.
--  Devise par défaut : FCFA (XOF). Montants stockés en entiers (pas de
--  centimes en usage courant au Mali) via NUMERIC(14,0).
-- =====================================================================

BEGIN;

-- Extensions ----------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";      -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "unaccent";      -- recherche sans accents
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- recherche floue / plein texte

-- =====================================================================
--  TYPES ÉNUMÉRÉS
-- =====================================================================
CREATE TYPE role_utilisateur AS ENUM
  ('associe','collaborateur','stagiaire','assistante','comptable','admin');

CREATE TYPE type_client AS ENUM ('physique','morale');

CREATE TYPE statut_kyc AS ENUM ('a_faire','a_jour','piece_expiree','incomplet');

CREATE TYPE pole_cabinet AS ENUM ('conseil','contentieux');

CREATE TYPE urgence_niveau AS ENUM ('basse','moyenne','haute');

CREATE TYPE statut_dossier AS ENUM ('ouvert','en_cours','suspendu','clos','archive');

CREATE TYPE phase_procedurale AS ENUM
  ('consultation','ouverture','mise_en_etat','plaidoirie','decision',
   'execution','recours','cloture');

CREATE TYPE role_partie AS ENUM ('adverse','tiers','conseil_adverse','co_demandeur','co_defendeur');

CREATE TYPE resultat_conflit AS ENUM ('absence','potentiel','avere');
CREATE TYPE decision_conflit AS ENUM ('en_attente','accepte','refuse','oriente');

CREATE TYPE categorie_document AS ENUM
  ('correspondance','piece_client','contrat','conclusions','decision',
   'courrier_officiel','facture','note_interne','recherche','autre');

CREATE TYPE statut_document AS ENUM ('brouillon','valide','signe','archive');

CREATE TYPE confidentialite AS ENUM ('dossier','equipe','interne','restreint');

CREATE TYPE type_evenement AS ENUM
  ('audience','rendez_vous','delai_procedure','delai_recours',
   'echeance_contractuelle','depot','relance_client','prescription');

CREATE TYPE statut_evenement AS ENUM ('a_venir','traite','reporte','annule');

CREATE TYPE type_tache AS ENUM
  ('recherche','redaction','revue','depot','appel_client','facturation',
   'relance','collecte_pieces','autre');

CREATE TYPE priorite_tache AS ENUM ('basse','normale','haute','urgente');
CREATE TYPE statut_tache AS ENUM ('a_faire','en_cours','a_valider','termine','annule');

CREATE TYPE mode_honoraires AS ENUM
  ('forfait','temps_passe','success_fee','abonnement','consultation');

CREATE TYPE statut_facture AS ENUM ('brouillon','emise','partielle','payee','impayee','annulee');
CREATE TYPE mode_paiement AS ENUM
  ('virement','cheque','especes','orange_money','moov_money','wave','sama_money',
   'western_union','moneygram','virement_etranger','mobile_money','autre');

CREATE TYPE type_communication AS ENUM ('email','courrier','appel','whatsapp','reunion','note');

-- =====================================================================
--  UTILISATEURS & PERMISSIONS
-- =====================================================================
CREATE TABLE utilisateurs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code            VARCHAR(8)  UNIQUE NOT NULL,         -- ex. « FCa » (1re du prénom + 2 du nom)
    prenom          VARCHAR(80) NOT NULL,
    nom             VARCHAR(80) NOT NULL,
    email           VARCHAR(160) UNIQUE NOT NULL,
    mot_de_passe    VARCHAR(255) NOT NULL,               -- hash (bcrypt/argon2)
    role            role_utilisateur NOT NULL,
    pole            pole_cabinet,                        -- pôle d'animation (associés)
    taux_horaire    NUMERIC(14,0) DEFAULT 0,             -- FCFA HT
    mfa_actif       BOOLEAN NOT NULL DEFAULT FALSE,
    actif           BOOLEAN NOT NULL DEFAULT TRUE,
    derniere_connexion TIMESTAMPTZ,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    maj_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE utilisateurs IS 'Membres du cabinet ; rôle déterminant les permissions.';

-- =====================================================================
--  CLIENTS, KYC & LIENS
-- =====================================================================
CREATE TABLE clients (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference       VARCHAR(20) UNIQUE,                  -- code client interne
    type            type_client NOT NULL,
    -- personne morale
    denomination    VARCHAR(200),
    rccm            VARCHAR(60),
    nif             VARCHAR(60),
    forme_juridique VARCHAR(80),
    -- personne physique
    prenom          VARCHAR(120),
    nom             VARCHAR(120),
    nationalite     VARCHAR(80),
    -- coordonnées communes
    email           VARCHAR(160),
    telephone       VARCHAR(60),
    adresse         TEXT,
    ville           VARCHAR(80),
    pays            VARCHAR(80) DEFAULT 'Mali',
    -- KYC
    kyc_statut      statut_kyc NOT NULL DEFAULT 'a_faire',
    kyc_maj_le      DATE,
    beneficiaires_effectifs TEXT,
    notes           TEXT,
    cree_par        UUID REFERENCES utilisateurs(id),
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    maj_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_identite CHECK (
        (type = 'morale'  AND denomination IS NOT NULL) OR
        (type = 'physique' AND nom IS NOT NULL)
    )
);
CREATE INDEX idx_clients_nom ON clients USING gin ((coalesce(denomination,'') || ' ' || coalesce(nom,'') || ' ' || coalesce(prenom,'')) gin_trgm_ops);

-- Documents d'identité / KYC rattachés au client
CREATE TABLE client_pieces_kyc (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    libelle      VARCHAR(160) NOT NULL,          -- ex. « Passeport », « Statuts », « RCCM »
    chemin_storage VARCHAR(500),                 -- objet Cloud Storage
    date_expiration DATE,
    cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Liens entre personnes/sociétés (groupes, représentants, dirigeants)
CREATE TABLE client_liens (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    lie_a_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    nature       VARCHAR(80) NOT NULL,           -- « filiale », « dirigeant », « représentant »...
    cree_le      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_lien_distinct CHECK (client_id <> lie_a_id)
);

-- =====================================================================
--  DOSSIERS, PARTIES & INTERVENANTS
-- =====================================================================
CREATE TABLE dossiers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero          VARCHAR(30) UNIQUE NOT NULL,         -- ex. AFF-26-018 (pôle-année-ordre)
    intitule        VARCHAR(240) NOT NULL,
    client_id       UUID NOT NULL REFERENCES clients(id),
    pole            pole_cabinet NOT NULL,
    matiere         VARCHAR(120),                        -- sous-pôle / matière
    source_droit    VARCHAR(120),                        -- national, OHADA, UEMOA, CEDEAO...
    juridiction     VARCHAR(160),
    numero_role     VARCHAR(60),                          -- n° RG / rôle
    pays            VARCHAR(80) DEFAULT 'Mali',
    objet           TEXT,
    montant_litige  NUMERIC(14,0),                       -- FCFA
    devise          CHAR(3) NOT NULL DEFAULT 'XOF',
    mode_honoraires mode_honoraires,
    statut          statut_dossier NOT NULL DEFAULT 'ouvert',
    phase           phase_procedurale NOT NULL DEFAULT 'ouverture',
    urgence         urgence_niveau NOT NULL DEFAULT 'moyenne',
    responsable_id  UUID NOT NULL REFERENCES utilisateurs(id),
    date_ouverture  DATE NOT NULL DEFAULT current_date,
    date_cloture    DATE,
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now(),
    maj_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dossiers_client   ON dossiers(client_id);
CREATE INDEX idx_dossiers_statut   ON dossiers(statut);
CREATE INDEX idx_dossiers_resp     ON dossiers(responsable_id);
CREATE INDEX idx_dossiers_urgence  ON dossiers(urgence);

-- Parties adverses / tiers du dossier
CREATE TABLE dossier_parties (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id   UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    role         role_partie NOT NULL,
    denomination VARCHAR(200) NOT NULL,
    client_lie_id UUID REFERENCES clients(id),          -- si la partie est aussi une fiche connue
    conseil      VARCHAR(200),
    cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_parties_dossier ON dossier_parties(dossier_id);
CREATE INDEX idx_parties_nom ON dossier_parties USING gin (denomination gin_trgm_ops);

-- Équipe affectée au dossier
CREATE TABLE dossier_intervenants (
    dossier_id   UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    role_dossier VARCHAR(60) NOT NULL DEFAULT 'collaborateur',
    PRIMARY KEY (dossier_id, utilisateur_id)
);

-- =====================================================================
--  VÉRIFICATION DES CONFLITS D'INTÉRÊTS (conflict check)
-- =====================================================================
CREATE TABLE conflict_checks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id    UUID REFERENCES dossiers(id) ON DELETE SET NULL,  -- rempli si dossier créé
    intitule_projet VARCHAR(240),                       -- avant création du dossier
    noms_recherches TEXT NOT NULL,                       -- client, adverses, liés
    resultat      resultat_conflit NOT NULL,
    details       TEXT,                                  -- rapprochements trouvés
    decision      decision_conflit NOT NULL DEFAULT 'en_attente',
    motif         TEXT,
    decide_par    UUID REFERENCES utilisateurs(id),      -- associé
    decide_le     TIMESTAMPTZ,
    cree_par      UUID REFERENCES utilisateurs(id),
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conflict_dossier ON conflict_checks(dossier_id);

-- =====================================================================
--  GESTION DOCUMENTAIRE (GED)
-- =====================================================================
CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id    UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    nom           VARCHAR(240) NOT NULL,
    categorie     categorie_document NOT NULL DEFAULT 'autre',
    version       INTEGER NOT NULL DEFAULT 1,
    statut        statut_document NOT NULL DEFAULT 'brouillon',
    confidentialite confidentialite NOT NULL DEFAULT 'dossier',
    chemin_storage VARCHAR(500) NOT NULL,                -- objet Cloud Storage
    type_mime     VARCHAR(120),
    taille_octets BIGINT,
    ocr_texte     TEXT,                                  -- texte extrait (recherche plein texte)
    auteur_id     UUID REFERENCES utilisateurs(id),
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_dossier ON documents(dossier_id);
CREATE INDEX idx_documents_ocr ON documents USING gin (ocr_texte gin_trgm_ops);

-- =====================================================================
--  ÉVÉNEMENTS, AUDIENCES & DÉLAIS
-- =====================================================================
CREATE TABLE evenements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id    UUID REFERENCES dossiers(id) ON DELETE CASCADE,
    type          type_evenement NOT NULL,
    titre         VARCHAR(200) NOT NULL,
    description   TEXT,
    date_echeance TIMESTAMPTZ NOT NULL,
    lieu          VARCHAR(160),
    responsable_id UUID REFERENCES utilisateurs(id),
    statut        statut_evenement NOT NULL DEFAULT 'a_venir',
    -- alertes en cascade (J-30 / J-15 / J-7 / J-1 / jour J)
    alerte_j30    BOOLEAN NOT NULL DEFAULT FALSE,
    alerte_j15    BOOLEAN NOT NULL DEFAULT FALSE,
    alerte_j7     BOOLEAN NOT NULL DEFAULT FALSE,
    alerte_j1     BOOLEAN NOT NULL DEFAULT FALSE,
    alerte_j0     BOOLEAN NOT NULL DEFAULT FALSE,
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_evenements_dossier ON evenements(dossier_id);
CREATE INDEX idx_evenements_echeance ON evenements(date_echeance);
CREATE INDEX idx_evenements_resp ON evenements(responsable_id);

-- =====================================================================
--  TÂCHES INTERNES
-- =====================================================================
CREATE TABLE taches (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id    UUID REFERENCES dossiers(id) ON DELETE CASCADE,
    titre         VARCHAR(200) NOT NULL,
    type          type_tache NOT NULL DEFAULT 'autre',
    description   TEXT,
    responsable_id UUID REFERENCES utilisateurs(id),
    priorite      priorite_tache NOT NULL DEFAULT 'normale',
    statut        statut_tache NOT NULL DEFAULT 'a_faire',
    echeance      DATE,
    validation_requise BOOLEAN NOT NULL DEFAULT FALSE,
    valide_par    UUID REFERENCES utilisateurs(id),
    valide_le     TIMESTAMPTZ,
    cree_par      UUID REFERENCES utilisateurs(id),
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    maj_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_taches_dossier ON taches(dossier_id);
CREATE INDEX idx_taches_resp ON taches(responsable_id);
CREATE INDEX idx_taches_statut ON taches(statut);

-- =====================================================================
--  TEMPS PASSÉ (timesheet)
-- =====================================================================
CREATE TABLE temps (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id    UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id),
    date_saisie   DATE NOT NULL DEFAULT current_date,
    duree_minutes INTEGER NOT NULL CHECK (duree_minutes > 0),
    taux_horaire  NUMERIC(14,0) NOT NULL DEFAULT 0,      -- FCFA HT au moment de la saisie
    facturable    BOOLEAN NOT NULL DEFAULT TRUE,
    description   TEXT,
    facture_id    UUID,                                  -- FK ajoutée plus bas
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_temps_dossier ON temps(dossier_id);
CREATE INDEX idx_temps_user ON temps(utilisateur_id);
CREATE INDEX idx_temps_date ON temps(date_saisie);

-- =====================================================================
--  FACTURATION & PAIEMENTS
-- =====================================================================
CREATE TABLE factures (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    numero        VARCHAR(30) UNIQUE NOT NULL,           -- ex. F-26-108
    client_id     UUID NOT NULL REFERENCES clients(id),
    dossier_id    UUID REFERENCES dossiers(id),
    mode          mode_honoraires NOT NULL,
    montant_ht    NUMERIC(14,0) NOT NULL DEFAULT 0,
    taux_tva      NUMERIC(5,2) NOT NULL DEFAULT 18.00,    -- TVA Mali (indicatif)
    montant_tva   NUMERIC(14,0) NOT NULL DEFAULT 0,
    montant_ttc   NUMERIC(14,0) NOT NULL DEFAULT 0,
    provision     NUMERIC(14,0) NOT NULL DEFAULT 0,
    devise        CHAR(3) NOT NULL DEFAULT 'XOF',
    statut        statut_facture NOT NULL DEFAULT 'brouillon',
    date_emission DATE,
    date_echeance DATE,
    notes         TEXT,
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    maj_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_factures_client ON factures(client_id);
CREATE INDEX idx_factures_dossier ON factures(dossier_id);
CREATE INDEX idx_factures_statut ON factures(statut);

-- lien temps -> facture (déféré car factures créée après temps)
ALTER TABLE temps
  ADD CONSTRAINT fk_temps_facture
  FOREIGN KEY (facture_id) REFERENCES factures(id) ON DELETE SET NULL;

CREATE TABLE paiements (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facture_id    UUID NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
    montant       NUMERIC(14,0) NOT NULL CHECK (montant > 0),
    mode          mode_paiement NOT NULL,
    date_paiement DATE NOT NULL DEFAULT current_date,
    reference     VARCHAR(120),
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_paiements_facture ON paiements(facture_id);

-- =====================================================================
--  COMMUNICATIONS (fil du dossier)
-- =====================================================================
CREATE TABLE communications (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id    UUID REFERENCES dossiers(id) ON DELETE CASCADE,
    client_id     UUID REFERENCES clients(id) ON DELETE SET NULL,
    type          type_communication NOT NULL,
    sujet         VARCHAR(240),
    resume        TEXT,
    interlocuteur VARCHAR(160),
    utilisateur_id UUID REFERENCES utilisateurs(id),
    date_comm     TIMESTAMPTZ NOT NULL DEFAULT now(),
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_comm_dossier ON communications(dossier_id);
CREATE INDEX idx_comm_client ON communications(client_id);

-- =====================================================================
--  JOURNAL D'AUDIT (traçabilité des connexions & modifications)
-- =====================================================================
CREATE TABLE journal_audit (
    id            BIGSERIAL PRIMARY KEY,
    utilisateur_id UUID REFERENCES utilisateurs(id),
    action        VARCHAR(40) NOT NULL,                 -- login, create, update, delete, view
    entite        VARCHAR(60),                          -- table concernée
    entite_id     UUID,
    details       JSONB,
    adresse_ip    INET,
    horodatage    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_user ON journal_audit(utilisateur_id);
CREATE INDEX idx_audit_entite ON journal_audit(entite, entite_id);
CREATE INDEX idx_audit_date ON journal_audit(horodatage);

-- =====================================================================
--  DÉCLENCHEUR — mise à jour automatique de maj_le
-- =====================================================================
CREATE OR REPLACE FUNCTION set_maj_le() RETURNS trigger AS $$
BEGIN
  NEW.maj_le = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_maj_utilisateurs BEFORE UPDATE ON utilisateurs
  FOR EACH ROW EXECUTE FUNCTION set_maj_le();
CREATE TRIGGER trg_maj_clients BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_maj_le();
CREATE TRIGGER trg_maj_dossiers BEFORE UPDATE ON dossiers
  FOR EACH ROW EXECUTE FUNCTION set_maj_le();
CREATE TRIGGER trg_maj_taches BEFORE UPDATE ON taches
  FOR EACH ROW EXECUTE FUNCTION set_maj_le();
CREATE TRIGGER trg_maj_factures BEFORE UPDATE ON factures
  FOR EACH ROW EXECUTE FUNCTION set_maj_le();

-- =====================================================================
--  VUES UTILES (Cockpit)
-- =====================================================================
-- Rentabilité indicative par dossier : temps facturable valorisé vs facturé
CREATE VIEW v_rentabilite_dossier AS
SELECT d.id AS dossier_id, d.numero, d.intitule,
       COALESCE(SUM(t.duree_minutes) FILTER (WHERE t.facturable),0) / 60.0 AS heures_facturables,
       COALESCE(SUM((t.duree_minutes/60.0) * t.taux_horaire) FILTER (WHERE t.facturable),0)::NUMERIC(14,0) AS valeur_temps,
       (SELECT COALESCE(SUM(f.montant_ht),0) FROM factures f WHERE f.dossier_id = d.id) AS total_facture_ht
FROM dossiers d
LEFT JOIN temps t ON t.dossier_id = d.id
GROUP BY d.id, d.numero, d.intitule;

-- Délais à venir avec nombre de jours restants
CREATE VIEW v_delais_a_venir AS
SELECT e.id, e.dossier_id, d.numero AS dossier_numero, d.intitule,
       e.type, e.titre, e.date_echeance, e.responsable_id,
       (e.date_echeance::date - current_date) AS jours_restants
FROM evenements e
JOIN dossiers d ON d.id = e.dossier_id
WHERE e.statut = 'a_venir' AND e.date_echeance >= now()
ORDER BY e.date_echeance;

-- =====================================================================
--  RÔLE D'AUDIENCE (agenda des audiences) — spécifique contentieux
--  Circuit : audience -> résultat (renvoi/délibéré/plaidé) + motif de
--  renvoi + prochaine date -> compilation d'un RÔLE hebdomadaire (semaine
--  N+1) émis, validé, diffusé et notifié à toute l'équipe.
-- =====================================================================
CREATE TYPE type_audience     AS ENUM ('mise_en_etat','plaidoirie','conciliation','refere','prononce','autre');
CREATE TYPE resultat_audience AS ENUM ('renvoi','delibere','plaide','radiation','conciliation','autre');
CREATE TYPE statut_role       AS ENUM ('brouillon','valide','diffuse');

-- Liste paramétrable des motifs de renvoi (répliques, production de pièces,
-- comparution, etc.) — alimentée par le cabinet.
CREATE TABLE motifs_renvoi (
    id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    libelle  VARCHAR(160) UNIQUE NOT NULL,
    actif    BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO motifs_renvoi (libelle) VALUES
 ('Dépôt de conclusions'),
 ('Répliques de la partie adverse'),
 ('Production / communication de pièces'),
 ('Constitution d''un nouveau conseil'),
 ('Comparution des parties'),
 ('Absence / défaut d''une partie'),
 ('Renvoi d''un commun accord'),
 ('Régularisation de la procédure'),
 ('Assignation / réassignation'),
 ('Indisponibilité de la juridiction'),
 ('Autre (préciser)')
ON CONFLICT (libelle) DO NOTHING;

-- Une audience tenue (ou à tenir) pour un dossier, avec son issue.
CREATE TABLE audiences (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id     UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    avocat_id      UUID REFERENCES utilisateurs(id),          -- avocat présent
    juridiction    VARCHAR(160),
    date_audience  DATE NOT NULL,
    type           type_audience NOT NULL DEFAULT 'mise_en_etat',
    resultat       resultat_audience,                          -- rempli au retour d'audience
    motif_renvoi_id UUID REFERENCES motifs_renvoi(id),
    prochaine_date DATE,                                        -- date de renvoi
    observations   TEXT,
    evenement_id   UUID REFERENCES evenements(id) ON DELETE SET NULL,  -- alerte liée
    cree_par       UUID REFERENCES utilisateurs(id),
    cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audiences_dossier ON audiences(dossier_id);
CREATE INDEX idx_audiences_date ON audiences(date_audience);
CREATE INDEX idx_audiences_prochaine ON audiences(prochaine_date);

-- Rôle hebdomadaire : agenda de toutes les audiences de la semaine à venir.
CREATE TABLE roles_audience (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    semaine_debut DATE NOT NULL,
    semaine_fin  DATE NOT NULL,
    statut       statut_role NOT NULL DEFAULT 'brouillon',
    valide_par   UUID REFERENCES utilisateurs(id),
    valide_le    TIMESTAMPTZ,
    diffuse_le   TIMESTAMPTZ,                                   -- notification à l'équipe
    cree_par     UUID REFERENCES utilisateurs(id),
    cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lignes du rôle (une audience programmée par ligne, avec l'avocat affecté).
CREATE TABLE role_audience_lignes (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id      UUID NOT NULL REFERENCES roles_audience(id) ON DELETE CASCADE,
    audience_id  UUID REFERENCES audiences(id) ON DELETE SET NULL,
    dossier_id   UUID NOT NULL REFERENCES dossiers(id),
    date_prevue  DATE NOT NULL,
    juridiction  VARCHAR(160),
    type         type_audience NOT NULL DEFAULT 'mise_en_etat',
    avocat_id    UUID REFERENCES utilisateurs(id)
);
CREATE INDEX idx_role_lignes_role ON role_audience_lignes(role_id);

-- =====================================================================
--  REGISTRE DU COURRIER (arrivée / départ) & RÉFÉRENCEMENT
--  Suivi de tout courrier ou acte reçu ou émis par le cabinet (papier
--  ET numérique), avec référence unique, imputation et lien GED.
-- =====================================================================
CREATE TYPE sens_courrier    AS ENUM ('arrivee','depart');
CREATE TYPE type_courrier    AS ENUM ('lettre','acte_huissier','acte_notaire','decision_justice','conclusions','courrier_officiel','administratif','autre');
CREATE TYPE acteur_courrier  AS ENUM ('client','confrere','huissier','notaire','juridiction','administration','autre');
CREATE TYPE support_courrier AS ENUM ('papier','numerique','mixte');
CREATE TYPE statut_courrier  AS ENUM ('recu','impute','en_traitement','traite','expedie');

CREATE TABLE courriers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference     VARCHAR(40) UNIQUE NOT NULL,                 -- ex. ARR-2026-000123 / DEP-2026-000045
    sens          sens_courrier NOT NULL,
    type          type_courrier NOT NULL DEFAULT 'lettre',
    date_courrier DATE NOT NULL DEFAULT current_date,
    acteur_type   acteur_courrier,                             -- nature de l'expéditeur/destinataire
    correspondant VARCHAR(240),                                -- expéditeur (arrivée) ou destinataire (départ)
    objet         VARCHAR(300),
    dossier_id    UUID REFERENCES dossiers(id) ON DELETE SET NULL,
    support       support_courrier NOT NULL DEFAULT 'papier',
    statut        statut_courrier NOT NULL DEFAULT 'recu',
    imputation_id UUID REFERENCES utilisateurs(id),            -- personne à qui le courrier est imputé
    document_id   UUID REFERENCES documents(id) ON DELETE SET NULL,  -- pièce numérisée (GED)
    observations  TEXT,
    cree_par      UUID REFERENCES utilisateurs(id),            -- généralement la secrétaire
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_courriers_dossier ON courriers(dossier_id);
CREATE INDEX idx_courriers_sens ON courriers(sens);
CREATE INDEX idx_courriers_date ON courriers(date_courrier);

-- =====================================================================
--  COMPTES DU CABINET & MOYENS DE PAIEMENT
--  Le cabinet dispose de plusieurs comptes (CARPA, fonctionnement,
--  mobile money par opérateur, virements étrangers). Chaque encaissement
--  ou dépense précise son moyen de paiement et le compte concerné.
-- =====================================================================
CREATE TYPE type_compte AS ENUM ('carpa','fonctionnement','especes','mobile_money','virement_etranger');
CREATE TYPE operateur_mobile AS ENUM ('orange_money','moov_money','wave','sama_money','autre');

CREATE TABLE comptes_bancaires (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    intitule   VARCHAR(160) NOT NULL,
    type       type_compte NOT NULL,
    banque     VARCHAR(120),                 -- ex. BDM sa
    numero     VARCHAR(60),                  -- référence / n° de compte
    operateur  operateur_mobile,             -- si compte mobile money
    actif      BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Encaissements : préciser le moyen de paiement et le compte destinataire.
ALTER TABLE paiements ADD COLUMN compte_id UUID REFERENCES comptes_bancaires(id);
ALTER TABLE paiements ADD COLUMN verse_au_compte BOOLEAN NOT NULL DEFAULT TRUE;  -- argent effectivement versé au compte ?

-- =====================================================================
--  DÉPENSES & CHARGES (fixes et ponctuelles) · PETITE CAISSE · VIGNETTES
-- =====================================================================
CREATE TYPE type_depense AS ENUM ('fixe','ponctuelle');
CREATE TYPE categorie_depense AS ENUM
  ('loyer','eau','electricite','nettoyage','carburant','telephonie','internet',
   'consommables','fournitures','deplacement','hebergement','restauration',
   'entretien','vignette_plaidoirie','frais_procedure','autre');

CREATE TABLE dotations_petite_caisse (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mois             DATE NOT NULL,                        -- 1er du mois concerné
    montant_alloue   NUMERIC(14,0) NOT NULL DEFAULT 0,     -- FCFA
    administrateur_id UUID REFERENCES utilisateurs(id),
    cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (mois)
);

CREATE TABLE depenses (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type           type_depense NOT NULL,
    categorie      categorie_depense NOT NULL DEFAULT 'autre',
    libelle        VARCHAR(240) NOT NULL,
    montant        NUMERIC(14,0) NOT NULL DEFAULT 0,        -- FCFA
    date_depense   DATE NOT NULL DEFAULT current_date,
    mode_paiement  mode_paiement,
    compte_id      UUID REFERENCES comptes_bancaires(id),
    petite_caisse  BOOLEAN NOT NULL DEFAULT FALSE,          -- dépense sur petite caisse
    justificatif   BOOLEAN NOT NULL DEFAULT FALSE,          -- pièce justificative disponible
    document_id    UUID REFERENCES documents(id) ON DELETE SET NULL,
    refacturable_client BOOLEAN NOT NULL DEFAULT FALSE,     -- débours refacturable
    dossier_id     UUID REFERENCES dossiers(id) ON DELETE SET NULL,
    cree_par       UUID REFERENCES utilisateurs(id),
    cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_depenses_date ON depenses(date_depense);
CREATE INDEX idx_depenses_type ON depenses(type);
CREATE INDEX idx_depenses_dossier ON depenses(dossier_id);

-- Vignettes / droits de plaidoirie (10 000 FCFA l'unité, à la charge du client).
-- Mouvements de stock : achat (approvisionnement) / utilisation (par dossier).
CREATE TABLE vignettes_plaidoirie (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mouvement      VARCHAR(12) NOT NULL CHECK (mouvement IN ('achat','utilisation')),
    quantite       INTEGER NOT NULL CHECK (quantite > 0),
    montant_unitaire NUMERIC(14,0) NOT NULL DEFAULT 10000,
    dossier_id     UUID REFERENCES dossiers(id) ON DELETE SET NULL,  -- pour une utilisation
    refacturee     BOOLEAN NOT NULL DEFAULT FALSE,
    date_mouvement DATE NOT NULL DEFAULT current_date,
    cree_par       UUID REFERENCES utilisateurs(id),
    cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vue : stock de vignettes (achats - utilisations)
CREATE VIEW v_stock_vignettes AS
SELECT COALESCE(SUM(quantite) FILTER (WHERE mouvement='achat'),0)
     - COALESCE(SUM(quantite) FILTER (WHERE mouvement='utilisation'),0) AS stock
FROM vignettes_plaidoirie;

-- =====================================================================
--  RÔLE D'AUDIENCE — enrichissements (instructions, suivi du CR, alertes)
-- =====================================================================
ALTER TABLE audiences ADD COLUMN instructions TEXT;            -- consignes à l'avocat qui se rend à l'audience
ALTER TABLE audiences ADD COLUMN cr_redige BOOLEAN NOT NULL DEFAULT FALSE;  -- compte rendu d'audience fait ?
ALTER TABLE audiences ADD COLUMN cr_date TIMESTAMPTZ;
ALTER TABLE audiences ADD COLUMN urgente BOOLEAN NOT NULL DEFAULT FALSE;    -- dossier de dernière minute
-- Une alerte est levée par l'application lorsque cr_redige = FALSE après la date d'audience
-- (CR ou motif de renvoi omis), et pour toute audience urgente à échéance très proche.

-- =====================================================================
--  COMPTE RENDU AU CLIENT (lettre émise par le secrétariat)
-- =====================================================================
CREATE TYPE statut_cr_client AS ENUM ('brouillon','a_signer','signe','envoye');

CREATE TABLE lettres_cr_client (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id  UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    audience_id UUID REFERENCES audiences(id) ON DELETE SET NULL,
    client_id   UUID REFERENCES clients(id),
    objet       VARCHAR(240),
    contenu     TEXT,
    statut      statut_cr_client NOT NULL DEFAULT 'brouillon',
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,   -- lettre générée
    date_cr     DATE NOT NULL DEFAULT current_date,
    cree_par    UUID REFERENCES utilisateurs(id),
    cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_crclient_dossier ON lettres_cr_client(dossier_id);

-- =====================================================================
--  PRO BONO — dossiers gracieux (quota par associé)
-- =====================================================================
ALTER TABLE dossiers ADD COLUMN pro_bono BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dossiers ADD COLUMN frais_procedure NUMERIC(14,0) DEFAULT 0;  -- ex. 45 000 FCFA obligatoires même en pro bono (MAJ 23/07/2026)
-- Règle de gestion (appliquée par l'application) : 2 dossiers pro bono / mois / associé,
-- non reportables ; au-delà, facturation obligatoire.

-- =====================================================================
--  CIRCUIT DE VALIDATION DES DÉPENSES (soumission → validation → décaissement)
--  Toute dépense est soumise par l'administrateur, validée/autorisée par un
--  gérant, puis décaissée par la comptabilité. Les trois étapes sont visibles.
-- =====================================================================
CREATE TYPE statut_depense AS ENUM ('soumise','validee','rejetee','decaissee');

ALTER TABLE depenses ADD COLUMN statut statut_depense NOT NULL DEFAULT 'soumise';
ALTER TABLE depenses ADD COLUMN recurrente BOOLEAN NOT NULL DEFAULT FALSE;  -- charge fixe récurrente (validée une fois)
ALTER TABLE depenses ADD COLUMN soumis_par UUID REFERENCES utilisateurs(id);
ALTER TABLE depenses ADD COLUMN valide_par UUID REFERENCES utilisateurs(id);   -- gérant / co-gérant
ALTER TABLE depenses ADD COLUMN valide_le TIMESTAMPTZ;
ALTER TABLE depenses ADD COLUMN motif_rejet TEXT;
ALTER TABLE depenses ADD COLUMN decaisse_par UUID REFERENCES utilisateurs(id); -- comptabilité
ALTER TABLE depenses ADD COLUMN decaisse_le TIMESTAMPTZ;
-- Recommandation : les charges fixes récurrentes (recurrente = true) sont validées
-- une seule fois (engagement) puis exécutées automatiquement ; les dépenses
-- ponctuelles suivent le circuit complet à chaque fois.

-- =====================================================================
--  GESTION & ÉVOLUTION DES ACCÈS (délégations, changements temporaires/permanents)
--  L'identité de chaque utilisateur (nom, prénom, code, e-mail, rôle) et toutes
--  ses actions sont déjà tracées (table journal_audit). Ci-dessous : la possibilité
--  de faire évoluer un accès (promotion) ou d'accorder un accès temporaire/permanent.
-- =====================================================================
CREATE TYPE portee_delegation AS ENUM ('temporaire','permanent');

CREATE TABLE delegations_acces (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    accorde_par   UUID REFERENCES utilisateurs(id),        -- associé / direction
    portee        portee_delegation NOT NULL DEFAULT 'temporaire',
    description   VARCHAR(240) NOT NULL,                   -- ex. « accès facturation », « rôle associé »
    date_debut    DATE NOT NULL DEFAULT current_date,
    date_fin      DATE,                                    -- nul si permanent
    motif         TEXT,
    actif         BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_deleg_user ON delegations_acces(utilisateur_id);

-- =====================================================================
--  RÉFÉRENCEMENT DES DOSSIERS & REPRISE DU PAPIER
-- =====================================================================
-- La référence des dossiers (colonne dossiers.numero) suit une formule paramétrable
-- (voir « Guide de référencement des dossiers »). On conserve l'ancienne référence.
ALTER TABLE dossiers ADD COLUMN reference_ancienne VARCHAR(80);   -- ex. 0048/26-12-2017/MDJ
ALTER TABLE dossiers ADD COLUMN support VARCHAR(20) DEFAULT 'numerique'; -- papier / numerique / mixte
ALTER TABLE dossiers ADD COLUMN etiquette_imprimee BOOLEAN NOT NULL DEFAULT FALSE; -- étiquette pré-référencée éditée
ALTER TABLE dossiers ADD COLUMN couleur_chemise VARCHAR(20);      -- déduite de la matière (voir codes_matiere)

-- Référentiel des codes de matière (type, libellé, couleur de chemise).
-- Paramétrable : sert au référencement automatique et au code couleur physique.
CREATE TABLE codes_matiere (
    code     VARCHAR(6) NOT NULL,             -- ex. CIV, COM, AFF…
    type     pole_cabinet NOT NULL,           -- conseil / contentieux
    libelle  VARCHAR(120) NOT NULL,
    couleur  VARCHAR(20),                      -- rouge, jaune, bleu, vert, orange, violet, gris
    PRIMARY KEY (code, type)                   -- ex. SOC existe en contentieux ET en conseil
);
INSERT INTO codes_matiere (code, type, libelle, couleur) VALUES
  ('PEN','contentieux','Pénal','rouge'),
  ('CIV','contentieux','Civil','jaune'),
  ('FAM','contentieux','Famille','jaune'),
  ('COM','contentieux','Commercial','bleu'),
  ('OHA','contentieux','OHADA / affaires','bleu'),
  ('SOC','contentieux','Social / travail','vert'),
  ('FON','contentieux','Foncier','orange'),
  ('IMM','contentieux','Immobilier','orange'),
  ('ADM','contentieux','Administratif','violet'),
  ('FIS','contentieux','Fiscal','violet'),
  ('ARB','contentieux','Arbitrage / CCJA','violet'),
  ('NUM','contentieux','Numérique / NTIC','gris'),
  ('AUT','contentieux','Autre','gris'),
  ('AFF','conseil','Droit des affaires','gris'),
  ('DDG','conseil','Due diligence','gris'),
  ('AVI','conseil','Avis / consultation','gris'),
  ('SOC','conseil','Sociétés','gris'),
  ('FIN','conseil','Financement de projet','gris'),
  ('FOR','conseil','Formalités','gris'),
  ('BAN','conseil','Bancaire / sûretés','gris'),
  ('MIN','conseil','Minier','gris');
-- Note : le code SOC existe en contentieux (Social) et en conseil (Sociétés) ; il est
-- distingué par le type. La couleur du dossier découle de (type, matière).

-- =====================================================================
--  AFFAIRES, DOSSIERS LIÉS & INSTANCES
--  Principe : chaque dossier garde une RÉFÉRENCE UNIQUE et STABLE. Une AFFAIRE
--  regroupe des dossiers liés (volet conseil + contentieux, procédures
--  parallèles, dossiers d'un même groupe) — pour les voir ensemble sans
--  fusionner les références. Les instances d'un même dossier (1re instance,
--  appel, cassation) sont suivies via la phase et la table « instances »
--  (chaque degré ayant son propre numéro de rôle / RG).
-- =====================================================================
CREATE TYPE degre_instance AS ENUM
  ('premiere_instance','appel','cassation','opposition','refere','execution','autre');

CREATE TABLE affaires (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference   VARCHAR(40) UNIQUE,             -- référence d'affaire (optionnelle)
    intitule    VARCHAR(240) NOT NULL,
    client_id   UUID REFERENCES clients(id),
    cree_le     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Rattachement d'un dossier à une affaire (regroupement) et sous-dossier (volet).
ALTER TABLE dossiers ADD COLUMN affaire_id UUID REFERENCES affaires(id) ON DELETE SET NULL;
ALTER TABLE dossiers ADD COLUMN dossier_parent_id UUID REFERENCES dossiers(id) ON DELETE SET NULL;
CREATE INDEX idx_dossiers_affaire ON dossiers(affaire_id);

-- Instances d'un même dossier (1re instance, appel, cassation…) avec RG propre.
CREATE TABLE instances (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    dossier_id   UUID NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
    degre        degre_instance NOT NULL DEFAULT 'premiere_instance',
    juridiction  VARCHAR(160),
    numero_role  VARCHAR(60),                   -- n° de rôle / RG propre à l'instance
    date_debut   DATE,
    decision     TEXT,
    cree_le      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_instances_dossier ON instances(dossier_id);

-- =====================================================================
--  POINTAGE / PRÉSENCES DES SALARIÉS (temps de travail)
--  Distinct du timesheet (temps facturable par dossier) : suivi des heures de
--  présence de chaque membre (journalier / mensuel).
-- =====================================================================
CREATE TABLE presences (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    date_jour     DATE NOT NULL DEFAULT current_date,
    heure_arrivee TIME,
    heure_depart  TIME,
    heures        NUMERIC(5,2),                            -- calculé ou saisi
    source        VARCHAR(20) DEFAULT 'saisie',           -- saisie / badge / pointeuse
    observations  TEXT,
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (utilisateur_id, date_jour)
);
CREATE INDEX idx_presences_user ON presences(utilisateur_id);
CREATE INDEX idx_presences_date ON presences(date_jour);

CREATE VIEW v_heures_mensuelles AS
SELECT utilisateur_id, date_trunc('month', date_jour) AS mois,
       COALESCE(SUM(heures),0) AS total_heures, COUNT(*) AS jours_pointes
FROM presences GROUP BY utilisateur_id, date_trunc('month', date_jour);

-- ---------------------------------------------------------------------
--  Listes de valeurs PARAMÉTRABLES (menus déroulants du cabinet).
--  Principe transversal : chaque liste de choix « métier » est éditable
--  par la direction (ajout d'options), porte un ordre et un indicateur
--  actif/inactif (on désactive au lieu de supprimer, pour la traçabilité),
--  et comprend TOUJOURS une entrée « autre » ; lorsqu'elle est choisie,
--  l'utilisateur saisit une description libre dans le champ observations /
--  precision de l'enregistrement concerné.
--  (Généralise la table motifs_renvoi déjà présente.)
-- ---------------------------------------------------------------------
CREATE TABLE listes_valeurs (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    domaine   VARCHAR(50) NOT NULL,        -- ex. resultat_audience, type_courrier…
    code      VARCHAR(50) NOT NULL,        -- valeur technique
    libelle   VARCHAR(160) NOT NULL,       -- libellé affiché
    ordre     INT NOT NULL DEFAULT 0,      -- ordre d'affichage
    actif     BOOLEAN NOT NULL DEFAULT TRUE,
    systeme   BOOLEAN NOT NULL DEFAULT FALSE,  -- valeur socle (non supprimable)
    cree_par  UUID REFERENCES utilisateurs(id),
    cree_le   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (domaine, code)
);
CREATE INDEX idx_listes_domaine ON listes_valeurs(domaine, actif, ordre);

-- Valeurs par défaut (extensibles par la direction) — chaque domaine finit par « autre »
INSERT INTO listes_valeurs (domaine, code, libelle, ordre, systeme) VALUES
 ('resultat_audience','renvoi','Renvoi',1,TRUE),
 ('resultat_audience','delibere','Mise en délibéré',2,TRUE),
 ('resultat_audience','plaide','Affaire plaidée',3,TRUE),
 ('resultat_audience','radiation','Radiation',4,TRUE),
 ('resultat_audience','jonction','Jonction de procédures',5,FALSE),
 ('resultat_audience','disjonction','Disjonction',6,FALSE),
 ('resultat_audience','sursis','Sursis à statuer',7,FALSE),
 ('resultat_audience','desistement','Désistement',8,FALSE),
 ('resultat_audience','conciliation','Conciliation / médiation',9,FALSE),
 ('resultat_audience','incompetence','Incompétence',10,FALSE),
 ('resultat_audience','reouverture','Réouverture des débats',11,FALSE),
 ('resultat_audience','comparution_perso','Comparution personnelle ordonnée',12,FALSE),
 ('resultat_audience','expertise','Expertise ordonnée',13,FALSE),
 ('resultat_audience','mise_en_etat','Audience de mise en état',14,FALSE),
 ('resultat_audience','retenue','Affaire retenue',15,FALSE),
 ('resultat_audience','autre','Autre (préciser)',99,TRUE),
 ('motif_renvoi','depot_conclusions','Dépôt de conclusions',1,TRUE),
 ('motif_renvoi','repliques','Répliques de la partie adverse',2,TRUE),
 ('motif_renvoi','production_pieces','Production / communication de pièces',3,TRUE),
 ('motif_renvoi','nouveau_conseil','Constitution d''un nouveau conseil',4,FALSE),
 ('motif_renvoi','comparution','Comparution des parties',5,FALSE),
 ('motif_renvoi','absence_partie','Absence / défaut d''une partie',6,FALSE),
 ('motif_renvoi','accord_parties','Renvoi d''un commun accord',7,FALSE),
 ('motif_renvoi','regularisation','Régularisation de la procédure',8,FALSE),
 ('motif_renvoi','assignation','Assignation / réassignation',9,FALSE),
 ('motif_renvoi','indisponibilite','Indisponibilité de la juridiction',10,FALSE),
 ('motif_renvoi','autre','Autre (préciser)',99,TRUE),
 ('instruction_audience','lettre_constitution','Déposer la lettre de constitution',1,TRUE),
 ('instruction_audience','demande_renvoi','Demander un renvoi (dépôt de conclusions)',2,TRUE),
 ('instruction_audience','mise_delibere','Solliciter la mise en délibéré',3,TRUE),
 ('instruction_audience','retour_assignation','Retour de l''assignation',4,FALSE),
 ('instruction_audience','comparaitre','Comparaître / représenter',5,FALSE),
 ('instruction_audience','deposer_conclusions','Déposer des conclusions',6,FALSE),
 ('instruction_audience','plaider','Plaider',7,FALSE),
 ('instruction_audience','verser_pieces','Verser des pièces',8,FALSE),
 ('instruction_audience','prendre_date','Prendre date',9,FALSE),
 ('instruction_audience','autre','Autre (préciser)',99,TRUE),
 ('type_courrier','lettre','Lettre',1,TRUE),
 ('type_courrier','acte_huissier','Acte d''huissier',2,TRUE),
 ('type_courrier','acte_notaire','Acte de notaire',3,TRUE),
 ('type_courrier','decision_justice','Décision de justice',4,TRUE),
 ('type_courrier','conclusions','Conclusions',5,FALSE),
 ('type_courrier','requete','Requête',6,FALSE),
 ('type_courrier','assignation','Assignation',7,FALSE),
 ('type_courrier','notification','Notification',8,FALSE),
 ('type_courrier','convocation','Convocation',9,FALSE),
 ('type_courrier','courrier_officiel','Courrier officiel',10,FALSE),
 ('type_courrier','administratif','Courrier administratif',11,FALSE),
 ('type_courrier','autre','Autre (préciser)',99,TRUE),
 ('nature_correspondant','client','Client',1,TRUE),
 ('nature_correspondant','confrere','Confrère',2,TRUE),
 ('nature_correspondant','huissier','Huissier',3,TRUE),
 ('nature_correspondant','notaire','Notaire',4,TRUE),
 ('nature_correspondant','juridiction','Juridiction',5,TRUE),
 ('nature_correspondant','administration','Administration',6,TRUE),
 ('nature_correspondant','expert','Expert',7,FALSE),
 ('nature_correspondant','banque','Banque',8,FALSE),
 ('nature_correspondant','partie_adverse','Partie adverse',9,FALSE),
 ('nature_correspondant','autre','Autre (préciser)',99,TRUE),
 ('categorie_depense','loyer','Loyer',1,TRUE),
 ('categorie_depense','eau','Eau',2,TRUE),
 ('categorie_depense','electricite','Électricité',3,TRUE),
 ('categorie_depense','nettoyage','Nettoyage',4,FALSE),
 ('categorie_depense','carburant','Carburant',5,FALSE),
 ('categorie_depense','telephonie','Téléphonie',6,FALSE),
 ('categorie_depense','internet','Internet',7,FALSE),
 ('categorie_depense','consommables','Consommables',8,FALSE),
 ('categorie_depense','fournitures','Fournitures',9,FALSE),
 ('categorie_depense','deplacement','Déplacement (billets)',10,FALSE),
 ('categorie_depense','hebergement','Hébergement',11,FALSE),
 ('categorie_depense','restauration','Restauration',12,FALSE),
 ('categorie_depense','entretien','Entretien',13,FALSE),
 ('categorie_depense','vignette_plaidoirie','Vignette de plaidoirie',14,FALSE),
 ('categorie_depense','frais_procedure','Frais de procédure',15,FALSE),
 ('categorie_depense','mission','Frais de mission',16,FALSE),
 ('categorie_depense','autre','Autre (préciser)',99,TRUE),
 ('mode_honoraires','forfait','Forfait',1,TRUE),
 ('mode_honoraires','temps_passe','Temps passé',2,TRUE),
 ('mode_honoraires','success_fee','Success fee',3,TRUE),
 ('mode_honoraires','abonnement','Abonnement',4,TRUE),
 ('mode_honoraires','consultation','Consultation ponctuelle',5,TRUE),
 ('mode_honoraires','mixte','Mixte',6,FALSE),
 ('mode_honoraires','autre','Autre (préciser)',99,TRUE),
 ('type_conge','annuel','Congés annuels',1,TRUE),
 ('type_conge','maladie','Maladie',2,TRUE),
 ('type_conge','maternite','Maternité / paternité',3,TRUE),
 ('type_conge','exceptionnel','Absence exceptionnelle',4,FALSE),
 ('type_conge','formation','Formation',5,FALSE),
 ('type_conge','sans_solde','Sans solde',6,FALSE),
 ('type_conge','autre','Autre (préciser)',99,TRUE),
 ('motif_delegation','remplacement','Remplacement',1,TRUE),
 ('motif_delegation','conge','Congé',2,TRUE),
 ('motif_delegation','surcroit','Surcroît d''activité',3,FALSE),
 ('motif_delegation','mission','Mission spécifique',4,FALSE),
 ('motif_delegation','promotion','Promotion / évolution',5,FALSE),
 ('motif_delegation','autre','Autre (préciser)',99,TRUE),
 ('type_evenement','audience','Audience',1,TRUE),
 ('type_evenement','echeance','Échéance',2,TRUE),
 ('type_evenement','delai_recours','Délai de recours',3,TRUE),
 ('type_evenement','prescription','Prescription',4,TRUE),
 ('type_evenement','rdv','Rendez-vous',5,FALSE),
 ('type_evenement','relance','Relance client',6,FALSE),
 ('type_evenement','formalite','Formalité',7,FALSE),
 ('type_evenement','autre','Autre (préciser)',99,TRUE);

-- Domaines complémentaires (échéances administratives récurrentes)
INSERT INTO listes_valeurs (domaine, code, libelle, ordre, systeme) VALUES
 ('categorie_echeance','fiscale','Fiscale',1,TRUE),
 ('categorie_echeance','sociale','Sociale',2,TRUE),
 ('categorie_echeance','ordinale','Ordinale (Ordre / Barreau)',3,TRUE),
 ('categorie_echeance','assurance','Assurance',4,FALSE),
 ('categorie_echeance','contrat','Contrat / abonnement',5,FALSE),
 ('categorie_echeance','rh','Ressources humaines',6,FALSE),
 ('categorie_echeance','autre','Autre (préciser)',99,TRUE),
 ('periodicite','mensuelle','Mensuelle',1,TRUE),
 ('periodicite','trimestrielle','Trimestrielle',2,TRUE),
 ('periodicite','semestrielle','Semestrielle',3,FALSE),
 ('periodicite','annuelle','Annuelle',4,TRUE),
 ('periodicite','ponctuelle','Ponctuelle',5,TRUE);

-- Champ de précision libre pour les valeurs « Autre » (là où il manquait)
ALTER TABLE depenses     ADD COLUMN IF NOT EXISTS precision TEXT;   -- si catégorie = autre
ALTER TABLE audiences    ADD COLUMN IF NOT EXISTS resultat_autre TEXT;  -- si résultat = autre (sinon observations)

-- ---------------------------------------------------------------------
--  Échéances administratives RÉCURRENTES du cabinet (hors dossier).
--  Obligations fiscales (TVA, IS, patente…), sociales (INPS, AMO, ITS),
--  ordinales (cotisation à l'Ordre), assurances (RC pro), contrats/
--  abonnements et échéances RH (fin d'essai, CDD, visite médicale).
--  L'application régénère la prochaine occurrence selon la périodicité
--  et déclenche des alertes J-… au responsable. Elle NE calcule PAS
--  l'impôt : elle rappelle l'échéance (voir principe « le comptable
--  calcule et déclare »).
-- ---------------------------------------------------------------------
CREATE TABLE echeances_administratives (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    categorie      VARCHAR(30) NOT NULL DEFAULT 'fiscale',   -- listes_valeurs('categorie_echeance')
    libelle        VARCHAR(200) NOT NULL,                    -- ex. « Déclaration TVA »
    periodicite    VARCHAR(20) NOT NULL DEFAULT 'mensuelle', -- listes_valeurs('periodicite')
    jour_echeance  INT,                                      -- jour du mois (ex. 15) si périodique
    prochaine_date DATE NOT NULL,                            -- prochaine occurrence
    responsable_id UUID REFERENCES utilisateurs(id),         -- comptable / administrateur
    montant_estime NUMERIC(14,0),                            -- FCFA, indicatif
    rappel_jours   INT[] NOT NULL DEFAULT '{15,7,1,0}',      -- alertes J-…
    statut         VARCHAR(20) NOT NULL DEFAULT 'a_faire',   -- a_faire / declare / paye / en_retard
    reference_ext  VARCHAR(120),                             -- n° NIF, matricule INPS, police d'assurance…
    actif          BOOLEAN NOT NULL DEFAULT TRUE,
    observations   TEXT,                                     -- description si catégorie = autre
    cree_par       UUID REFERENCES utilisateurs(id),
    cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_echeances_admin_date ON echeances_administratives(prochaine_date, actif);
CREATE INDEX idx_echeances_admin_cat  ON echeances_administratives(categorie);

-- Obligations récurrentes — périodicités et échéances vérifiées auprès de la DGI Mali et de l'INPS
-- (juillet 2026 ; montants à renseigner par le cabinet ; à revalider chaque année / loi de finances).
INSERT INTO echeances_administratives (categorie, libelle, periodicite, jour_echeance, prochaine_date, statut, observations) VALUES
 ('fiscale','Déclaration & paiement de la TVA (18%)','mensuelle',15,
   date_trunc('month',current_date)+interval '1 month 14 day','a_faire',
   'Au plus tard le 15 du mois suivant les opérations (DGI Mali).'),
 ('sociale','Cotisations sociales INPS (parts patronale + salariale)','mensuelle',15,
   date_trunc('month',current_date)+interval '1 month 14 day','a_faire',
   'Dans les 15 jours suivant le mois si effectif >= 10 salaries ; TRIMESTRIELLE (15 j. apres le trimestre) si < 10 salaries — a ajuster selon l''effectif (INPS).'),
 ('sociale','Impôt sur les traitements et salaires (ITS)','mensuelle',15,
   date_trunc('month',current_date)+interval '1 month 14 day','a_faire',
   'Retenue a la source reversee au plus tard le 15 du mois suivant (DGI Mali).'),
 ('fiscale','Acomptes provisionnels Impôt sur les Sociétés (IS)','trimestrielle',NULL,
   date_trunc('year',current_date)+interval '10 month 29 day','a_faire',
   'Trois acomptes egaux : 31 mars, 31 juillet, 30 novembre ; solde a la declaration de resultat (DGI Mali).'),
 ('fiscale','Contribution des patentes','annuelle',NULL,
   date_trunc('year',current_date)+interval '1 year 3 month 29 day','a_faire',
   'Avant le 1er mai (patente synthetique : au plus tard 31 mars ; autres : 30 avril — a confirmer chaque annee).'),
 ('ordinale','Cotisation à l''Ordre des avocats du Mali','annuelle',NULL,
   date_trunc('year',current_date)+interval '1 year','a_faire',
   'Date fixee par l''Ordre / le Barreau.'),
 ('assurance','Assurance responsabilité civile professionnelle','annuelle',NULL,
   date_trunc('year',current_date)+interval '1 year','a_faire',
   'A la date d''echeance du contrat.');

-- ---------------------------------------------------------------------
--  Bulletins de paie — OPTION LÉGÈRE (archivage + suivi + export).
--  Le calcul officiel et les déclarations sociales (INPS, AMO, ITS)
--  restent HORS application : JURIA alimente et exporte, le comptable
--  calcule et déclare. Montants stockés à titre indicatif.
-- ---------------------------------------------------------------------
CREATE TABLE bulletins_paie (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    utilisateur_id   UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    mois             DATE NOT NULL,                       -- 1er du mois concerné
    salaire_brut     NUMERIC(14,2),
    salaire_net      NUMERIC(14,2),
    cotisations_salariales NUMERIC(14,2),                 -- indicatif
    cotisations_patronales NUMERIC(14,2),                 -- indicatif
    primes           NUMERIC(14,2),
    document_id      UUID REFERENCES documents(id),       -- bulletin PDF archivé (GED)
    verse_le         DATE,
    observations     TEXT,
    cree_par         UUID REFERENCES utilisateurs(id),
    cree_le          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (utilisateur_id, mois)
);
CREATE INDEX idx_bulletins_user ON bulletins_paie(utilisateur_id);
CREATE INDEX idx_bulletins_mois ON bulletins_paie(mois);

-- Domaines complémentaires pour les 3 options
INSERT INTO listes_valeurs (domaine, code, libelle, ordre, systeme) VALUES
 ('type_original','titre_propriete','Titre de propriété',1,FALSE),
 ('type_original','contrat','Contrat original',2,FALSE),
 ('type_original','piece_identite','Pièce d''identité',3,FALSE),
 ('type_original','acte_notarie','Acte notarié',4,FALSE),
 ('type_original','decision_justice','Décision de justice (grosse/expédition)',5,FALSE),
 ('type_original','statuts','Statuts / RCCM',6,FALSE),
 ('type_original','cheque_effet','Chèque / effet de commerce',7,FALSE),
 ('type_original','autre','Autre (préciser)',99,TRUE),
 ('type_contrat','cdi','CDI',1,TRUE),
 ('type_contrat','cdd','CDD',2,TRUE),
 ('type_contrat','collaboration','Contrat de collaboration',3,TRUE),
 ('type_contrat','stage','Convention de stage',4,TRUE),
 ('type_contrat','prestation','Prestation de service',5,FALSE),
 ('type_contrat','autre','Autre (préciser)',99,TRUE);

-- ---------------------------------------------------------------------
--  OPTION 1 — Originaux & pièces confiés par le client (à restituer).
--  Registre des documents originaux remis au cabinet, avec obligation
--  de restitution en fin de dossier (évite les litiges).
-- ---------------------------------------------------------------------
CREATE TABLE originaux_confies (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id      UUID REFERENCES clients(id) ON DELETE SET NULL,
    dossier_id     UUID REFERENCES dossiers(id) ON DELETE SET NULL,
    type_piece     VARCHAR(40),                          -- listes_valeurs('type_original')
    description    VARCHAR(300) NOT NULL,
    recu_le        DATE NOT NULL DEFAULT current_date,
    recu_par       UUID REFERENCES utilisateurs(id),
    emplacement    VARCHAR(160),                         -- coffre, armoire, dossier physique…
    restitue       BOOLEAN NOT NULL DEFAULT FALSE,
    restitue_le    DATE,
    restitue_a     VARCHAR(200),                         -- personne à qui l'original a été remis
    observations   TEXT,
    cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_originaux_client  ON originaux_confies(client_id);
CREATE INDEX idx_originaux_dossier ON originaux_confies(dossier_id);
CREATE INDEX idx_originaux_restit  ON originaux_confies(restitue);

-- ---------------------------------------------------------------------
--  OPTION 2 — Alertes RH sur le personnel (échéances liées au contrat).
--  Champs ajoutés aux utilisateurs ; surfacés en alertes (vue ci-dessous).
-- ---------------------------------------------------------------------
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS type_contrat        VARCHAR(30); -- listes_valeurs('type_contrat')
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS date_debut          DATE;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS date_fin_essai      DATE;
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS date_fin_contrat    DATE;  -- CDD / échéance
ALTER TABLE utilisateurs ADD COLUMN IF NOT EXISTS date_visite_medicale DATE; -- prochaine visite

-- Vue : échéances RH à venir (fin d'essai, fin de contrat, visite médicale)
CREATE VIEW v_echeances_rh AS
SELECT id AS utilisateur_id, prenom, nom, 'fin_essai'::text AS type_echeance, date_fin_essai AS echeance
  FROM utilisateurs WHERE actif AND date_fin_essai IS NOT NULL
UNION ALL
SELECT id, prenom, nom, 'fin_contrat', date_fin_contrat
  FROM utilisateurs WHERE actif AND date_fin_contrat IS NOT NULL
UNION ALL
SELECT id, prenom, nom, 'visite_medicale', date_visite_medicale
  FROM utilisateurs WHERE actif AND date_visite_medicale IS NOT NULL;

-- ---------------------------------------------------------------------
--  OPTION 3 — Rappels de renouvellement KYC (pièces client expirées/à venir).
--  S'appuie sur client_pieces_kyc.date_expiration (déjà présent).
-- ---------------------------------------------------------------------
CREATE VIEW v_kyc_a_renouveler AS
SELECT k.id AS piece_id, k.client_id, c.type AS type_client,
       COALESCE(c.denomination, c.nom) AS client, k.libelle, k.date_expiration,
       (k.date_expiration - current_date) AS jours_restants
FROM client_pieces_kyc k
JOIN clients c ON c.id = k.client_id
WHERE k.date_expiration IS NOT NULL
  AND k.date_expiration <= current_date + INTERVAL '60 day';

-- =====================================================================
--  MISE À JOUR 23/07/2026
--  Facturation légale · charges cabinet vs débours client · courrier
--  (description) · rôle enrichi · planning des diligences · rétrocessions
-- =====================================================================

-- ---- Domaines de listes complémentaires ----
INSERT INTO listes_valeurs (domaine, code, libelle, ordre, systeme) VALUES
 ('nature_procedure','annulation_vente','Annulation de vente',1,FALSE),
 ('nature_procedure','recouvrement','Recouvrement de créance',2,FALSE),
 ('nature_procedure','dommages_interets','Réclamation de droits & dommages-intérêts',3,FALSE),
 ('nature_procedure','escroquerie','Escroquerie',4,FALSE),
 ('nature_procedure','abus_confiance','Abus de confiance',5,FALSE),
 ('nature_procedure','divorce','Divorce / droit de la famille',6,FALSE),
 ('nature_procedure','succession','Succession / partage',7,FALSE),
 ('nature_procedure','licenciement','Licenciement / litige social',8,FALSE),
 ('nature_procedure','bail','Bail / expulsion',9,FALSE),
 ('nature_procedure','execution','Exécution / saisie',10,FALSE),
 ('nature_procedure','autre','Autre (préciser)',99,TRUE),
 ('type_diligence','audition_juridiction','Audition / assistance en juridiction',1,FALSE),
 ('type_diligence','enquete','Assistance en unité d''enquête (police, gendarmerie)',2,FALSE),
 ('type_diligence','formalite','Formalité (greffe, RCCM, notaire…)',3,FALSE),
 ('type_diligence','diligence','Diligence / démarche',4,FALSE),
 ('type_diligence','rendez_vous','Rendez-vous client / partenaire',5,FALSE),
 ('type_diligence','expertise','Assistance à expertise',6,FALSE),
 ('type_diligence','autre','Autre (préciser)',99,TRUE),
 ('ligne_facture','honoraire','Honoraires',1,TRUE),
 ('ligne_facture','frais','Frais',2,TRUE),
 ('ligne_facture','debours','Débours (avancés pour le client)',3,TRUE),
 ('ligne_facture','provision','Provision (à déduire)',4,TRUE),
 ('categorie_depense','huissier','Frais d''huissier (débours client)',20,FALSE),
 ('categorie_depense','notaire','Frais de notaire (débours client)',21,FALSE),
 ('categorie_depense','formalites','Formalités / greffe (débours client)',22,FALSE),
 ('categorie_depense','diligences','Diligences (débours client)',23,FALSE),
 ('categorie_depense','consignation','Consignation (débours client)',24,FALSE),
 ('categorie_depense','voyage_avocat','Voyage de l''avocat',25,FALSE),
 ('categorie_depense','hotel','Hébergement / hôtel',26,FALSE);

-- ---- Courrier : colonne description (en plus de « Autre » dans les listes) ----
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS description TEXT;  -- précision libre à côté du correspondant / de la partie

-- ---- Rôle d'audience enrichi ----
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS heure             TIME;                  -- heure de l'audience (important)
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS nature_procedure  VARCHAR(60);           -- listes_valeurs('nature_procedure')
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS nature_precision  TEXT;                  -- si nature = autre
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS nouveau_role      BOOLEAN DEFAULT TRUE;  -- nouveau dans le rôle ou dossier déjà ancien
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS audience_prec_id  UUID REFERENCES audiences(id);  -- audience précédente (chaînage)
ALTER TABLE audiences ADD COLUMN IF NOT EXISTS dernier_motif_id  UUID REFERENCES motifs_renvoi(id); -- dernier motif de renvoi connu
-- Contrôle de cohérence (app) : à l'émission du rôle, si dernier_motif_id diffère du motif
-- réellement saisi au retour d'audience précédent, lever une alerte de cohérence.

-- ---- Planning des diligences & assistances (2e « rôle » hebdomadaire) ----
--  Auditions en juridiction, assistances en unité d'enquête, formalités,
--  diligences et rendez-vous à accomplir par les membres, d'une semaine à l'autre.
CREATE TABLE diligences (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type_diligence VARCHAR(40) NOT NULL DEFAULT 'diligence',  -- listes_valeurs('type_diligence')
    type_precision TEXT,                                      -- si type = autre
    dossier_id     UUID REFERENCES dossiers(id) ON DELETE SET NULL,
    membre_id      UUID REFERENCES utilisateurs(id),          -- membre assigné
    date_diligence DATE NOT NULL,
    heure          TIME,
    lieu           VARCHAR(200),                              -- juridiction, unité d'enquête, étude…
    objet          VARCHAR(300),
    statut         VARCHAR(20) NOT NULL DEFAULT 'a_faire',    -- a_faire / fait / reporte / annule
    semaine        DATE,                                      -- lundi de la semaine concernée
    observations   TEXT,
    cree_par       UUID REFERENCES utilisateurs(id),
    cree_le        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_diligences_date   ON diligences(date_diligence);
CREATE INDEX idx_diligences_membre ON diligences(membre_id);

-- ---- Paramètres du cabinet (en-tête de facture, mentions légales) ----
CREATE TABLE parametres_cabinet (
    id              INT PRIMARY KEY DEFAULT 1,
    raison_sociale  VARCHAR(200) NOT NULL DEFAULT 'JFC AVOCATS MALI',
    forme           VARCHAR(120) DEFAULT 'Société civile professionnelle d''avocats — Barreau du Mali',
    adresse         TEXT,
    telephone       VARCHAR(80),
    email           VARCHAR(160),
    nif             VARCHAR(60),
    rccm            VARCHAR(60),
    compte_carpa    VARCHAR(120),
    mentions_legales TEXT,                                    -- pied de facture (pénalités de retard, TVA…)
    logo_path       VARCHAR(300),
    CONSTRAINT one_row CHECK (id = 1)
);
INSERT INTO parametres_cabinet (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ---- Facturation : assujettissement TVA du client & enrichissement facture ----
ALTER TABLE clients  ADD COLUMN IF NOT EXISTS assujetti_tva BOOLEAN DEFAULT TRUE;  -- selon localisation (client hors champ = hors Mali/UEMOA)
ALTER TABLE factures ADD COLUMN IF NOT EXISTS type_document VARCHAR(20) NOT NULL DEFAULT 'facture'; -- facture / note_de_frais / avoir
ALTER TABLE factures ADD COLUMN IF NOT EXISTS avec_tva      BOOLEAN NOT NULL DEFAULT TRUE;          -- calculée selon la localisation du client
ALTER TABLE factures ADD COLUMN IF NOT EXISTS motif_exoneration TEXT;                               -- si avec_tva = false
ALTER TABLE factures ADD COLUMN IF NOT EXISTS adresse_facturation TEXT;
ALTER TABLE factures ADD COLUMN IF NOT EXISTS montant_frais   NUMERIC(14,0) NOT NULL DEFAULT 0;      -- frais refacturés
ALTER TABLE factures ADD COLUMN IF NOT EXISTS montant_debours NUMERIC(14,0) NOT NULL DEFAULT 0;      -- débours avancés (hors TVA)
-- Moyen de règlement choisi à l'édition (imprimé comme instruction de paiement sur la facture)
ALTER TABLE factures ADD COLUMN IF NOT EXISTS mode_reglement  mode_paiement;                          -- virement / especes / mobile money / cheque…
ALTER TABLE factures ADD COLUMN IF NOT EXISTS compte_reglement_id UUID REFERENCES comptes_bancaires(id); -- si virement : compte du cabinet à créditer

-- Lignes de facture : honoraires (soumis TVA), frais, débours (avancés pour le client), provision
CREATE TABLE lignes_facture (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    facture_id    UUID NOT NULL REFERENCES factures(id) ON DELETE CASCADE,
    categorie     VARCHAR(20) NOT NULL DEFAULT 'honoraire',  -- listes_valeurs('ligne_facture')
    designation   VARCHAR(300) NOT NULL,
    quantite      NUMERIC(10,2) NOT NULL DEFAULT 1,
    prix_unitaire NUMERIC(14,0) NOT NULL DEFAULT 0,
    montant_ht    NUMERIC(14,0) NOT NULL DEFAULT 0,
    tva_applicable BOOLEAN NOT NULL DEFAULT TRUE,             -- débours : généralement FALSE
    depense_id    UUID REFERENCES depenses(id),              -- lien vers le débours avancé, le cas échéant
    ordre         INT NOT NULL DEFAULT 0
);
CREATE INDEX idx_lignes_facture ON lignes_facture(facture_id);

-- ---- Débours avancés pour le client (à refacturer) ----
ALTER TABLE depenses ADD COLUMN IF NOT EXISTS avance_pour_client BOOLEAN NOT NULL DEFAULT FALSE;  -- le cabinet avance pour le client
ALTER TABLE depenses ADD COLUMN IF NOT EXISTS refacture BOOLEAN NOT NULL DEFAULT FALSE;           -- déjà porté sur une facture

-- Vue : débours à refacturer (avancés, refacturables, pas encore refacturés)
CREATE VIEW v_debours_a_refacturer AS
SELECT d.id, d.dossier_id, d.categorie, d.libelle, d.montant, d.date_depense
FROM depenses d
WHERE d.refacturable_client = TRUE
  AND COALESCE(d.avance_pour_client, FALSE) = TRUE
  AND COALESCE(d.refacture, FALSE) = FALSE;

-- =====================================================================
--  MISE À JOUR — ouverture (objet), présence/verrou, courrier (parapheur),
--  déclencheurs acte->planning
-- =====================================================================

-- Objet du litige / de la demande sur le dossier
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS objet TEXT;

-- ---- Édition concurrente : présence + verrouillage optimiste ----
CREATE TABLE verrous_edition (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entite        VARCHAR(40) NOT NULL,                 -- 'dossier','courrier','facture','role'…
    entite_id     UUID NOT NULL,
    utilisateur_id UUID NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    depuis        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entite, entite_id)                          -- une présence « en édition » à la fois (informatif)
);
-- Contrôle de version (verrou optimiste) sur les fiches sensibles
ALTER TABLE dossiers  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- ---- Courrier : fiche de transmission (parapheur) + numérisation GED ----
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS recu_par    UUID REFERENCES utilisateurs(id);   -- qui a reçu (arrivée)
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS transmis_par UUID REFERENCES utilisateurs(id);  -- qui transmet au parapheur
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS transmis_le  TIMESTAMPTZ;                        -- date de transmission
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS vise_le      TIMESTAMPTZ;                        -- visa de l'avocat
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS a_numeriser  BOOLEAN NOT NULL DEFAULT FALSE;     -- papier en attente de scan
ALTER TABLE courriers ADD COLUMN IF NOT EXISTS numerise     BOOLEAN NOT NULL DEFAULT FALSE;     -- rattaché à la GED

-- ---- Déclencheurs : type de source (courrier/acte) -> événement suggéré ----
CREATE TABLE declencheurs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_domaine VARCHAR(30) NOT NULL,                -- 'type_courrier' / 'categorie_document'
    source_code    VARCHAR(50) NOT NULL,                -- ex. 'assignation','convocation','acte_huissier'
    type_evenement VARCHAR(40) NOT NULL,                -- 'audience' / 'diligence' / 'delai' / 'echeance'
    libelle_suggere VARCHAR(200),
    delai_jours    INT,                                 -- délai à calculer, le cas échéant
    actif          BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO declencheurs (source_domaine, source_code, type_evenement, libelle_suggere, delai_jours) VALUES
 ('type_courrier','assignation','audience','Audience de mise en état (assignation)',NULL),
 ('type_courrier','convocation','diligence','Rendez-vous / convocation à honorer',NULL),
 ('type_courrier','acte_huissier','delai','Calcul du délai (signification)',15),
 ('type_courrier','decision_justice','echeance','Délai de recours (décision)',30);
-- Rattachement de l'événement/diligence créé à la pièce et au dossier d'origine
ALTER TABLE evenements ADD COLUMN IF NOT EXISTS courrier_id UUID REFERENCES courriers(id);
ALTER TABLE diligences ADD COLUMN IF NOT EXISTS courrier_id UUID REFERENCES courriers(id);

-- =====================================================================
--  BIBLIOTHÈQUE — jurisprudence, textes OHADA/nationaux, veille
--  législative, modèles documentaires, consultations anonymisées,
--  checklists. Fichier associé optionnel (GED).
-- =====================================================================
CREATE TYPE type_ressource_biblio AS ENUM
  ('jurisprudence','texte_loi','veille','modele','consultation','checklist');

CREATE TABLE ressources_biblio (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type             type_ressource_biblio NOT NULL,
    titre            VARCHAR(300) NOT NULL,
    reference        VARCHAR(120),                       -- ex. « CCJA 045/2020 », « AUS »
    source           VARCHAR(80) DEFAULT 'National',      -- OHADA / National / Interne
    matiere          VARCHAR(120),
    date_publication DATE,
    resume           TEXT,
    chemin_storage   VARCHAR(500),                        -- fichier associé (Cloud Storage), optionnel
    type_mime        VARCHAR(120),
    cree_par         UUID REFERENCES utilisateurs(id),
    cree_le          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_biblio_type ON ressources_biblio(type);
CREATE INDEX idx_biblio_recherche ON ressources_biblio
  USING gin ((titre || ' ' || COALESCE(reference,'') || ' ' || COALESCE(matiere,'')) gin_trgm_ops);

-- =====================================================================
--  RÉTROCESSIONS D'HONORAIRES — calcul et suivi par qualité du
--  bénéficiaire. Règle « tout ou rien » : décaissable seulement une fois
--  la facture liée intégralement encaissée (vérifié côté application).
-- =====================================================================
CREATE TYPE qualite_retro AS ENUM ('associe', 'collaborateur', 'non_avocat');
-- Taux par défaut (modifiable au cas par cas) : associé 30 %,
-- collaborateur avocat/stagiaire/Of Counsel 25 %, collaborateur non-avocat 10 %.

CREATE TYPE statut_retro AS ENUM ('attente', 'a_decaisser', 'decaissee');

CREATE TABLE retrocessions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    beneficiaire_id UUID NOT NULL REFERENCES utilisateurs(id),
    qualite         qualite_retro NOT NULL,
    taux            NUMERIC(5,2) NOT NULL,               -- % appliqué (peut différer du taux par défaut)
    dossier_id      UUID REFERENCES dossiers(id) ON DELETE SET NULL,
    facture_id      UUID REFERENCES factures(id) ON DELETE SET NULL,
    base_ht         NUMERIC(14,0) NOT NULL DEFAULT 0,     -- honoraires HT servant de base au calcul
    montant         NUMERIC(14,0) NOT NULL DEFAULT 0,     -- base_ht * taux / 100
    statut          statut_retro NOT NULL DEFAULT 'attente',
    decaisse_par    UUID REFERENCES utilisateurs(id),
    decaisse_le     TIMESTAMPTZ,
    cree_par        UUID REFERENCES utilisateurs(id),
    cree_le         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_retro_beneficiaire ON retrocessions(beneficiaire_id);
CREATE INDEX idx_retro_statut ON retrocessions(statut);

COMMIT;

-- =====================================================================
--  FIN DU SCHÉMA MVP JURIA
--  Extensions prévues (post-MVP) : modèles d'actes & clauses types,
--  bibliothèque juridique, abonnements, portail client, signatures
--  électroniques, intégrations (WhatsApp, e-mail, agendas).
-- =====================================================================


-- =====================================================================
--  MODULE MULTI-DEVISES (option)  — ajout
--  Le franc CFA (XOF) reste la devise PIVOT légale et comptable (SYSCOHADA,
--  TVA/DGI en FCFA). Le multi-devises est une OPTION activée par dossier
--  (dossiers.multidevise) : tous les dossiers n'y sont pas soumis.
--  EUR : parité figée (1 EUR = 655,957 XOF). Devises flottantes (USD, GBP…):
--  taux du jour SAISI manuellement puis VERROUILLÉ à l'émission du document.
--  On stocke le taux appliqué, sa date et la contre-valeur FCFA (base
--  TVA/comptabilité). Pas de calcul automatique d'écart de change :
--  l'équivalence est saisie au taux du jour ; l'écart éventuel est traité
--  par le comptable hors application.
-- =====================================================================

CREATE TABLE devises (
    code        CHAR(3) PRIMARY KEY,               -- ISO 4217 : XOF, EUR, USD, GBP...
    libelle     VARCHAR(60) NOT NULL,
    symbole     VARCHAR(6),
    flottante   BOOLEAN NOT NULL DEFAULT TRUE,      -- FALSE = parité figée (XOF, EUR)
    parite_xof  NUMERIC(18,6),                      -- renseigné si figée (EUR = 655.957)
    actif       BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO devises (code,libelle,symbole,flottante,parite_xof) VALUES
 ('XOF','Franc CFA (BCEAO)','FCFA',FALSE,1),
 ('EUR','Euro','EUR',FALSE,655.957),
 ('USD','Dollar americain','USD',TRUE,NULL),
 ('GBP','Livre sterling','GBP',TRUE,NULL)
ON CONFLICT (code) DO NOTHING;

-- Taux de référence saisis (historique). Le taux réellement appliqué à un
-- document est copié et FIGÉ sur le document (colonnes taux_applique/date_taux).
CREATE TABLE taux_change (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    devise_code   CHAR(3) NOT NULL REFERENCES devises(code),
    taux_vers_xof NUMERIC(18,6) NOT NULL,           -- 1 unité de devise = X XOF
    date_taux     DATE NOT NULL DEFAULT current_date,
    source        VARCHAR(120),                     -- « saisie manuelle », « BCEAO », « banque »...
    saisi_par     UUID REFERENCES utilisateurs(id),
    cree_le       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (devise_code, date_taux)
);
INSERT INTO taux_change (devise_code,taux_vers_xof,source) VALUES
 ('EUR',655.957,'Parite fixe (arrimage FCFA)')
ON CONFLICT DO NOTHING;

-- Option multi-devises au niveau du dossier ; dossiers.devise = devise de négociation.
ALTER TABLE dossiers  ADD COLUMN IF NOT EXISTS multidevise BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE dossiers  ADD CONSTRAINT fk_dossiers_devise  FOREIGN KEY (devise) REFERENCES devises(code);

-- Facture bi-devise : montant_* exprimés dans « devise » ; contre-valeur FCFA figée.
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS taux_applique     NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS date_taux         DATE;
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS taux_verrouille   BOOLEAN NOT NULL DEFAULT FALSE;   -- figé à l'émission
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS montant_ttc_xof   NUMERIC(14,0);                     -- contre-valeur FCFA (base TVA/compta)
ALTER TABLE factures  ADD COLUMN IF NOT EXISTS libelle_principal VARCHAR(6) NOT NULL DEFAULT 'xof'; -- 'xof' | 'devise' : choix PAR facture
ALTER TABLE factures  ADD CONSTRAINT fk_factures_devise  FOREIGN KEY (devise) REFERENCES devises(code);
ALTER TABLE factures  ADD CONSTRAINT chk_factures_libelle CHECK (libelle_principal IN ('xof','devise'));

-- Débours / dépenses éventuellement engagés en devise.
ALTER TABLE depenses  ADD COLUMN IF NOT EXISTS devise        CHAR(3) NOT NULL DEFAULT 'XOF' REFERENCES devises(code);
ALTER TABLE depenses  ADD COLUMN IF NOT EXISTS taux_applique NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE depenses  ADD COLUMN IF NOT EXISTS montant_xof   NUMERIC(14,0);                        -- contre-valeur FCFA

-- Encaissements : devise reçue + équivalence FCFA au taux du jour.
ALTER TABLE paiements ADD COLUMN IF NOT EXISTS devise        CHAR(3) NOT NULL DEFAULT 'XOF' REFERENCES devises(code);
ALTER TABLE paiements ADD COLUMN IF NOT EXISTS taux_applique NUMERIC(18,6) NOT NULL DEFAULT 1;
ALTER TABLE paiements ADD COLUMN IF NOT EXISTS montant_xof   NUMERIC(14,0);                        -- montant encaissé converti en FCFA

-- Vue de contrôle : équivalence FCFA d'une facture.
CREATE OR REPLACE VIEW v_factures_devise AS
SELECT f.id, f.numero, f.devise, f.libelle_principal, f.taux_applique, f.date_taux,
       f.montant_ttc AS montant_ttc_devise,
       COALESCE(f.montant_ttc_xof, ROUND(f.montant_ttc * f.taux_applique)) AS contre_valeur_xof
FROM factures f;
-- ===================== FIN MODULE MULTI-DEVISES =====================
