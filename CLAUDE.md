# JURIA — Contexte du projet

## Description
JURIA est une application de gestion de cabinet d'avocats développée pour **JFC Avocats Mali** (droit OHADA). Elle couvre l'ensemble du cycle de vie du cabinet : dossiers, clients/KYC, procédure et échéances, facturation, gestion administrative/RH, et un assistant IA d'aide à la rédaction.
Dépôt GitHub : https://github.com/momodaou/juria.git

Spécification initiale : démo interactive HTML (`JURIA demo - MAJ 09.08.2026.html`) fournie par l'utilisateur, retranscrite dans `DOC/JURIA - Dossier de Specifications Fonctionnelles - MAJ 16.08.2026.docx`.

### Périmètre fonctionnel (17 modules)
1. **Cockpit** — vue d'ensemble et pilotage du cabinet (KPIs, délais critiques, rentabilité, tâches perso)
2. **Dossiers 360** — liste des dossiers + fiche 360° (parties, délais, pièces, temps, communications, instances)
3. **Nouveau dossier (ouverture)** — contrôle des conflits d'intérêts puis création (référence, lettre de mission, KYC, tâches auto)
4. **Clients & KYC** — registre clients, suivi KYC/LBC-FT, registre des originaux physiques confiés
5. **Échéancier** — délais de procédure par dossier + échéances administratives récurrentes (fiscal, social, ordinal)
6. **Rôle d'audience** — agenda hebdomadaire des audiences, diffusion équipe, planning des diligences, retours d'audience
7. **Registre du courrier** — enregistrement arrivée/départ, référencement auto, GED, déclenchement d'événements
8. **Atelier d'actes** — génération d'actes via modèle GED ou draft IA, visas à jour, en-tête cabinet
9. **Bibliothèque** — jurisprudence, textes OHADA, veille législative, modèles, consultations, checklists
10. **Plan d'action** — suivi des tâches du cabinet en kanban (à faire/en cours/à valider/terminé)
11. **Chrono & Facturation** — édition auto de factures/notes de frais, TVA selon localisation client, multi-devises, suivi des impayés
12. **Dépenses & caisse** — charges du cabinet, débours clients refacturables, petite caisse, vignettes de plaidoirie
13. **Rétrocessions** — calcul et suivi des rétrocessions d'honoraires (Associé 30% / Collab. avocat-stagiaire-Of Counsel 25% / Collab. non-avocat 10%, "tout ou rien" après encaissement intégral), suivi Pro Bono
14. **Accès & permissions** — matrice d'accès (Collaborateur / Associé-Partner / Finance-Direction), délégations temporaires, journal d'audit
15. **Cabinet (RH)** — équipe et charge de travail, congés, alertes RH, pointage, compteur d'heures, option paie légère
16. **Assistant IA** — capacités d'assistance (résumé, extraction de faits, chronologie, analyse contractuelle, traduction, comparaison) — phase à valider
17. **Portail client** — extranet client (dossiers, factures, messagerie) — phase 4

### Acteurs / rôles
Associé, Of Counsel, Collaborateur avocat, Avocat stagiaire, Collaborateur non-avocat/Juriste, Administrateur, Comptable, Client (via portail).

### Règles métier transverses clés
- Export Excel/CSV + impression PDF (en-tête cabinet) sur chaque écran
- Alertes par délai : J-7 rouge / J-15 orange / au-delà bleu
- Gestion multi-instance (1re instance / appel / cassation-CCJA) sous référence de dossier unique
- FCFA devise pivot, EUR à taux fixe (655,957), autres devises au taux du jour verrouillé à l'émission
- Échéances fiscales/sociales maliennes pré-paramétrées (TVA, INPS, ITS, IS, patente, Ordre des avocats, RC pro)

## Structure du dépôt
- `APP/` — code source de l'application
- `DOC/` — documentation du projet
- `CLAUDE.md` — ce fichier : contexte pour les futures sessions
- `HISTORY.md` — journal chronologique des actions/décisions

## Stack technique (réelle, adoptée le 16/08/2026)

