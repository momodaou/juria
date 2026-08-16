# JURIA — Historique des actions

Journal chronologique des décisions et actions structurantes du projet.
Chaque entrée : date, résumé, fichiers/éléments concernés.

---

## 2026-08-16 — Initialisation du projet

- Création du contexte projet (`CLAUDE.md`) et du présent journal (`HISTORY.md`).
- Dépôt GitHub cible défini : https://github.com/momodaou/juria.git
- Stack technique validée avec l'utilisateur :
  - Frontend/Backend : Next.js 14+ (TypeScript), Tailwind CSS + shadcn/ui, Docker
  - Déploiement : Google Cloud Platform — Cloud Run + Cloud Build + Artifact Registry
  - Base de données : Cloud SQL for PostgreSQL + Prisma ORM
  - Stockage : Google Cloud Storage (GCS)
  - Auth : Auth.js (NextAuth) ou Identity Platform
  - Secrets : Secret Manager
  - IA : API Anthropic (Claude) ou Vertex AI Model Garden
- Structure de dossiers existante conservée : `APP/` (code source), `DOC/` (documentation).
- Dépôt git local **non initialisé** à ce stade.

## 2026-08-16 — Initialisation git

- `git init` exécuté à la racine du projet.
- Remote `origin` ajouté : https://github.com/momodaou/juria.git
- Aucun commit ni push effectué à ce stade (aucun fichier ajouté à l'index).

## 2026-08-16 — Premier commit

- Ajout de `.gitkeep` dans `APP/` et `DOC/` (dossiers vides, non suivis par git sans contenu).
- Commit initial `b478e20` sur la branche `main` : `CLAUDE.md`, `HISTORY.md`, `APP/.gitkeep`, `DOC/.gitkeep`.
- Identité git corrigée (config locale au dépôt) : `Mohamed <mohameddaou22@gmail.com>` — commit amendé, nouveau hash `a981035`.

## 2026-08-16 — Push initial vers GitHub

- Push de `main` vers `origin` (https://github.com/momodaou/juria.git) réalisé via token d'accès personnel (fourni ponctuellement par l'utilisateur, utilisé une seule fois sans stockage permanent dans `.git/config`, puis tracking rebasculé proprement sur `origin/main`).
- ⚠️ Le token a transité en clair dans la conversation : l'utilisateur a été invité à le révoquer immédiatement sur GitHub et à en générer un nouveau.

## 2026-08-16 — Spécification fonctionnelle initiale à partir de la démo HTML

- Source utilisée comme spécification de démarrage : `JURIA demo - MAJ 09.08.2026.html` (prototype interactif fourni par l'utilisateur, dossier Documentations MAJ 09.08.2026), complétée par `JURIA A remettre au developpeur - MAJ 09.08.2026.md`.
- Analyse déléguée à un agent : extraction des 17 modules fonctionnels, des entités de données, règles de gestion et nomenclatures depuis le code de la démo (objet `DB` + fonctions de rendu par écran).
- Génération du livrable `DOC/JURIA - Dossier de Specifications Fonctionnelles - MAJ 16.08.2026.docx` (via `python-docx`, installé pour l'occasion) : page de garde, sommaire, 8 sections (contexte, périmètre, acteurs, spécifications détaillées des 17 modules, modèle de données transverse, règles métier transverses, exigences non-fonctionnelles, annexe nomenclatures) — 577 paragraphes, 32 tableaux.
- `CLAUDE.md` mis à jour avec la description métier réelle de JURIA (17 modules, acteurs, règles transverses) en remplacement de la description générique initiale.
- Domaine métier confirmé : gestion de cabinet d'avocats (droit OHADA), pour JFC Avocats Mali.

## 2026-08-16 — Push de la spécification fonctionnelle

- Commit `38c1d81` (mise à jour `CLAUDE.md`/`HISTORY.md` + ajout du docx de spécifications fonctionnelles) poussé vers `origin/main`.

## 2026-08-16 — Pivot stack technique : abandon de Next.js/Prisma au profit du kit existant

- Avant de démarrer l'implémentation, découverte dans le dossier Documentations utilisateur de plusieurs fichiers déjà préparés et non utilisés jusqu'ici : `JURIA kit demarrage - MAJ 09.08.2026.zip` (code de démarrage réel), `JURIA schema complet - MAJ 01.08.2026.sql`, `JURIA deploiement gcp - MAJ 01.08.2026.sh`, `JURIA Plan de mise en oeuvre MVP - MAJ 09.08.2026.docx`.
- Le kit de démarrage révèle une stack différente de celle proposée initialement par Claude (Next.js/TypeScript/Prisma) : **Angular 22 (front) + API Node.js/Express (back) + PostgreSQL 15 (base) + Google Cloud (hébergement)**, avec schéma SQL complet, JWT/bcrypt pour l'auth, et du code fonctionnel pour plusieurs écrans/routes.
- Question posée à l'utilisateur : reprendre le kit existant vs. continuer sur la proposition Next.js/Prisma vs. hybride. **Décision : reprendre le kit existant** (cohérent avec le dossier de spécifications fonctionnelles déjà produit, et avec du travail déjà engagé par l'utilisateur).
- `CLAUDE.md` corrigé en conséquence (section stack technique entièrement réécrite).

## 2026-08-16 — Intégration et vérification du kit de démarrage dans APP/

- Constat : Node.js/npm/Angular CLI/Homebrew non installés sur la machine de développement. Docker (Desktop) disponible et fonctionnel → choix de tout faire passer par Docker plutôt que d'installer Node sur l'hôte.
- Kit extrait et intégré dans `APP/` : `backend/` (API Express complète avec routes auth, dossiers, clients, dashboard, communications, documents, evenements, taches, temps, factures, ia), `db/schema.sql` + `seed_utilisateurs.sql`, `docker-compose.yml`, `Dockerfile`, `.env.example`.
- Frontend : projet Angular 22 scaffoldé de zéro via `docker run node:22 npx @angular/cli@latest new` (le kit ne fournissait que des fichiers source à intégrer, pas un projet Angular complet), puis overlay du socle fourni par le kit (`app.component.ts`, `app.routes.ts`, `app.config.ts`, `core/*`, `pages/*` : login, cockpit, dossiers, dossier-detail, ouverture, echeancier, facturation) par-dessus le squelette généré.
- Vérifications effectuées :
  - `npm run build` (Angular, via Docker) : succès, aucune erreur de compilation.
  - `docker compose up --build` : PostgreSQL 15 + API démarrent, schéma chargé automatiquement (36 tables créées).
  - `curl /health` → `{"status":"ok","service":"juria-api"}`.
  - Création d'un utilisateur de test (hash bcrypt), `POST /auth/login` → jeton JWT valide obtenu.
  - Appels authentifiés `GET /api/dashboard` et `GET /api/dossiers` avec le jeton → réponses correctes (listes vides, base fraîche).
  - Environnement Docker arrêté (`docker compose down`) après vérification.
- Ajout d'un `.gitignore` racine (`node_modules/`, `dist/`, `.env`, `.angular/`, fichiers système/IDE) — le dépôt ne contient aucune dépendance installée.
- `APP/README.md` réécrit pour refléter la structure réelle, les commandes de démarrage (Docker), l'état vérifié, et les modules/routes restant à développer.
- `CLAUDE.md` mis à jour (état actuel) pour refléter le kit intégré et fonctionnel.
- Non fait à ce stade : écrans Angular et routes backend pour les modules restants (Clients & KYC, Rôle d'audience, Registre du courrier, Atelier d'actes, Bibliothèque, Plan d'action dédié, Dépenses & caisse, Rétrocessions, Accès & permissions, Cabinet RH, Assistant IA, Portail client) ; script de déploiement GCP pas encore intégré au dépôt (reste dans les Documentations utilisateur) ; pas de service `frontend` dans `docker-compose.yml`.

## 2026-08-16 — Déploiement sur Google Cloud Platform

- Outillage : ni `gcloud`, ni Node.js, ni Homebrew installés sur la machine → `gcloud` piloté via l'image Docker officielle `google/cloud-sdk:slim`, avec un script wrapper `scripts/gcloud-docker.sh` (identifiants persistés dans `~/.config/gcloud`).
- Incident : la tentative initiale d'installation native de `gcloud` (`curl https://sdk.cloud.google.com | bash`) a échoué deux fois — d'abord un dossier d'installation corrompu (`~/gcloud auth login/google-cloud-sdk`, les deux commandes lancées coup sur coup se sont mélangées), puis une incompatibilité Python (le SDK embarque du code nécessitant Python ≥ 3.10, alors que le système n'a que Python 3.9). D'où le choix de la solution Docker.
- Authentification : l'utilisateur s'est connecté lui-même via `gcloud auth login` (compte `mohameddaou22@gmail.com`) dans son propre terminal, avec les identifiants persistés sur le disque et réutilisés depuis les commandes pilotées par Claude.
- Compte de facturation créé par l'utilisateur (`010B2E-59A2A6-A7C5B4`) — étape qu'il a dû faire lui-même (moyen de paiement).
- Décisions validées avec l'utilisateur avant de lancer : nouveau projet GCP (`jfc-juria`), authentification faite par l'utilisateur, démarrage avec l'URL Cloud Run par défaut (pas de mapping de domaine personnalisé `extranet.jfcavocats-mali.com` pour l'instant).
- Ressources provisionnées dans le projet `jfc-juria` (région `europe-west1`) :
  - APIs activées : Cloud Run, Cloud SQL Admin, Cloud Storage, Secret Manager, Artifact Registry, Cloud Build
  - Artifact Registry `juria` (dépôt Docker)
  - Cloud SQL PostgreSQL 15 (`juria-pg`, tier `db-g1-small`), base `juria`, utilisateur applicatif `juria_app`
  - Bucket Cloud Storage `jfc-juria-ged` (GED)
  - Secrets dans Secret Manager : `juria-db-password`, `juria-jwt-secret` (générés aléatoirement, jamais affichés/committés)
- Schéma chargé sur Cloud SQL via `gcloud sql import sql` (upload temporaire sur GCS, supprimé après import) ; droits accordés à `juria_app` sur toutes les tables/séquences/fonctions du schéma `public`.
- Backend déployé sur Cloud Run (service `juria`) : image buildée via Cloud Build, connectée à Cloud SQL via socket Unix (`--add-cloudsql-instances`), secrets injectés via Secret Manager. Accès au Secret Manager accordé au compte de service Cloud Run par défaut (`...-compute@developer.gserviceaccount.com`).
- Frontend Angular buildé en configuration production (`environment.prod.ts` + `fileReplacements` ajoutés à `angular.json`, absents du kit initial) pointant vers l'URL de l'API, packagé dans une image Docker multi-étapes (Node build → Nginx), déployée sur Cloud Run (service `juria-web`).
- Titre de la page HTML corrigé ("Frontend" → "JURIA — JFC Avocats Mali").
- Ajout de `APP/.gcloudignore` pour éviter d'uploader `frontend/node_modules` (224 Mio constatés) lors des builds Cloud Build du backend.
- Vérifications finales : les deux services répondent en HTTP 200 ; connexion (utilisateur de test créé directement sur la base Cloud SQL de prod) + appel authentifié `/api/dashboard` testés avec succès depuis l'URL Cloud Run publique.
- **URLs de production** : frontend `https://juria-web-552099340909.europe-west1.run.app`, API `https://juria-552099340909.europe-west1.run.app`.
- Fichiers temporaires de setup (schema.sql, grants.sql, insert_user.sql) supprimés du bucket GCS après usage.
- Non fait : mapping du domaine personnalisé `extranet.jfcavocats-mali.com`, CI/CD automatisé (déploiement fait manuellement via Cloud Build à la demande), durcissement sécurité (CORS actuellement ouvert à tous les domaines — `app.use(cors())` sans restriction), environnements séparés recette/production.
