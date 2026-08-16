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

## 2026-08-16 — Sidebar dockable + icônes

- `app.component.ts` : menu latéral transformé en dockable (bouton chevron en tête de sidebar, état plié/déplié mémorisé en `localStorage` sous `juria.sidebar.dock`), transition CSS fluide sur `grid-template-columns`.
- Chaque entrée du menu (Cockpit, Dossiers, Nouveau dossier, Clients & KYC, Échéancier, Facturation) dotée d'une icône SVG trait (style Feather-like, `currentColor`), injectée via `DomSanitizer.bypassSecurityTrustHtml` (contenu statique codé en dur, pas d'entrée utilisateur) pour éviter que le sanitizer HTML par défaut d'Angular ne filtre les balises SVG.
- En mode replié : sidebar réduite à un bandeau d'icônes (~68px), libellés masqués, `title`/`aria-label` conservés pour l'accessibilité et l'infobulle au survol.
- Build Angular (`ng build --configuration production`, via Docker `node:22`) vérifié sans erreur après modification.

## 2026-08-16 — Module Clients & KYC

- Backend (`APP/backend/src/routes/clients.js`, réécrit) : `GET /api/clients` (recherche + filtre par statut KYC, compte de pièces expirées), `GET /api/clients/:id` (fiche 360° : infos, pièces KYC, dossiers liés, originaux confiés, liens), `POST /api/clients`, `PUT /api/clients/:id` (coordonnées + statut KYC), `GET/POST/DELETE /api/clients/:id/kyc-pieces` (upload via `multer` + `storage.js`, téléchargement), `GET /api/clients/kyc/alertes` (pièces expirées ou expirant sous N jours, toutes fiches).
- Suppression du doublon `POST /api/clients/conflict-check` (legacy, jamais appelé par le frontend — le contrôle des conflits passe par `routes/conflicts.js` / `/api/conflict-checks`).
- Nouvelle route `APP/backend/src/routes/originaux.js` (`/api/originaux`) : registre des originaux/pièces physiques confiés (création, liste filtrable par client/dossier/statut, marquage « restitué »).
- Nouvelle route `APP/backend/src/routes/listes.js` (`/api/listes-valeurs?domaine=`) : expose les nomenclatures de la table `listes_valeurs` (ex. `type_original`), réutilisable par les futurs modules.
- `server.js` : montage des routes `/api/originaux` et `/api/listes-valeurs`.
- Frontend : nouvelles pages `pages/clients/clients.component.ts` (liste + filtre KYC + bandeau d'alertes pièces expirées + création) et `pages/client-detail/client-detail.component.ts` (fiche 360°, gestion des pièces KYC avec upload de fichier, dossiers liés, registre des originaux confiés avec restitution). Routes ajoutées dans `app.routes.ts` (`/clients`, `/clients/:id`) et entrée de menu dans `app.component.ts` (icône dédiée, alignée sur le système d'icônes SVG déjà en place).
- `api.service.ts` étendu : `client`, `creerClient`, `majClient`, `kycAlertes`, `ajouterPieceKyc`, `telechargerPieceKyc`, `supprimerPieceKyc`, `originaux`, `creerOriginal`, `restituerOriginal`, `listesValeurs`.
- Vérifications : build Angular sans erreur ; back-end testé en local via Docker de bout en bout (création client, ajout/suppression de pièce KYC, alertes d'expiration, listes de valeurs, création/restitution d'original, mise à jour du statut KYC) — tous les appels répondent correctement.
- Non fait : redéploiement sur GCP (à faire séparément si besoin), pas de gestion des liens client-à-client (`client_liens`) côté UI (lecture seule via la fiche, pas de création), pas de suppression de client.

## 2026-08-16 — Modules Rôle d'audience et Registre du courrier

