# JURIA — Contexte du projet

## Description
JURIA est une application (domaine juridique/legaltech) en cours de démarrage.
Dépôt GitHub : https://github.com/momodaou/juria.git

## Structure du dépôt
- `APP/` — code source de l'application
- `DOC/` — documentation du projet
- `CLAUDE.md` — ce fichier : contexte pour les futures sessions
- `HISTORY.md` — journal chronologique des actions/décisions

## Stack technique cible

### Frontend / Backend
- Next.js 14+ (App Router), TypeScript
- Tailwind CSS + shadcn/ui
- Conteneurisation Docker

### Déploiement — Google Cloud Platform
- **Compute** : Cloud Run (conteneur Next.js, serverless, scale-to-zero)
- **CI/CD** : Cloud Build (repo GitHub → build Docker → Artifact Registry → deploy Cloud Run)
- **IaC** : Terraform (à mettre en place quand le projet grossit)

### Base de données
- Cloud SQL for PostgreSQL (managé)
- Prisma ORM pour schéma/migrations
- Connexion via Cloud SQL Auth Proxy (ou VPC Connector + IP privée)

### Stockage
- Google Cloud Storage (GCS) pour documents/contrats/pièces jointes

### Auth
- Auth.js (NextAuth) avec adaptateur Postgres, ou Identity Platform (Firebase Auth GCP) si gestion d'identité managée souhaitée

### Secrets
- Secret Manager (jamais de secrets en clair dans le repo ou les variables d'env)

### IA
- API Anthropic (Claude) en direct, ou Vertex AI Model Garden pour rester dans l'écosystème IAM/facturation GCP

### Recherche
- Full-text search PostgreSQL pour démarrer ; évolution possible vers Vertex AI Search

## Conventions
- Langue du code/commentaires : à définir (par défaut : français pour la doc métier, anglais pour le code si l'équipe s'internationalise)
- Un seul langage (TypeScript) frontend/backend pour limiter la friction
- Toute décision structurante doit être consignée dans `HISTORY.md`

## État actuel
Projet à l'état initial — arborescence vide (`APP/`, `DOC/`), aucun code applicatif, pas encore de dépôt git local initialisé.

## Notes pour les futures sessions Claude
- Avant toute action structurante (choix de librairie, changement de stack, décision d'architecture), consigner l'entrée correspondante dans `HISTORY.md`.
- Ce fichier (`CLAUDE.md`) doit être tenu à jour à chaque évolution significative de la stack ou de l'organisation du projet.
