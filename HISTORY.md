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
- Non fait : pas d'écran dédié pour créer un nouvel utilisateur (compte créé uniquement en base pour l'instant — à intégrer au module Cabinet RH).
- Redéployé (aucune migration nécessaire, `journal_audit`/`delegations_acces` existaient déjà) juste après cette entrée.

## 2026-08-16 — Module Cabinet (RH)

- **Nouvelle table** `conges` (+ enums `type_conge`, `statut_conge`) : le schéma avait déjà `presences` (pointage), `bulletins_paie` (paie légère) et la vue `v_echeances_rh` (fin d'essai/contrat/visite médicale), mais aucune table de gestion des congés.
- Même bug de typage déjà documenté rencontré une fois de plus (`COALESCE($1,$5)` sur `utilisateur_id` UUID dans la création de congé) — corrigé immédiatement par cast explicite, conforme au réflexe désormais pris.
- **Backend** (`APP/backend/src/routes/cabinet.js`, monté sur `/api/cabinet`) :
  - `GET /equipe` — membres actifs, heures du mois (vue `v_heures_mensuelles` déjà prête), dossiers actifs par membre
  - `GET /echeances` — échéances RH à venir (vue `v_echeances_rh`)
  - `GET/POST /conges`, `POST /conges/:id/decision` (associé/admin)
  - `GET/POST /presences` (pointage, upsert sur `(utilisateur_id, date_jour)`)
  - `GET/POST /bulletins` (archivage indicatif, associé/admin/comptable, upsert sur `(utilisateur_id, mois)`)
- **Frontend** : nouvelle page `pages/cabinet/cabinet.component.ts` — bandeau d'alertes échéances RH, tableau de l'équipe (charge/heures), pointage personnel avec récapitulatif mensuel, gestion des congés (demande + décision), archivage de bulletins de paie.
- `api.service.ts` étendu : `equipeCabinet`, `echeancesRh`, `conges`, `demanderConge`, `decisionConge`, `presencesMois`, `pointer`, `bulletinsPaie`, `creerBulletinPaie`.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout (équipe, pointage avec calcul des heures mensuelles, cycle complet de demande/approbation de congé, bulletin de paie archivé).
- Non fait : pas de calcul officiel de paie (déclarations INPS/AMO/ITS explicitement hors périmètre par le schéma lui-même — JURIA archive, le comptable calcule et déclare), pas d'export des bulletins.
- Redéployé et migré sur Cloud SQL (table `conges`) juste après cette entrée.

## 2026-08-16 — Modules Assistant IA (écran dédié) et Portail client — 17e et dernier module de la spécification

- **Assistant IA** : `backend/src/routes/ia.js` réécrit — factorisation de la résolution du texte source (`texte` / `document_id` / `dossier_id`) dans un helper `texteSource()`, et ajout de 4 capacités à `resume`/`chronologie` déjà existants : `POST /extraction-faits`, `POST /analyse-contrat`, `POST /traduction` (avec `langue_cible`), `POST /comparaison` (deux textes/documents). Toutes suivent le même garde-fou (`generer()` dans `src/ia.js`, mention obligatoire « Projet à valider par l'avocat », repli hors-ligne si `IA_API_KEY` absente).
- Nouvelle page `pages/assistant-ia/assistant-ia.component.ts` : sélecteur des 6 capacités (cartes cliquables), formulaire adapté par capacité (texte simple, ou deux textes pour la comparaison, ou langue cible pour la traduction), résultat affiché avec rappel du garde-fou. Route `/assistant-ia` et entrée de menu ajoutées. `api.service.ts` étendu (`iaExtractionFaits`, `iaAnalyseContrat`, `iaTraduction`, `iaComparaison`).
- **Portail client** — décision explicite de scope : le schéma SQL lui-même liste ce module comme extension **post-MVP** (commentaire de fin de `schema.sql`, « portail client » cité aux côtés de « signatures électroniques »), et aucune table de messagerie ou de compte client séparé n'existe. Construire un vrai portail nécessiterait un système d'authentification entièrement distinct (comptes clients, isolation de session, durcissement sécurité) — un chantier à part entière, pas une simple page de plus.
- Décision : livrer un écran d'**aperçu côté cabinet** (`pages/portail-client/portail-client.component.ts`) plutôt qu'un vrai extranet — recherche d'un dossier, puis affichage dans un cadre visuellement démarqué (« Aperçu extranet ») de ce qu'un client verrait : documents GED du dossier, factures liées, et une section messagerie clairement annotée comme non implémentée (avec l'explication de ce qu'il manque). C'est fidèle à la démo HTML d'origine, qui présentait déjà cet écran comme un aperçu (« phase 2-4 »).
- Petite extension utile au passage : `GET /api/factures` ne filtrait pas par `dossier_id`/`client_id` — ajouté (avec cast enum explicite sur `statut`, réflexe désormais systématique) pour permettre l'aperçu du portail ; réutilisable par d'autres écrans à l'avenir.
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout — les 4 nouvelles capacités IA (repli hors-ligne cohérent), et le filtre factures par dossier pour l'aperçu portail.
- Non fait : vrai portail client avec authentification séparée (décision de scope explicite ci-dessus, à reprendre comme projet dédié si besoin), messagerie cabinet↔client (aucune table prévue).

## 2026-08-16 — Bilan de fin de session : les 17 modules de la spécification sont couverts

Récapitulatif complet des modules livrés durant cette session (en plus du socle déjà fourni par le kit — Cockpit, Dossiers, Ouverture, Échéancier, Facturation) :
Clients & KYC, Rôle d'audience, Registre du courrier, Atelier d'actes, Bibliothèque, Plan d'action, Dépenses & caisse, Rétrocessions, Accès & permissions, Cabinet (RH), Assistant IA, Portail client (aperçu).

Nouvelles tables ajoutées au schéma durant la session (le kit ne les prévoyait pas) : `ressources_biblio`, `retrocessions`, `conges`. Nouvelles routes transverses réutilisables : `GET /api/utilisateurs` (annuaire), `POST /api/originaux`, `GET /api/listes-valeurs`, `backend/src/audit.js` (journal d'audit).

Limitations connues et documentées (voir `CLAUDE.md`, section État actuel) : journal d'audit partiellement alimenté, portail client en mode aperçu seulement, plusieurs routes du kit jamais testées de bout en bout (`temps.js`, `evenements.js`, `communications.js`, `documents.js`, `dashboard.js`), pas de CI/CD automatisé, CORS ouvert à tous les domaines, pas d'environnements recette/production séparés, pas de domaine personnalisé mappé sur Cloud Run.

## 2026-08-17 — Création de compte + validation à l'entrée

- Suite à une question de l'utilisateur sur le fonctionnement réel de la création des identifiants et de la validation des accès : constat qu'aucune des deux briques n'existait (comptes créés uniquement à la main en base pendant les tests, aucune notion de compte « en attente »). Développement des deux à sa demande.
- **Schéma** : ajout de `utilisateurs.valide_par` (UUID, FK) et `utilisateurs.valide_le` (TIMESTAMPTZ), nullable, migration additive simple. Permet de distinguer trois états à partir des deux colonnes `actif`/`valide_le` sans table supplémentaire : `actif=TRUE` → actif ; `actif=FALSE` + `valide_le NULL` → en attente de validation (jamais activé) ; `actif=FALSE` + `valide_le` renseigné → suspendu (a déjà été actif un jour).
- **Backend** (`acces.js`, toujours réservé associé/admin) :
  - `POST /utilisateurs` — crée le compte avec `actif=FALSE`, génère un mot de passe temporaire aléatoire (12 caractères, alphabet sans caractères ambigus, `crypto.randomBytes`), le hache (bcrypt) avant stockage, et le renvoie **en clair une seule fois** dans la réponse HTTP — jamais journalisé (le détail d'audit ne contient que le rôle, pas le mot de passe), jamais récupérable ensuite.
  - `POST /utilisateurs/:id/valider` — première activation : ne fonctionne que si `valide_le IS NULL` (refuse une deuxième validation avec 404), distincte de `PUT /utilisateurs/:id/actif` qui reste le mécanisme de suspension/réactivation d'un compte déjà validé.
  - `routes/utilisateurs.js` (annuaire) étendu pour exposer `email` et `valide_le`, nécessaires à l'écran.
- **Frontend** (`acces.component.ts`) : bouton « + Nouveau compte » avec formulaire (code, prénom, nom, email, rôle initial) ; après création, bandeau non permanent affichant le mot de passe temporaire avec rappel qu'il ne sera plus jamais montré ; tableau des membres avec badge à 3 états (Actif/En attente de validation/Suspendu) et action contextuelle (« Valider » pour un compte en attente, « Désactiver »/« Réactiver » sinon).
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout — création puis tentative de connexion **refusée** avant validation, validation, connexion **acceptée** après ; tentative de double validation refusée (404) ; cycle suspension/réactivation d'un compte déjà validé sans toucher `valide_le` ; journal d'audit contient bien `creer_compte` et `valider_compte` sans fuite du mot de passe.
- Non fait : pas d'écran de réinitialisation de mot de passe (ni pour l'utilisateur ni pour l'admin après coup — si le mot de passe temporaire est perdu, il faudrait aujourd'hui un accès direct à la base), pas d'envoi automatique par e-mail du mot de passe temporaire (aucune infrastructure d'envoi de mails dans l'application — communication manuelle par l'admin).

## 2026-08-17 — Changement de mot de passe en libre-service

- Suite du gap identifié la veille (« pas d'écran de réinitialisation de mot de passe ») : ajout de la brique manquante côté utilisateur — se connecter puis changer soi-même son mot de passe.
- **Backend** : nouvelle route `backend/src/routes/profil.js` (montée sur `/api/profil`, **sans** `requireRole` — accessible à tout utilisateur authentifié, contrairement à `/api/acces` réservé associé/admin). `GET /` (ses propres infos), `PUT /mot-de-passe` (exige l'ancien mot de passe via `bcrypt.compare`, ≥8 caractères, différent de l'ancien ; journalise `changer_mot_de_passe` sans jamais écrire le mot de passe en clair dans l'audit).
- **Frontend** : nouvelle page `pages/mon-compte/mon-compte.component.ts` (informations du profil + formulaire ancien/nouveau/confirmation), route `/mon-compte` et entrée de menu accessibles à tous (pas de restriction de rôle côté route Angular, cohérent avec le backend). `api.service.ts` étendu (`monProfil`, `changerMotDePasse`).
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout — ancien mot de passe incorrect refusé, nouveau trop court refusé, changement réussi, connexion avec l'ancien mot de passe refusée après coup, connexion avec le nouveau acceptée.
- **Gap identifié et documenté (non comblé)** : toujours aucun flux « mot de passe oublié ». Ce module suppose que l'utilisateur connaît son mot de passe actuel — s'il l'a perdu (notamment avant sa toute première connexion, mot de passe temporaire égaré), il n'existe aujourd'hui **aucun moyen de le récupérer**, y compris pour un admin (`/api/acces` n'offre pas de réinitialisation forcée du mot de passe d'un tiers). À construire si besoin : soit une route admin « réinitialiser + nouveau mot de passe temporaire », soit un vrai flux email (nécessiterait une infra d'envoi de mails, absente de l'application).

## 2026-08-17 — Réinitialisation de mot de passe par un admin (comble le gap ci-dessus)

- Choix confirmé par l'utilisateur : option admin (réinitialisation forcée + nouveau mot de passe temporaire), pas de flux email — cohérent avec l'absence d'infrastructure mail dans l'application.
- **Backend** (`acces.js`) : nouvelle route `POST /utilisateurs/:id/reinitialiser-mot-de-passe` (réservée associé/admin comme tout le module). Réutilise le générateur de mot de passe temporaire déjà écrit pour la création de compte. **Différence volontaire avec la création** : ne touche ni `actif` ni `valide_le` — un compte déjà validé et actif le reste après réinitialisation (seul le mot de passe change), pas de nouvelle étape de validation à refaire. Action journalisée (`reinitialiser_mot_de_passe`) sans fuite du mot de passe.
- **Frontend** (`acces.component.ts`) : bouton « Réinit. mot de passe » ajouté sur chaque ligne du tableau des membres (en plus de Valider/Désactiver-Réactiver selon le statut). Réutilisation du bandeau d'affichage unique du mot de passe déjà construit pour la création de compte, généralisé avec un indicateur `creation: boolean` pour adapter le texte d'accompagnement (mention de la validation à faire uniquement dans le cas création, pas dans le cas réinitialisation).
- Vérifications : build Angular sans erreur ; backend testé en local via Docker de bout en bout — réinitialisation d'un compte déjà actif, ancien mot de passe immédiatement invalidé, nouveau mot de passe temporaire fonctionnel, statut du compte (`actif`, `valide_le`) inchangé, action bien journalisée.
- Gap restant, assumé : pas de self-service « mot de passe oublié » pour l'utilisateur final depuis l'écran de connexion — il doit passer par un associé/admin. Jugé suffisant pour la taille du cabinet ; à revoir si une vraie infra email est ajoutée un jour.

## 2026-08-17 — Audit : routes, sécurité, infrastructure GCP, CI/CD

Demandé par l'utilisateur suite aux échanges sur la gestion des accès. Rapport complet publié en artefact (lecture de code + vérifications `gcloud` en direct sur `jfc-juria`) ; résumé consigné ici pour la mémoire du projet.

**Routes backend jamais testées, maintenant auditées :**
- `temps.js`, `evenements.js`, `dashboard.js` — testés de bout en bout (saisie de temps avec taux par défaut, création d'événement, agrégats Cockpit y compris la vue `v_delais_a_venir`) : corrects, aucune anomalie.
- `documents.js` — **bug confirmé et corrigé** : même défaut que 6 fois déjà cette session (`COALESCE($3,'autre')`/`COALESCE($5,'dossier')` sur les colonnes enum `categorie`/`confidentialite`, sans cast). Tout téléversement sans catégorie explicite échouait. Corrigé (`::categorie_document`, `::confidentialite`), testé en local avec et sans catégorie fournie, téléchargement vérifié. **Reste à déployer** (fait juste après cette entrée).
- `communications.js` — pas de bug bloquant, mais `type` (NOT NULL en base) n'est pas validé côté route avant insertion : erreur PostgreSQL brute renvoyée au client si absent. Non corrigé (mineur), à faire à l'occasion.
- Il ne reste plus que `factures.js` comme route jamais auditée cette session.

**Sécurité applicative (lecture de `server.js`, `auth.js`, les 3 points de téléversement) :**
- CORS entièrement ouvert (`app.use(cors())` sans restriction) — moyen, à restreindre à l'origine du frontend.
- Aucune limitation de débit sur `/auth/login` — moyen, risque de bourrage d'identifiants.
- Téléversements (`documents.js`, `clients.js` pièces KYC, `biblio.js`) sans liste blanche de type de fichier — moyen, atténué par `Content-Disposition: attachment` systématique sur les téléchargements.
- Pas d'en-têtes de sécurité (`helmet`) — faible.
- `jwt.verify()` sans `algorithms: ['HS256']` explicite — faible, défensif.
- Un compte désactivé garde ses jetons valides jusqu'à expiration naturelle (8h) — compromis JWT classique, à trancher (raccourcir la durée de vie ou vérifier `actif` à chaque requête) plutôt qu'un bug.

**Infrastructure GCP (vérifié en direct via `gcloud` sur le projet `jfc-juria`) :**
- **Finding le plus important de l'audit** : les deux services Cloud Run (`juria`, `juria-web`) tournent avec le compte de service Compute par défaut, qui porte `roles/editor` sur tout le projet — bien au-delà du besoin réel (Cloud SQL client + un bucket + deux secrets). Une compromission applicative hériterait d'un pouvoir de modification quasi total sur le projet GCP. Recommandation : compte de service dédié à privilèges minimaux. **Non corrigé — décision et arbitrage du timing laissés à l'utilisateur** (changer le compte de service d'un service en production n'est pas anodin, à faire consciemment).
- Sauvegardes automatiques désactivées sur l'instance Cloud SQL (`juria-pg`) — moyen, risque de perte de données pure.
- IP publique activée sur Cloud SQL alors que Cloud Run n'en a pas besoin (connecteur natif), et `requireSsl: false` — faible.
- Vérifié conforme : bucket GCS `jfc-juria-ged` correctement privé (accès uniforme, aucune liaison IAM publique). Invocation `allUsers` sur les deux services Cloud Run confirmée intentionnelle (sécurité déléguée à la couche JWT applicative, pas à l'IAM Cloud Run).

**CI/CD et exploitation :**
- Aucun pipeline CI/CD — tous les déploiements de cette session ont été déclenchés manuellement (`gcloud builds submit` + `gcloud run deploy`), aucun déclencheur lié à `git push`.
- Aucun test automatisé (backend ou frontend).
- Un seul environnement (pas de séparation recette/production).
- Rappels déjà connus : domaine encore provisoire (`*.run.app`), journal d'audit partiellement alimenté.

**Priorités recommandées communiquées à l'utilisateur** (dans le rapport) : 1) compte de service dédié à privilèges minimaux, 2) sauvegardes Cloud SQL, 3) rate-limiting + CORS restreint, 4) déployer le correctif `documents.js`, 5) le reste (helmet, filtrage de fichiers, IP publique Cloud SQL, CI/CD, tests) au rythme du projet.

Rien n'a été corrigé pendant cet audit à l'exception du bug `documents.js` (même classe de correctif que 6 fois déjà appliquées sans risque cette session) — tout le reste attend un arbitrage explicite de l'utilisateur avant action, notamment le compte de service (changement en production, pas anodin) et les coûts (sauvegardes Cloud SQL, rate-limiting).

## 2026-08-17 — Application des priorités 1 à 3 de l'audit (validées par l'utilisateur : « procéder tel que recommandé »)

**1) Comptes de service dédiés à privilèges minimaux (le finding le plus important)**
- Créés : `juria-api-sa@jfc-juria.iam.gserviceaccount.com` et `juria-web-sa@jfc-juria.iam.gserviceaccount.com`.
- Droits accordés à `juria-api-sa` — strictement le nécessaire : `roles/cloudsql.client` (niveau projet — ce rôle n'a pas de portée plus fine), `roles/storage.objectAdmin` **limité au bucket `jfc-juria-ged`** (liaison IAM posée directement sur le bucket, pas au niveau projet), `roles/secretmanager.secretAccessor` **limité aux deux secrets utilisés** (`juria-db-password`, `juria-jwt-secret`, liaisons posées directement sur chaque secret). Vérifié après coup : `gcloud projects get-iam-policy` filtré sur ce compte ne renvoie que `roles/cloudsql.client` au niveau projet — confirmation qu'aucun droit large ne traîne.
- `juria-web-sa` : aucun rôle GCP accordé (le frontend statique n'appelle aucune API Google).
- Les deux services Cloud Run basculés via `gcloud run services update --service-account=...` (nouvelle révision à chaque fois, sans changement d'image).
- **Décision volontaire** : le compte Compute par défaut (`…-compute@developer.gserviceaccount.com`) garde son rôle `roles/editor` au niveau projet — retirer ce rôle est un changement plus large (impact potentiel sur d'autres usages du compte par défaut, pas auditrés) et a été jugé hors scope de cette itération. Ce qui compte est fait : **plus aucun service en production ne s'exécute avec ce compte**.
- Vérifications post-bascule : `/health` OK, connexion OK (donc accès au secret JWT), `GET /api/dossiers` OK (donc `cloudsql.client` fonctionnel), upload GED OK (donc `storage.objectAdmin` scopé au bucket fonctionnel). Aucune régression.

**2) Sauvegardes Cloud SQL**
- `gcloud sql instances patch juria-pg --backup-start-time=03:00 --enable-point-in-time-recovery --retained-backups-count=7` — a pris plus de 3 minutes (opération basculée en arrière-plan par l'outillage), terminée avec succès.
- Vérifié : `backupConfiguration.enabled: true`, `pointInTimeRecoveryEnabled: true`, 7 sauvegardes conservées, fenêtre 03h00.

**3) CORS restreint + limitation de débit sur la connexion**
- `server.js` : `cors()` sans restriction remplacé par `cors({ origin: ORIGINES_AUTORISEES })`, la liste venant de la variable d'environnement `ALLOWED_ORIGINS` (virgules) avec un repli par défaut sur l'URL du frontend Cloud Run + `http://localhost:4200` — conçu pour pouvoir ajouter le futur domaine personnalisé sans redéploiement de code (juste la variable d'env).
- `auth.js` : `express-rate-limit` ajouté sur `POST /login` uniquement — 10 tentatives / 15 min / IP, réponse 429 passé ce seuil. Dépendance `express-rate-limit` ajoutée à `package.json`.
- **Point technique important repéré et corrigé en marge** : Cloud Run place l'application derrière le proxy front-end de Google. Sans `app.set("trust proxy", 1)`, `req.ip` aurait renvoyé l'IP du proxy pour toutes les requêtes — la limite de débit se serait donc appliquée globalement à tous les utilisateurs confondus au lieu d'être par IP réelle. Ce réglage profite aussi au journal d'audit, qui capture déjà `req.ip` dans `logAudit` (jusqu'ici sans grande conséquence puisqu'aucune limite n'en dépendait).
- Vérifications en local via Docker : requête OPTIONS depuis `localhost:4200` → en-tête `Access-Control-Allow-Origin` correctement reflété ; même requête depuis une origine arbitraire → en-tête absent (bloqué côté navigateur) ; 12 tentatives de connexion rapprochées → les 10 premières passent (401, mauvais mot de passe), la 11e et la 12e renvoient 429 ; connexion légitime toujours fonctionnelle après redémarrage du conteneur (compteur réinitialisé) ; IP capturée dans `journal_audit` cohérente avec le contexte local (passerelle Docker, comportement attendu — en production le proxy Cloud Run fournira la vraie IP cliente).

**Déploiement** : image API reconstruite et redéployée (`juria-00018-...`), pas de changement frontend nécessaire pour ces trois points.

**Non fait (priorités 4-5, laissées au rythme du projet, cf. rapport d'audit)** : helmet, filtrage de type sur les téléversements, désactivation de l'IP publique Cloud SQL, CI/CD, tests automatisés, retrait du rôle `roles/editor` du compte Compute par défaut.
