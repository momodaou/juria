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
- Modules restant à développer (backend + écrans) : Clients & KYC, Rôle d'audience, Registre du courrier, Atelier d'actes, Bibliothèque, Plan d'action, Dépenses & caisse, Rétrocessions, Accès & permissions, Cabinet (RH), Assistant IA, Portail client. Voir `APP/README.md` § 5-6.
- `DOC/` : `JURIA - Dossier de Specifications Fonctionnelles - MAJ 16.08.2026.docx` (17 modules détaillés, généré à partir de la démo HTML fournie par l'utilisateur).

## Notes pour les futures sessions Claude
- Avant toute action structurante (choix de librairie, changement de stack, décision d'architecture), consigner l'entrée correspondante dans `HISTORY.md`.
- Ce fichier (`CLAUDE.md`) doit être tenu à jour à chaque évolution significative de la stack ou de l'organisation du projet.