> ⚠️ Cette stack remplace une proposition initiale (Next.js/TypeScript + Prisma) écartée après découverte d'un kit de démarrage déjà préparé par l'utilisateur (`JURIA kit demarrage - MAJ 09.08.2026.zip`), utilisé comme base réelle du projet. Voir `HISTORY.md` (entrée du 16/08/2026, "Pivot stack technique").

### Frontend
- **Angular 22** (standalone components, signals, `@if`/`@for`), TypeScript
- Projet complet dans `APP/frontend/` (scaffoldé via `@angular/cli@22`)

### Backend
- **API Node.js/Express** (JavaScript, pas TypeScript), dans `APP/backend/`
- Auth par JWT (`jsonwebtoken` + `bcryptjs`), pas de framework auth tiers
- Upload fichiers : `multer` ; stockage GED : `@google-cloud/storage`

### Base de données
- **PostgreSQL 15**, schéma SQL géré à la main (`APP/db/schema.sql`, pas d'ORM/Prisma) — 36+ tables (dossiers, clients, facturation, rétrocessions, échéances, RH, etc.)
- Client : `pg` (requêtes SQL directes, pas de query builder)

### Déploiement — Google Cloud Platform
- **Compute** : Cloud Run (conteneur API Node.js)
- **Base** : Cloud SQL for PostgreSQL
- **Stockage** : Google Cloud Storage (GED)
- **Secrets** : Secret Manager
- Script de référence : `JURIA deploiement gcp - MAJ 01.08.2026.sh` (dans les Documentations utilisateur, à intégrer dans le dépôt)
- Domaine cible : `extranet.jfcavocats-mali.com`

### IA
- Assistant IA prévu via Gemini/Vertex AI (`IA_MODEL=gemini-1.5-flash` dans `.env.example`) — `backend/src/ia.js`

### Développement local
- **Docker** pour tout (Node.js n'est pas installé sur la machine de dev actuelle) : `docker compose up --build` (API + Postgres), front lancé via conteneur `node:22` (voir `APP/README.md`)

## Conventions
- Code backend/DB en français fonctionnel (noms de tables/colonnes, ex: `dossiers`, `utilisateurs`, `mot_de_passe`) — cohérent avec le kit existant, à conserver
- Toute décision structurante doit être consignée dans `HISTORY.md`

## État actuel
- Dépôt git initialisé, lié à `origin` (https://github.com/momodaou/juria.git), poussé (branche `main`).
- `APP/` : kit de démarrage intégré et vérifié fonctionnel (16/08/2026) — backend Node/Express + PostgreSQL 15 démarrent via Docker, schéma chargé (36 tables), authentification JWT testée avec succès (login + endpoints protégés `/api/dashboard`, `/api/dossiers`). Frontend Angular 22 scaffoldé et overlayé avec le socle du kit (login, cockpit, dossiers, fiche dossier, ouverture, échéancier, facturation) — build vérifié sans erreur.
- **Déployé sur GCP (projet `jfc-juria`, région `europe-west1`)** :
  - Frontend : https://juria-web-552099340909.europe-west1.run.app
  - API : https://juria-552099340909.europe-west1.run.app
  - Compte de test : `associe@jfcavocats-mali.com` / `DemoPass123!`
  - Ressources : Cloud SQL PostgreSQL (`juria-pg`), bucket GCS (`jfc-juria-ged`), Secret Manager (`juria-db-password`, `juria-jwt-secret`), Artifact Registry (`juria`)
  - `scripts/gcloud-docker.sh` : wrapper pour piloter `gcloud` via Docker (aucun outil GCP installé sur l'hôte)
- **Les 17 modules de la spécification fonctionnelle sont développés** (backend + écran), avec les limitations ci-dessous documentées plutôt que masquées :
  - **Clients & KYC** — registre, fiche 360°, pièces KYC avec alertes d'expiration, originaux confiés
  - **Rôle d'audience** — agenda hebdomadaire, validation/diffusion, retours d'audience avec renvoi automatique au rôle suivant
  - **Registre du courrier** — arrivée/départ, référencement auto, déclenchement automatique d'événements/diligences/tâches
  - **Atelier d'actes** — génération via modèles internes (codés en dur, pas de table) ou brouillon Assistant IA, enregistré dans la GED
  - **Bibliothèque** — jurisprudence/textes/veille/modèles/consultations/checklists, nouvelle table `ressources_biblio`
  - **Plan d'action** — kanban sur la table `taches` déjà prévue par le kit
  - **Dépenses & caisse** — circuit soumise→validée/rejetée→décaissée, petite caisse, vignettes de plaidoirie
  - **Rétrocessions** — calcul par qualité (30/25/10 %), règle « tout ou rien », Pro Bono, nouvelle table `retrocessions`
  - **Accès & permissions** — rôles, délégations, journal d'audit, **création de compte + validation à l'entrée** (17/08/2026 : un compte créé par un associé/admin démarre **inactif** avec un mot de passe temporaire généré côté serveur — affiché une seule fois, jamais journalisé — et ne devient utilisable qu'après une validation explicite distincte d'une simple réactivation ; distinction "en attente"/"suspendu" via la colonne `utilisateurs.valide_le`, voir ci-dessous)
  - **Cabinet/RH** — équipe, congés (nouvelle table `conges`), pointage, échéances RH, bulletins de paie légers
  - **Assistant IA** — 6 capacités (résumé, chronologie, extraction de faits, analyse contractuelle, traduction, comparaison), toutes en `POST /api/ia/*`, garde-fou « projet à valider » systématique
  - **Portail client** — écran d'**aperçu** côté cabinet (pas un vrai extranet client) : simule ce qu'un client verrait pour un dossier (documents, factures) ; **aucune authentification client séparée, aucune messagerie réelle** — délibérément non implémenté (nécessiterait un système d'auth distinct, hors scope de cette session), conforme au statut « phase 4 » du schéma lui-même (commentaire de fin de `schema.sql`)
- **Cycle de vie d'un compte** (17/08/2026) : `POST /api/acces/utilisateurs` crée le compte avec `actif=FALSE` et renvoie un mot de passe temporaire en clair (une seule fois, dans la réponse HTTP — jamais stocké en clair ni journalisé) ; `POST /api/acces/utilisateurs/:id/valider` l'active la première fois (`valide_par`/`valide_le` renseignés, refuse si déjà validé) ; `PUT /api/acces/utilisateurs/:id/actif` reste utilisé pour suspendre/réactiver un compte déjà validé. Trois états dérivés côté UI : `actif=TRUE` → Actif ; `actif=FALSE ET valide_le IS NULL` → en attente de validation ; `actif=FALSE ET valide_le IS NOT NULL` → suspendu.
- **Changement de mot de passe en libre-service** (17/08/2026) : nouvelle route `GET/PUT /api/profil` (`backend/src/routes/profil.js`, montée sans restriction de rôle — accessible à tout utilisateur authentifié, contrairement à `/api/acces`). `PUT /api/profil/mot-de-passe` exige l'ancien mot de passe, ≥8 caractères, différent de l'ancien. Écran `Mon compte` (`pages/mon-compte/`) accessible depuis le menu par tous.
- **Réinitialisation de mot de passe par un admin** (17/08/2026, comble le gap ci-dessus) : `POST /api/acces/utilisateurs/:id/reinitialiser-mot-de-passe` (associé/admin) génère un nouveau mot de passe temporaire pour un compte existant, sans toucher à `actif`/`valide_le` (contrairement à la création, le compte garde son statut — pas de re-validation à faire). Réutilise le même générateur que la création de compte. Bouton « Réinit. mot de passe » sur chaque membre dans l'écran Accès & permissions, réutilise le même bandeau d'affichage unique du mot de passe.
  - ⚠️ **Gap restant** : toujours pas de flux self-service « mot de passe oublié » pour l'utilisateur lui-même (il doit demander à un associé/admin) — acceptable pour un petit cabinet, mais pas d'auto-service depuis l'écran de connexion. Pas d'envoi automatique par e-mail non plus (communication manuelle).
- **Audit du 17/08/2026** (routes + sécurité + infra GCP + CI/CD, rapport complet dans `HISTORY.md`) :
  - Les 5 routes jamais testées (`temps.js`, `evenements.js`, `communications.js`, `documents.js`, `dashboard.js`) ont été auditées : `temps.js`/`evenements.js`/`dashboard.js` sont corrects ; `documents.js` avait le même bug de typage enum que les autres (corrigé, cast explicite `::categorie_document`/`::confidentialite`) ; `communications.js` manque juste une validation d'entrée sur `type` (mineur, non corrigé).
  - Points vérifiés conformes : bucket GCS correctement privé (accès uniforme, aucune liaison publique), invocation publique des services Cloud Run intentionnelle (sécurité déléguée à la couche JWT applicative).
- **Corrections de l'audit appliquées le 17/08/2026 (priorités 1 à 3 sur 5, avec l'accord de l'utilisateur)** :
  - **Comptes de service dédiés** : `juria-api-sa@jfc-juria.iam.gserviceaccount.com` (droits : `roles/cloudsql.client` au niveau projet, `roles/storage.objectAdmin` limité au bucket `jfc-juria-ged`, `roles/secretmanager.secretAccessor` sur `juria-db-password`/`juria-jwt-secret` uniquement) et `juria-web-sa@jfc-juria.iam.gserviceaccount.com` (aucun droit GCP, le frontend n'en a pas besoin). Les deux services Cloud Run ont été basculés dessus (`gcloud run services update --service-account=...`) et re-testés avec succès (santé, connexion, DB, upload GED). Le compte Compute par défaut garde `roles/editor` au niveau projet (non retiré — modification plus large et plus risquée, délibérément laissée de côté) mais **n'est plus utilisé par aucun des deux services**.
  - **Sauvegardes Cloud SQL activées** : quotidiennes à 03h00, 7 conservées, + récupération à un instant T (`pointInTimeRecoveryEnabled: true`).
  - **CORS restreint** : `server.js` n'accepte plus que les origines listées dans `ALLOWED_ORIGINS` (variable d'env, virgules), repli par défaut sur le frontend Cloud Run + `localhost:4200` (dev local).
  - **Limitation de débit sur `/auth/login`** : `express-rate-limit`, 10 tentatives / 15 min / IP, réponse 429 au-delà. Nécessite `app.set("trust proxy", 1)` dans `server.js` (Cloud Run place l'app derrière le proxy front-end de Google — sans ce réglage, `req.ip` renvoie l'IP du proxy pour tout le monde, et la limite se partagerait entre tous les utilisateurs au lieu d'être par IP réelle). Ce réglage profite aussi à la capture d'IP du journal d'audit (`logAudit`), qui utilisait déjà `req.ip`.
  - **Helmet** : `app.use(helmet(...))` avec `contentSecurityPolicy: false` (API JSON pure, la CSP n'a pas d'objet) et `crossOriginResourcePolicy: { policy: "cross-origin" }` (nécessaire car le frontend et l'API sont deux origines Cloud Run distinctes qui échangent des fichiers). Vérifié : en-têtes présents (`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`), téléchargement inter-origines toujours fonctionnel.
  - **Filtrage de type sur les téléversements** : nouveau module `backend/src/uploadFilter.js` (liste blanche : PDF, images, Word/Excel/PowerPoint, texte brut), branché en `fileFilter` sur les 3 points de téléversement (`documents.js`, `clients.js` pièces KYC, `biblio.js`). Un gestionnaire d'erreurs global ajouté dans `server.js` (après le 404) pour que le rejet remonte en JSON propre plutôt qu'en page d'erreur HTML par défaut d'Express.
  - **SSL forcé sur Cloud SQL** (`requireSsl: true`) — sans impact sur Cloud Run (le connecteur Cloud SQL Auth Proxy chiffre déjà le trafic indépendamment de ce réglage, qui vise les connexions directes par IP).
  - **IP publique Cloud SQL non retirée — décision volontaire** : la désactiver proprement demanderait de mettre en place l'accès de service privé (VPC peering) + un connecteur Serverless VPC Access pour Cloud Run (coût récurrent, changement de topologie réseau) puisqu'aucune IP privée n'existe aujourd'hui sur l'instance — la couper sans ce préalable couperait tout accès à la base. Jugé disproportionné pour le gain (l'IP publique n'a aucun réseau autorisé configuré, donc déjà fermée aux connexions directes). Laissé tel quel, à réévaluer si besoin.
  - Non fait (CI/CD, tests automatisés) : voir entrée dédiée si/quand traitée.
- Limitations transverses à connaître :
  - Le journal d'audit (`journal_audit`) n'est alimenté que par la connexion et les actions du module Accès & permissions — le reste de l'application (dossiers, factures, dépenses…) n'y écrit pas (retrofit complet non fait, hors scope)
- Nouvelle route `GET /api/utilisateurs` (annuaire interne, `backend/src/routes/utilisateurs.js`) — à réutiliser pour tout sélecteur de responsable/affectation (RH, permissions…) plutôt que d'en recréer une.
- Note : le schéma SQL ne comportait pas de table dédiée « modèles/bibliothèque » — l'Atelier d'actes utilise des modèles codés en dur côté serveur (`backend/src/routes/actes.js`, objet `MODELES`), distincts de la table `ressources_biblio` (ajoutée le 16/08/2026 pour le module Bibliothèque, catalogue consultable avec fichier optionnel — pas un moteur de fusion de champs).
- ⚠️ Motif récurrent de bug rencontré : dans ce codebase (SQL brut, pas d'ORM), `COALESCE($n, 'litteral')` ou `CASE WHEN $n = 'litteral' THEN…` sur une colonne de type ENUM **ou UUID** Postgres provoque une erreur de typage dès que le paramètre est réutilisé dans un contexte non typé. Toujours caster explicitement (`$n::mon_enum`, `$n::uuid`) ou dupliquer le paramètre. Autre variante rencontrée : un placeholder `$n` numéroté mais jamais réellement utilisé dans le texte SQL (reliquat de refactoring) fait échouer `could not determine data type of parameter $n` — vérifier que chaque `$n` du tableau de paramètres correspond bien à une occurrence dans la requête. Déjà corrigé dans `dossiers.js`, `audiences.js`, `courriers.js`, `taches.js`, `documents.js`, `cabinet.js`. **Audit terminé à 100 % (17/08/2026)** : toutes les routes backend ont été relues/testées, y compris `factures.js` (relu et testé en Docker — pas de bug, l'unique `COALESCE($9,0)` porte sur un numérique, pas une chaîne face à un enum).
- **Suite de tests de non-régression** (17/08/2026, `backend/tests/`) : Jest + Supertest, ciblée précisément sur le motif de bug ci-dessus plutôt qu'une couverture exhaustive (jugé suffisant face à CI/CD lors de l'échange « Est-ce important ? » — voir `HISTORY.md`). `tests/setup.js` crée un utilisateur de test idempotent ; `tests/regression.test.js` couvre 2 tests de connexion + 6 tests POST minimalistes (sans les champs enum/UUID optionnels) sur les 6 routes historiquement buguées. `server.js` exporte désormais `app` sans effet de bord (`app.listen()` gardé par `if (require.main === module)`) pour être importable par supertest. **Validé comme vrai filet de sécurité** : le bug a été réintroduit délibérément dans `taches.js` pour confirmer que le test correspondant vire au rouge (échec confirmé, 400 au lieu de 201), puis le correctif restauré et la suite revérifiée au vert (8/8). Lancement : voir `APP/README.md`. Non lancée automatiquement (pas de CI/CD) — à exécuter manuellement avant un déploiement qui touche aux routes concernées.
- `DOC/` : `JURIA - Dossier de Specifications Fonctionnelles - MAJ 16.08.2026.docx` (17 modules détaillés, généré à partir de la démo HTML fournie par l'utilisateur).

## Notes pour les futures sessions Claude
- Avant toute action structurante (choix de librairie, changement de stack, décision d'architecture), consigner l'entrée correspondante dans `HISTORY.md`.
- Ce fichier (`CLAUDE.md`) doit être tenu à jour à chaque évolution significative de la stack ou de l'organisation du projet.