- Correction de données : la table `motifs_renvoi` (référencée par `audiences.motif_renvoi_id`) était vide alors que la liste équivalente existe déjà dans `listes_valeurs` (domaine `motif_renvoi`). Seed ajouté directement dans `schema.sql` (les 11 mêmes libellés, `ON CONFLICT DO NOTHING`) pour que les déploiements futurs l'incluent automatiquement.
- Bug préexistant corrigé dans `dossiers.js` (hors périmètre initial mais bloquant pour les tests) : `COALESCE($9,'moyenne')` sur la colonne enum `urgence` levait une erreur de typage PostgreSQL. Corrigé en `COALESCE($9::urgence_niveau,'moyenne')`.
- **Backend — Rôle d'audience** (`APP/backend/src/routes/audiences.js`, monté sur `/api/roles-audience`) :
  - `GET /` (rôle de la semaine, par défaut courante, avec ses lignes jointes dossier/avocat/résultat)
  - `POST /lignes` (ajoute une audience au rôle de la semaine correspondante — crée le rôle s'il n'existe pas — avec heure, instructions, urgence)
  - `POST /:id/valider`, `POST /:id/diffuser` (réservés associé/admin)
  - `GET /motifs-renvoi`
  - `POST /audiences/:id/retour` (saisie du résultat ; si `prochaine_date` fournie, **inscrit automatiquement** l'audience suivante au rôle de la semaine N+1 — logique explicitement prévue par le schéma, transaction SQL pour garantir la cohérence rôle/ligne/audience).
- **Backend — Registre du courrier** (`APP/backend/src/routes/courriers.js`, monté sur `/api/courriers`) :
  - Génération automatique de la référence (`ARR-2026-000123` / `DEP-2026-000045`)
  - `POST /` avec **déclenchement automatique** basé sur la table `declencheurs` (type de courrier → événement daté si délai connu, sinon tâche de suivi ; ou diligence si le déclencheur est de type "diligence") — testé avec `acte_huissier` → délai de 15 jours créé automatiquement
  - `GET /`, `GET /:id`, `PUT /:id/statut` (recu/impute/en_traitement/traite/expedie)
- Plusieurs allers-retours de correction du même type de bug de typage enum (`support_courrier`, `statut_courrier`) rencontrés en écrivant ces deux routes — cause identifiée et documentée dans `CLAUDE.md` pour éviter de la reproduire sur les prochains modules (paramètre PostgreSQL réutilisé dans un contexte non typé + littéral texte).
- **Frontend** : nouvelles pages `pages/role-audience/role-audience.component.ts` (navigation semaine par semaine, ajout d'audience avec recherche de dossier, validation/diffusion du rôle, saisie du retour d'audience) et `pages/courrier/courrier.component.ts` (formulaire de création avec feedback du déclenchement automatique, liste filtrable, changement de statut inline). Routes (`/role-audience`, `/courrier`) et entrées de menu (icônes dédiées) ajoutées.
- `api.service.ts` étendu : `roleAudience`, `ajouterLigneRole`, `validerRole`, `diffuserRole`, `motifsRenvoi`, `retourAudience`, `courriers`, `courrier`, `creerCourrier`, `majStatutCourrier`.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout pour les deux modules (cycle complet rôle d'audience incluant le renvoi automatique à la semaine suivante ; création de courrier avec et sans déclenchement, changement de statut).
- Non fait : redéploiement GCP (prévu juste après cette entrée), pas d'écran dédié pour visualiser le planning des diligences (table `diligences` alimentée par les déclencheurs mais pas encore d'UI de consultation — à prévoir avec le module Plan d'action), pas de gestion du chaînage `audience_prec_id`/`nature_procedure` côté UI (champs présents en base, non exposés).

## 2026-08-16 — Module Atelier d'actes

- Constat : le schéma SQL ne prévoit pas de table « modèles/bibliothèque ». Choix fait de construire ce module sur la table `documents` (GED) existante plutôt que d'ajouter une table sans validation utilisateur préalable — les modèles d'actes sont codés en dur côté serveur (`backend/src/routes/actes.js`, objet `MODELES`), avec fusion des champs dossier/client/cabinet (`parametres_cabinet` pour l'en-tête).
- **Backend** (`APP/backend/src/routes/actes.js`, monté sur `/api/actes`) :
  - `GET /modeles` — 4 modèles fournis : mise en demeure (recouvrement), lettre de mission, demande de provision, trame de conclusions
  - `POST /generer` — deux modes : `modele` (fusion du modèle choisi avec les données du dossier/client + en-tête cabinet) ou `ia` (brouillon via le service `src/ia.js` déjà existant, avec la mention obligatoire « Projet à valider par l'avocat »). Dans les deux cas, le résultat est enregistré comme document GED (`documents`, statut `brouillon`, catégorie adaptée) via `storage.js`, texte indexé dans `ocr_texte` pour la recherche/l'Assistant IA.
- **Frontend** : nouvelle page `pages/actes/actes.component.ts` — recherche de dossier, bascule Modèle / Assistant IA, aperçu du texte généré avec lien vers la fiche dossier. Route `/actes` et entrée de menu ajoutées.
- `api.service.ts` étendu : `modelesActes`, `genererActe`.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker (liste des modèles, génération d'une mise en demeure avec fusion des données réelles du dossier/cabinet, génération en mode IA avec repli hors-ligne car `IA_API_KEY` non configuré en local — aperçu simulé conforme à `src/ia.js`).
- Non fait : redéploiement GCP (à suivre), pas de mécanisme d'édition du texte généré avant enregistrement (le document est créé directement en brouillon, à corriger ensuite via la GED existante), pas de gestion des « visas à jour » au sens dynamique (les visas sont un texte fixe par modèle, pas une veille juridique automatisée — cohérent avec le module Bibliothèque qui reste à construire).

## 2026-08-16 — Module Bibliothèque

- **Nouvelle table** `ressources_biblio` (+ enum `type_ressource_biblio`) ajoutée à `schema.sql` juste avant `COMMIT;` : le schéma n'avait aucune table pour ce module (contrairement aux autres, entièrement couverts). Colonnes : type, titre, référence, source (OHADA/National/Interne), matière, date de publication, résumé, fichier associé optionnel (GED), index de recherche plein texte (`gin_trgm_ops`, même pattern que `clients`/`dossier_parties`). Migration appliquée à la fois en local (rebuild du volume Docker) et en production (import SQL via GCS, même procédure que pour `motifs_renvoi`).
- **Backend** (`APP/backend/src/routes/biblio.js`, monté sur `/api/biblio`) : `GET /` (filtres type/matière/recherche), `GET /:id`, `POST /` (multipart, fichier optionnel via `storage.js`), `GET /:id/fichier` (téléchargement), `DELETE /:id`.
- **Frontend** : nouvelle page `pages/biblio/biblio.component.ts` (filtre par type, recherche, création avec upload de fichier optionnel, téléchargement). Point d'attention corrigé avant commit : le téléchargement ne peut pas passer par un `<a href>` classique (la route `/api/biblio/:id/fichier` exige un jeton JWT via l'intercepteur Angular) — repris sur le pattern blob authentifié déjà utilisé dans `dossier-detail.component.ts` (`telechargerFichierBiblio` + `URL.createObjectURL`).
- `api.service.ts` étendu : `biblio`, `creerRessourceBiblio`, `supprimerRessourceBiblio`, `telechargerFichierBiblio`.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker (création jurisprudence + checklist, liste, filtre par type) — fonctionne du premier coup (aucun bug de typage enum cette fois, cast explicite `$1::type_ressource_biblio` appliqué dès l'écriture).
- Non fait : redéploiement GCP (à suivre), pas de lien entre une ressource « Modèle » de la bibliothèque et le moteur de génération de l'Atelier d'actes (deux systèmes distincts pour l'instant, unification possible plus tard), pas d'aperçu du fichier associé dans l'interface (téléchargement seul).

## 2026-08-16 — Module Plan d'action

- Deux bugs préexistants corrigés dans `taches.js` (route déjà fournie par le kit, jamais testée jusqu'ici) : (1) même famille de bug de typage enum que documenté dans CLAUDE.md, mais sur `type`/`priorite`, corrigé par cast explicite ; (2) un placeholder `$8` référencé dans le tableau de paramètres mais jamais utilisé dans le texte SQL, faisant échouer la préparation de la requête (`could not determine data type of parameter $8`) — nettoyé en supprimant le paramètre inutile et en renumérotant.
- Nouvelle route `GET /api/utilisateurs` (`backend/src/routes/utilisateurs.js`) : annuaire interne simple (id, code, prénom, nom, rôle, pôle, actif), nécessaire pour les sélecteurs de responsable — absente du kit, à réutiliser pour les prochains modules (RH, permissions) plutôt que d'en recréer une.
- **Frontend** : nouvelle page `pages/plan-action/plan-action.component.ts` — tableau kanban à 4 colonnes (à faire/en cours/à valider/terminé) sur la table `taches` existante, déplacement des tâches par boutons ← / → (pas de drag-and-drop, pour rester sans dépendance supplémentaire), bouton « Valider » dédié pour la colonne « à valider » (appelle `POST /api/taches/:id/valider`, réservé associé/admin côté serveur). Formulaire de création avec recherche de dossier et sélection du responsable (annuaire).
- `api.service.ts` étendu : `validerTache`, `utilisateurs`.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker (création de tâche avec et sans champs optionnels, changement de statut, annuaire des utilisateurs).
- Non fait : redéploiement GCP (à suivre), pas de drag-and-drop (déplacement par boutons uniquement), les autres routes du kit non encore auditées (`temps.js`, `factures.js`, `evenements.js`, `communications.js`, `documents.js`, `dashboard.js`) peuvent contenir le même type de bug — à vérifier au moment de les utiliser.

## 2026-08-16 — Module Dépenses & caisse

- Aucune route fournie par le kit pour ce module (contrairement à Plan d'action) — entièrement écrit à partir du schéma existant (`depenses`, `comptes_bancaires`, `dotations_petite_caisse`, `vignettes_plaidoirie`, vue `v_stock_vignettes`), déjà complet côté SQL (circuit de validation `soumise → validee/rejetee → decaissee` prévu par le schéma).
- **Backend** (`APP/backend/src/routes/depenses.js`, monté sur `/api/depenses`) :
  - `GET /` (filtres type/statut/dossier/petite_caisse), `POST /` (soumission)
  - `POST /:id/decision` (validée/rejetée, réservé associé/admin — le « gérant »), `POST /:id/decaisser` (réservé comptable/associé/admin)
  - `GET /comptes` (comptes du cabinet), `GET/POST /petite-caisse` (dotation mensuelle + calcul du solde), `GET /vignettes/stock` + `POST /vignettes` (achat/utilisation)
  - Leçon appliquée dès l'écriture (cf. note CLAUDE.md sur les enums) : tous les paramètres enum castés explicitement (`::type_depense`, `::categorie_depense`, `::statut_depense`) — testé sans aucun aller-retour de correction, contrairement aux modules précédents.
- **Frontend** : nouvelle page `pages/depenses/depenses.component.ts` — 4 indicateurs (dotation/dépensé/solde du mois, stock de vignettes), formulaire de soumission complet, liste filtrable avec actions contextuelles selon le statut (valider/rejeter/décaisser), petit formulaire de dotation de caisse et de mouvement de vignettes.
- `api.service.ts` étendu : `depenses`, `creerDepense`, `decisionDepense`, `decaisserDepense`, `comptesBancaires`, `petiteCaisse`, `definirDotationCaisse`, `stockVignettes`, `mouvementVignettes`.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout (dépense fixe et ponctuelle, cycle complet soumise→validée→décaissée, dotation de caisse et calcul du solde, achat de vignettes et stock).
- Non fait : redéploiement GCP (à suivre), pas de lien entre les débours refacturables (`refacturable_client`) et la facturation (vue SQL `v_debours_a_refacturer` déjà prête côté schéma mais pas encore exploitée côté UI — à faire quand le module Facturation sera repris en profondeur).

## 2026-08-16 — Module Rétrocessions

- **Nouvelle table** `retrocessions` (+ enums `qualite_retro`, `statut_retro`) ajoutée à `schema.sql` avant `COMMIT;` : comme pour Bibliothèque, le schéma n'avait aucune table pour ce module.
- **Backend** (`APP/backend/src/routes/retrocessions.js`, monté sur `/api/retrocessions`) :
  - `GET /qualites` — taux par défaut codés en dur (associé 30 %, collaborateur avocat/stagiaire/Of Counsel 25 %, collaborateur non-avocat 10 %), conformes à la spec
  - `GET /` (liste avec calcul en direct de `honoraires_encaisses` par jointure sur `paiements`), `POST /` (calcul automatique du montant = base_ht × taux/100, taux surchageable)
  - `POST /:id/decaisser` (associé/admin/comptable) — **règle « tout ou rien » appliquée strictement** : rejette le décaissement si une facture est liée et que la somme des paiements enregistrés est inférieure au montant TTC de la facture ; accepte si aucune facture n'est liée (rétrocession manuelle) ou si l'encaissement est intégral
  - `GET /pro-bono?mois=` — quota Pro Bono (2 dossiers/mois/associé, non reportable), calculé sur `dossiers.pro_bono` + `date_ouverture`
- **Frontend** : nouvelle page `pages/retrocessions/retrocessions.component.ts` — tableau de suivi du quota Pro Bono par associé, formulaire de création avec qualité auto-suggérée selon le rôle du bénéficiaire choisi, liste avec bouton "Décaisser" désactivé tant que la facture liée n'est pas intégralement encaissée (retour visuel immédiat, en plus du contrôle serveur).
- `api.service.ts` étendu : `qualitesRetro`, `retrocessions`, `creerRetrocession`, `decaisserRetrocession`, `proBono`.
- Vérifications : build Angular sans erreur (après nettoyage d'un import `DatePipe` inutilisé signalé par le compilateur) ; backend testé en local via Docker de bout en bout, **y compris le scénario complet de la règle tout ou rien** : décaissement refusé sans paiement, refusé avec paiement partiel (500 000 / 1 180 000 FCFA), accepté après paiement intégral du solde.
- Redéployé et migré sur Cloud SQL (table `retrocessions` créée en prod) juste après cette entrée.
- Non fait : pas d'automatisation de création des rétrocessions à l'émission d'une facture (création manuelle uniquement pour l'instant).

## 2026-08-16 — Module Accès & permissions

- Nouveau helper `backend/src/audit.js` (`logAudit`) — écrit dans la table `journal_audit` (déjà présente dans le schéma mais **jamais utilisée par aucune route existante avant ce module**, vérifié par recherche exhaustive). Best-effort : une erreur d'écriture du journal n'interrompt jamais l'action métier.
- Journalisation branchée : connexion (`auth.js`, action `login`, avec mise à jour de `derniere_connexion`), et toutes les actions du module Accès (changement de rôle, activation/désactivation de compte, octroi/révocation de délégation). **Le reste de l'application (dossiers, factures, dépenses, etc.) n'écrit toujours pas dans le journal d'audit** — un retrofit complet serait un chantier à part, hors scope ici ; noté dans CLAUDE.md.
- **Backend** (`APP/backend/src/routes/acces.js`, monté sur `/api/acces`) — **toutes les routes réservées associé/admin** via `router.use(requireRole(...))` en tête de fichier :
  - `PUT /utilisateurs/:id/role`, `PUT /utilisateurs/:id/actif` (évolution/désactivation d'accès)
  - `GET/POST /delegations`, `POST /delegations/:id/revoquer` (accès temporaires/permanents, table `delegations_acces` déjà prévue par le schéma)
  - `GET /audit?utilisateur_id=&entite=&limit=` (consultation du journal)
- **Frontend** : nouvelle page `pages/acces/acces.component.ts` — liste des membres avec changement de rôle et bascule actif/inactif en ligne, gestion des délégations, table du journal d'audit. Correction au passage : `api.service.ts` `utilisateurs()` ne pouvait renvoyer que les comptes actifs ou inactifs séparément (jamais les deux) — paramètre rendu optionnel (`undefined` = tous les comptes) sans casser les appels existants (Plan d'action, Rétrocessions gardent le comportement par défaut « actifs seulement »).
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout — changement de rôle, création/révocation de délégation, journal d'audit peuplé automatiquement par ces actions, **et contrôle d'accès vérifié** : un utilisateur non associé/admin reçoit bien 403 sur `/api/acces/*`.
- Non fait : redéploiement GCP + migration (aucune nouvelle table cette fois, `journal_audit` et `delegations_acces` existaient déjà — seul le code applicatif change, pas de migration SQL nécessaire), pas d'écran dédié pour créer un nouvel utilisateur (compte créé uniquement en base pour l'instant — à intégrer au module Cabinet RH).
