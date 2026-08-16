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
