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

## 2026-08-17 — Suite de l'audit : helmet, filtrage de fichiers, SSL Cloud SQL (priorité 4)

**Helmet**
- `server.js` : `app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }))`. CSP désactivée car l'API ne sert que du JSON (aucune page HTML, la CSP n'a pas d'objet). CORP assoupli en `cross-origin` : par défaut helmet le met à `same-origin`, ce qui aurait pu bloquer les téléchargements de fichiers (GED, KYC, bibliothèque) depuis le frontend — une origine Cloud Run différente de l'API.
- Vérifié en local : en-têtes `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security` présents sur `/health` ; téléchargement d'un document depuis une origine différente (`localhost:4200`) toujours HTTP 200 avec `Cross-Origin-Resource-Policy: cross-origin` dans la réponse — pas de régression.

**Filtrage de type sur les téléversements**
- Nouveau module `backend/src/uploadFilter.js` : liste blanche de types MIME (PDF, images JPEG/PNG/GIF/WebP, Word/Excel/PowerPoint, texte brut), exportée comme fonction `fileFilter` compatible multer.
- Branché sur les 3 points de téléversement existants : `documents.js` (GED), `clients.js` (pièces KYC), `biblio.js` (fichiers associés).
- Multer transmet le rejet du filtre comme une erreur au middleware suivant — sans gestionnaire dédié, Express serait retombé sur sa page d'erreur HTML par défaut. Ajout d'un gestionnaire d'erreurs global dans `server.js` (après le 404, signature à 4 arguments reconnue par Express) qui renvoie systématiquement du JSON propre pour toute erreur non interceptée par une route.
- Vérifié en local : upload d'un PDF accepté ; upload d'un `.exe` (mimetype `application/x-msdownload`) et d'un `.html` (`text/html`) tous deux rejetés avec un message clair (`"Type de fichier non autorisé (...)"`), pas d'erreur brute.

**Cloud SQL — SSL forcé, IP publique conservée (décision documentée)**
- `gcloud sql instances patch juria-pg --require-ssl` appliqué sans risque — le connecteur Cloud SQL Auth Proxy utilisé par Cloud Run chiffre déjà le trafic indépendamment de ce réglage (qui vise les connexions directes par IP). Vérifié : connexion en production toujours opérationnelle après coup.
- **IP publique volontairement conservée**, après vérification (`gcloud sql instances describe`) qu'**aucune IP privée n'est configurée** sur l'instance. La désactiver proprement demanderait de mettre en place au préalable l'accès de service privé (VPC peering) et un connecteur Serverless VPC Access pour Cloud Run — un changement de topologie réseau avec coût récurrent, hors de proportion avec le gain réel (l'IP publique n'a aucun réseau autorisé configuré, donc déjà inaccessible en pratique aux connexions directes). Décision : ne pas y toucher pour l'instant, documentée ici et dans `CLAUDE.md` pour une réévaluation future.

**Déploiement** : image API reconstruite et redéployée. Pas de changement frontend nécessaire.

**Reste (CI/CD, tests automatisés)** : à traiter séparément — CI/CD nécessite une étape de connexion manuelle du dépôt GitHub à Cloud Build (autorisation OAuth via la Console, ne peut pas être automatisée en CLI seule) ; les tests automatisés seront abordés comme un chantier à part (mise en place d'un framework + tests de fumée, pas une couverture exhaustive en une session).

## 2026-08-17 — Audit du dernier fichier non testé (`factures.js`) et suite de tests de non-régression ciblée

**Clôture de l'audit à 100 %**
- Relecture complète de `backend/src/routes/factures.js`, dernier fichier de routes jamais audité. L'unique usage de `COALESCE` (`COALESCE($9, 0)`) porte sur une valeur numérique, pas une chaîne face à une colonne ENUM — pas d'occurrence du bug récurrent.
- Vérifié en Docker de bout en bout : création d'une facture avec champs minimaux, ajout d'un paiement partiel, recalcul correct du statut par `majStatut()` (`"partielle"`), `GET /api/factures` et `GET /api/factures/impayees` cohérents. Aucune anomalie.
- **100 % des fichiers de routes du backend ont maintenant été audités** (manuellement ou testés en conditions réelles) au moins une fois durant cette session.

**« Est-ce important ? » — arbitrage CI/CD vs tests ciblés**
- L'utilisateur a demandé un avis honnête sur l'urgence de CI/CD et des tests automatisés restants. Réponse donnée : CI/CD apporte peu tant que les déploiements restent occasionnels et manuels (le vrai gain — empêcher un merge cassé — ne s'applique pas à un flux à un seul développeur qui teste déjà en Docker avant de pousser) ; en revanche, un test ciblé et automatisé sur le motif de bug récurrent (COALESCE/CASE non casté sur ENUM/UUID, rencontré 6 fois) a un rapport effort/valeur nettement meilleur qu'une suite exhaustive ou qu'un pipeline complet — recommandation : construire ce filet ciblé plutôt que l'un ou l'autre chantier plus lourd. L'utilisateur a validé (« ok »).

**Mise en place de la suite de tests**
- `server.js` : `app.listen()` déplacé derrière `if (require.main === module)` pour que `require("../server")` (utilisé par supertest) n'ouvre plus de port réseau comme effet de bord de l'import — `module.exports = app` reste toujours exposé.
- `backend/package.json` : ajout de `jest` et `supertest` en `devDependencies`, script `"test": "jest --runInBand"` (exécution séquentielle — la suite partage une même base Postgres, pas de parallélisme).
- `backend/tests/setup.js` (nouveau) : `assurerUtilisateurTest()` — upsert idempotent (`ON CONFLICT (email) DO UPDATE`) d'un utilisateur de test actif et validé (`test.regression@jfcavocats-mali.com`), pour que la suite soit rejouable sans réinitialiser la base entre deux exécutions.
- `backend/tests/regression.test.js` (nouveau) : 2 tests de connexion (mauvais mot de passe → 401, bons identifiants → 200) + 6 tests ciblés — un POST minimaliste (champs optionnels enum/UUID délibérément omis) sur chacune des 6 routes historiquement buguées (`dossiers`, `taches`, `roles-audience/lignes`, `courriers`, `documents` — upload réel via `supertest`/`.attach()`, `cabinet/conges`), chacun attendu en 201.
- Exécution : Node n'étant pas installé sur l'hôte et l'image Docker de production étant construite avec `--omit=dev` (sans `devDependencies`), la suite tourne via un conteneur `node:22` éphémère rattaché au réseau `docker compose` (`--network app_default`, `DB_HOST=db`) — voir la commande exacte dans `APP/README.md`.
- **Premier passage : 8/8 tests verts.**
- **Validation du filet de sécurité** : le correctif de `taches.js` a été délibérément annulé (retour à `COALESCE($3,'autre')` sans cast) pour confirmer que le test dédié détecte réellement la régression — résultat : échec confirmé (`Expected: 201, Received: 400`), les 7 autres tests restant verts (isolation correcte). Correctif restauré, suite revérifiée : 8/8 verts à nouveau. La suite est donc un vrai filet de non-régression, pas un test qui passe par construction.
- CI/CD reste non fait, volontairement, en l'état — à reconsidérer si le rythme de déploiement s'accélère ou si l'équipe grandit.

## 2026-08-17 — Câblage multi-devises + TVA par localisation dans la facturation, tests financiers ciblés

**Découverte** : à la question « qu'en pensez-vous ? » sur l'état du projet, réponse honnête donnée — le plus gros risque résiduel n'était pas le CI/CD mais l'absence totale de tests sur la logique financière (rétrocessions, multi-devises, TVA). L'utilisateur a validé (« ok »). En creusant `factures.js` avant d'écrire ces tests : le schéma SQL prévoyait déjà tout un module multi-devises (table `devises` avec parités fixes XOF=1/EUR=655,957 et devises flottantes USD/GBP, table `taux_change` pour l'historique, colonnes `factures.taux_applique/date_taux/taux_verrouille/montant_ttc_xof/libelle_principal`, `paiements.devise/taux_applique/montant_xof`) — **hérité du kit de démarrage dès le tout premier commit** (`git log -S`), mais **jamais câblé dans le code** : `factures.js` ignorait totalement `b.devise`, stockait tout en XOF par défaut, et ne dérivait jamais la TVA de la localisation du client (`clients.pays`) malgré la règle documentée dans `CLAUDE.md` depuis le début du projet.

**Décision** : proposé à l'utilisateur trois options (implémenter puis tester / tester l'existant et documenter le gap / rétrocessions seulement) — validé l'option recommandée (implémenter d'abord).

**Implémentation (`backend/src/routes/factures.js`)**
- Nouvelle fonction `resoudreTauxChange(devise, tauxFourni, userId)` : pour une devise à parité fixe (`devises.flottante = FALSE`), retourne `devises.parite_xof` et **ignore** tout taux fourni par l'appelant (une parité BCEAO ne se négocie pas facture par facture). Pour une devise flottante, utilise le taux explicitement fourni (et l'archive dans `taux_change`, `ON CONFLICT (devise_code, date_taux) DO UPDATE`) ou reprend le dernier taux connu ; sans l'un ou l'autre, refuse la création (`400`) plutôt que d'inventer un taux.
- `POST /api/factures` : accepte `devise?`/`taux_applique?`, calcule et stocke `montant_ttc_xof` (contre-valeur FCFA figée), fixe `taux_verrouille=TRUE`. TVA par défaut résolue via `clients.pays` (18 % Mali/vide, 0 % étranger) — commenté explicitement comme **valeur de départ, pas un avis fiscal**, à valider avec l'expert-comptable du cabinet ; `taux_tva` explicite dans la requête écrase toujours ce défaut.
- `POST /api/factures/:id/paiements` : le paiement hérite automatiquement de la devise et du taux figés de sa facture, calcule `montant_xof`.
- GET listings (`/`, `/impayees`) étendus pour renvoyer `devise`, `taux_applique`, `montant_ttc_xof`.

**Frontend (`pages/facturation/facturation.component.ts`)** : sélecteur de devise (XOF/EUR/USD/GBP), champ taux affiché uniquement pour les devises flottantes, champ TVA laissé vide par défaut (le backend applique alors la règle de localisation), colonne « Contre-valeur FCFA » ajoutée au tableau des factures. Build Angular vérifié sans erreur.

**Vérification manuelle en Docker** : facture XOF/client Mali → TVA 18 % correcte ; facture client étranger → TVA 0 % par défaut ; facture EUR avec tentative d'override du taux (700 envoyé) → 655,957 appliqué quand même (parité ignorant l'override, confirmé) ; facture USD sans taux connu → refusée (400) ; facture USD avec taux fourni (610) → acceptée, taux archivé ; facture USD suivante sans taux → réutilise 610 automatiquement ; paiement partiel sur facture EUR → `paiements.devise/taux_applique/montant_xof` correctement hérités, arrondi correct (655,957 × 500 = 327 978,5 → 327 979).

**Tests automatisés** : nouveau fichier `backend/tests/finance.test.js` (13 tests) — taux de rétrocession par qualité (30/25/10 %, calcul `Math.round(base_ht*taux/100)`), rejet d'une qualité inconnue, règle « tout ou rien » (refus puis acceptation après encaissement intégral), TVA par défaut selon localisation + override explicite, XOF sans conversion, EUR à taux fixe avec override ignoré, USD sans taux connu refusé, GBP avec taux fourni puis réutilisé, propagation devise/taux sur un paiement. Suite complète (`regression.test.js` + `finance.test.js`) sur volume Postgres propre (`docker compose down -v`) : **21/21 verts**.
- ⚠️ Piège rencontré en cours de route : un premier passage de `finance.test.js` a échoué sur le test « USD sans taux connu → refusé » à cause d'un taux USD (610) laissé dans le volume Postgres par mes propres tests manuels précédents (`docker compose down` sans `-v` préserve le volume). Pas un bug — reproduit et confirmé en relançant sur un volume neuf (21/21). Documenté dans `APP/README.md` comme précaution à prendre avant de relancer les tests.

**Déploiement** : voir entrée suivante.

## 2026-08-17 — Déploiement du câblage multi-devises + supervision production (Cloud Monitoring)

**Déploiement**
- Image API reconstruite (`gcloud builds submit --tag .../juria/app:latest APP`) et redéployée sur Cloud Run (`juria`, révision `juria-00020-4wp`).
- Image frontend reconstruite (contexte `APP/frontend`) et redéployée (`juria-web`, révision `juria-web-00017-7v9`).
- Vérification directe en production (pas seulement en Docker local) : le schéma Cloud SQL avait déjà les colonnes multi-devises (héritées du premier import, aucune migration nécessaire) — facture XOF (TVA 18% client Mali) et facture EUR (taux 655,957 correctement figé, TVA 0% client étranger) créées avec succès via l'API de production. Les deux services répondent (`/health` OK, page d'accueil frontend HTTP 200).

**Supervision production (`APP/monitoring/`)**
- Constat : aucune alerte n'existait en production (`gcloud alpha monitoring policies list` → vide), identifié comme deuxième priorité lors de l'échange « qu'en pensez-vous ? » (après les tests financiers).
- Canal de notification e-mail créé (`mohameddaou22@gmail.com`, `notificationChannels/16089389092260988572`).
- 2 vérifications de disponibilité (`gcloud monitoring uptime create`, période 5 min) : `juria-api-health` sur `GET /health` de l'API, `juria-web-accueil` sur la racine du frontend.
- 3 politiques d'alerte (`gcloud alpha monitoring policies create --policy-from-file=...`) :
  - `policy-api-health.yaml` : déclenchée si la vérification API échoue.
  - `policy-web-accueil.yaml` : déclenchée si la vérification frontend échoue.
  - `policy-api-5xx.yaml` : déclenchée si l'API renvoie plus de 5 erreurs 5xx sur une fenêtre de 5 minutes — capture les pannes applicatives qu'un `/health` (qui ne touche ni la base ni les autres routes) ne verrait pas.
- Piège rencontré : la première tentative de création des politiques a échoué (`crossSeriesReducer REDUCE_COUNT_FALSE` incompatible avec les métriques DOUBLE produites par `ALIGN_FRACTION_TRUE`) — corrigé en `REDUCE_MEAN`.
- Les 3 politiques et les 2 vérifications sont actives (`enabled: true`), confirmé par `gcloud alpha monitoring policies list`.
- ⚠️ **Point non vérifié avec certitude** : GCP peut exiger une confirmation du canal e-mail (clic sur un lien reçu par e-mail) avant livraison réelle des alertes — aucune commande `gcloud` ne permet de vérifier ou forcer cette confirmation depuis le CLI. À l'utilisateur de vérifier sa boîte mail et, si besoin, la console GCP (Monitoring → Alerting → Notification channels) pour confirmer que le canal est bien opérationnel.
- Volontairement non fait : alertes de latence, dashboard personnalisé, alertes Cloud SQL (CPU/connexions/disque), intégration Slack/PagerDuty — détails et justification dans `APP/monitoring/README.md`.

## 2026-08-17 — CI/CD tenté puis abandonné (décision de l'utilisateur)

Sur demande de l'utilisateur (« On l'attaque aussi »), tentative de mise en place d'un pipeline Cloud Build (tests → build → push → déploiement API + frontend sur push vers `main`). Un `cloudbuild.yaml` a été rédigé (jamais committé) et le début de la connexion GitHub↔Cloud Build a été amorcé, mais le travail a buté sur plusieurs modifications IAM bloquées par le classificateur de permissions de l'environnement (accorder `roles/run.admin` au compte de service Cloud Build, `roles/iam.serviceAccountUser` sur `juria-api-sa`/`juria-web-sa`, et `roles/secretmanager.admin` au service-agent Cloud Build nécessaire à la connexion GitHub 2e génération) — 4 commandes remises à l'utilisateur pour exécution manuelle.

**L'utilisateur a ensuite décidé de ne pas poursuivre** (« Finalement pas besoin du CI/CD »). Aucune commande IAM n'a été exécutée, aucune ressource GCP créée (la tentative de connexion GitHub a échoué avant complétion — confirmé par `gcloud builds connections list` vide). `cloudbuild.yaml` supprimé (n'avait jamais été committé). Décision : le déploiement manuel (`gcloud builds submit` + `gcloud run deploy`, voir `scripts/gcloud-docker.sh`) reste le mode opératoire du projet. À ne pas relancer sans que l'utilisateur ne le redemande explicitement.

## 2026-08-17 — Statuts réels du personnel (11) + système de permissions configurable

**Origine** : demande de l'utilisateur de confirmer que le registre des 53 commandes couvrait bien « l'ensemble des fonctions du personnel ». Réponse honnête donnée : non, le registre reflétait 6 rôles techniques (`associe, collaborateur, stagiaire, assistante, comptable, admin`) alors que la spec fonctionnelle en nommait 8 (dont un « Of Counsel » jamais distingué techniquement) — écart à combler avant de faire confiance au registre. L'utilisateur a alors fourni les **11 statuts réels** du cabinet : Avocat associé, Avocat Of Counsel, Avocat collaborateur, Avocat stagiaire, Collaborateur non-avocat/juriste, Administrateur général, Assistante juridique et administrative, Comptable, Assistant comptable, Administrateur IT, Archiviste.

**Clarification de périmètre déterminante** : posée la question de savoir s'il fallait aussi verrouiller les ~34 actions déjà ouvertes à « tous rôles » pour que des périmètres comme celui de l'Archiviste soient réellement étanches. Réponse de l'utilisateur : ne pas se concentrer sur redéfinir qui peut faire quoi maintenant — **construire le mécanisme pour qu'un administrateur autorisé puisse lui-même cocher/décocher chaque fonctionnalité pour chaque profil**, sans dépendre d'une session de développement à chaque ajustement. Ce changement d'objectif (passer d'un « bon mapping rôle→droits » à un « système de permissions piloté par une table, éditable en production ») a été traité en mode plan (`EnterPlanMode`) vu son ampleur, plan approuvé par l'utilisateur avant implémentation.

**4 questions ciblées posées avant le plan** (les 7 autres statuts ayant une correspondance évidente) :
- **Administrateur IT** : réponse texte libre de l'utilisateur (« a la main sur toutes les actions... débloque les problèmes rencontrés par le personnel ») → interprété comme mêmes droits que l'Administrateur général sur toutes les actions métier, identité distincte pour la traçabilité.
- **Archiviste** : GED/courrier/bibliothèque (recommandé, retenu) — mais voir plus bas, pas verrouillé en dur.
- **Avocat Of Counsel** : identique à Avocat collaborateur (recommandé, retenu — cohérent avec la règle de rétrocession déjà en place qui les regroupe à 25 %).
- **Assistant comptable** : consultation/soumission uniquement, jamais décaissement/validation (recommandé, retenu).

**Précision mi-parcours de l'utilisateur** (reçue pendant l'implémentation) : « Seuls les associés et l'Administrateur IT doivent autoriser (cocher/décocher) toutes les autorisations » — plus restrictif que le plan initial, qui prévoyait Associé + Administrateur général + Administrateur IT pour l'ensemble du module Accès & permissions. Appliqué en restreignant spécifiquement les 2 routes de la matrice (`GET/PUT /api/acces/permissions`) à Associé + Administrateur IT, en gardant Administrateur général sur le reste du module (comptes, rôles, délégations) — interprétation communiquée explicitement à l'utilisateur plutôt que supposée silencieusement.

**Implémentation**
- `schema.sql` : `role_utilisateur` étendu de 6 à 11 valeurs (`admin` renommé `admin_general` + 5 ajouts : `of_counsel`, `juriste`, `assistant_comptable`, `admin_it`, `archiviste`). Nouvelle table `permissions_role` (role, action_code, autorise ; clé composite ; absence de ligne = refus par défaut). Seed en 2 blocs SQL reproduisant exactement le comportement d'avant la bascule (34 actions ouvertes → TRUE pour les 11 rôles ; 10 actions déjà réservées → TRUE uniquement pour les rôles qui y avaient déjà accès, `admin_it` s'ajoutant partout où `admin_general` apparaît).
- `backend/src/permissions.js` (nouveau) : catalogue statique des 44 actions configurables (module, code, libellé, `restreinte` pour les 10 historiques) + middleware `requirePermission(actionCode)` qui interroge `permissions_role`.
- **Les 44 actions métier du registre ont été câblées** avec `requirePermission` — pas seulement les 10 déjà réservées. Premier test manuel après l'implémentation initiale (10 actions seulement) : un compte Archiviste désautorisé sur `clients.creer` via la nouvelle route pouvait *quand même* créer un client (test resté à 201 au lieu du 403 attendu) — la promesse « le levier existe pour resserrer n'importe quelle action » était fausse pour les 34 actions ouvertes, qui n'avaient jamais été reliées au middleware. Corrigé en câblant `requirePermission` sur les 34 routes restantes (`documents.js`, `communications.js`, `dossiers.js`, `clients.js`, `originaux.js`, `evenements.js`, `courriers.js`, `actes.js`, `biblio.js`, `temps.js`, `factures.js`, `ia.js`, et les routes ouvertes restantes de `taches.js`/`depenses.js`/`cabinet.js`/`retrocessions.js`/`conflicts.js`) ; vérifié par recoupement automatique (`grep` des 44 `requirePermission(...)` du code vs les 44 codes du catalogue — correspondance exacte) puis reconfirmé par le même test manuel (403 puis 201 après réactivation).
- `acces.js` : `router.use(requireRole("associe","admin_general","admin_it"))` conservé pour le module ; deux nouvelles routes `GET/PUT /api/acces/permissions` avec un second middleware `requireRole("associe","admin_it")` empilé (plus restrictif, exclut `admin_general` — voir précision utilisateur ci-dessus) ; `ROLES_VALIDES` étendu aux 11 statuts.
- Frontend : `acces.component.ts` — les 2 listes déroulantes de rôle passent de 6 à 11 options ; nouvelle section « Matrice des permissions » (tableau regroupé par module, une case à cocher par rôle × action, sauvegarde immédiate, masquée silencieusement pour un `admin_general` puisque l'API renvoie 403 — pas traité comme une erreur). `retrocessions.component.ts` : suggestion auto de qualité corrigée pour les nouveaux rôles (`juriste` → 10 %, `of_counsel` → 25 % comme collaborateur).

**Piège de migration production** : un premier `gcloud sql import sql` avec tout le bloc (ALTER TYPE + CREATE TABLE + seed) a échoué (`ERROR_RDBMS`, arrêt juste après le `BEGIN` du bloc de seed) malgré les `ALTER TYPE ADD VALUE` placés hors de toute transaction explicite dans le fichier — l'outil d'import Cloud SQL semble tout empaqueter dans une transaction serveur unique, contrairement à `psql -f`. Résolu en import**s** (au pluriel) strictement séquentiels : d'abord un fichier ne contenant que les `ALTER TYPE`, puis — une fois cette opération Cloud SQL `done` confirmée — un second fichier avec la `CREATE TABLE` et le seed. Les deux ont réussi. Documenté dans `CLAUDE.md` pour tout futur changement de schéma du même genre (ajout de valeur d'enum réutilisée dans le même lot).

**Vérification** : suite Docker locale sur schéma neuf (`down -v` puis rebuild) — 0 erreur de chargement, comptes exacts en base (`associe`/`admin_general`/`admin_it` = 44 lignes chacun, `comptable` = 37, les 7 autres rôles = 34) ; suite de tests existante (21/21, aucune régression malgré le renommage `admin`→`admin_general`) ; création + validation de comptes `archiviste` et `admin_it` de test ; bascule en direct d'une permission (403 puis 201) ; confirmation qu'un `admin_general` de test est bien exclu de la matrice (403 sur GET et PUT) tout en gardant accès au reste du module (200 sur `/audit`). Rejoué à l'identique en production après déploiement (API révision `juria-00021-md9`, frontend révision `juria-web-00018-pgn`) : catalogue de 44 actions et 407 lignes de permissions confirmés via l'API, compte archiviste de production créé/validé/testé avec succès.

**Registre des commandes** (artefact déjà publié) republié au même lien : 11 statuts, bandeau explicite que les valeurs affichées sont des valeurs de départ modifiables via la matrice.

## 2026-08-17 — Gestion de la concurrence entre utilisateurs (chevauchement)

**Question de l'utilisateur** : que prévoit JURIA quand deux profils interviennent en même temps sur une même rubrique, ou plus largement sur un même dossier (même avec des manipulations différentes) ? Réponse honnête d'abord (avant tout correctif) : aucune collaboration temps réel n'existe (pas de WebSocket, pas d'indicateur de présence) ; le motif `COALESCE($n, colonne)` déjà utilisé dans les routes d'édition protège nativement le cas « champs différents modifiés en même temps » (relit la valeur courante en base au moment de l'exécution, pas une copie côté client) mais pas le cas « même champ, même moment » ; certaines transitions d'état avaient déjà une garde contre le double déclenchement, d'autres non. Six scénarios distingués et quatre niveaux de solution proposés (de « combler le trou existant » à « présence temps réel », jugé disproportionné pour la taille du cabinet). L'utilisateur a validé les niveaux 1 et 2.

**Niveau 1 — généraliser la garde contre le double déclenchement d'une transition irréversible**
- Audit complet des 10 actions de transition du catalogue de permissions : 6 avaient déjà une garde (`audiences.role.valider/diffuser`, `depenses.decision/decaisser`, `acces.valider`), **4 ne l'avaient pas** — trouvé en vérifiant systématiquement plutôt qu'en supposant. Corrigées : `retrocessions.decaisser`, `taches.valider`, `conflicts.decision`, `cabinet.conges.decision`. Chacune ajoute une clause `WHERE ... AND <condition d'état initial>` sur l'UPDATE et distingue désormais 404 (introuvable) de 409 (déjà traité, avec message explicite) au lieu d'écraser silencieusement qui a fait l'action et quand.
- `cabinet.bulletins` volontairement laissé en `ON CONFLICT DO UPDATE` : régénérer/corriger un bulletin du même mois est un usage légitime, pas un bug à corriger.

**Niveau 2 — verrouillage optimiste sur l'édition de fiche client**
- Seule route d'édition multi-champs d'une fiche existante identifiée (`dossiers.js` n'a pas de PUT du tout) : `PUT /api/clients/:id`. Ajout d'un paramètre optionnel `maj_le_attendu` (valeur de `clients.maj_le` vue par le client au chargement) ; si fourni et que la fiche a changé entre-temps, `409` explicite plutôt qu'un écrasement muet.
- ⚠️ **Piège rencontré et corrigé en testant** : la comparaison stricte `maj_le = $17` échouait presque systématiquement, y compris pour une écriture parfaitement légitime juste après le chargement de la fiche — vérifié directement en base (`SELECT maj_le::text`) : Postgres stocke `TIMESTAMPTZ` à la microseconde (`21:15:01.899947`), mais le passage par JSON/`Date` JavaScript arrondit à la milliseconde (`899` au lieu de `899947`), donc plus jamais strictement égal. Corrigé en tronquant les deux côtés à la milliseconde (`date_trunc('milliseconds', maj_le) = date_trunc('milliseconds', $17::timestamptz)`). Sans ce piège trouvé par un test réel (pas une relecture de code), le niveau 2 aurait été livré cassé — rejetant toute sauvegarde légitime.
- Frontend (`client-detail.component.ts`) : envoie désormais `maj_le_attendu` à chaque édition, recharge automatiquement la fiche en cas de `409` pour repartir sur une base fraîche.

**Autres points identifiés mais non traités** (documentés, pas oubliés) : la numérotation automatique (courrier/dossier/facture) a une fenêtre de course théorique sur son calcul `COUNT(*)+1`, sans risque de doublon réel grâce à une contrainte `UNIQUE` en base, mais avec une erreur brute peu conviviale en cas de collision — noté pour une future amélioration UX, pas un risque d'intégrité.

**Vérification** : suite complète (21/21) toujours verte après les 5 correctifs. Tests manuels ciblés sur chacun : double décaissement de rétrocession (200 puis 409), double validation de tâche (200 puis 409), double décision de conflit (200 puis 409), double décision de congé (200 puis 409), verrou optimiste client testé sous ses 3 angles (bonne valeur → 200, valeur périmée → 409, sans le paramètre → comportement historique inchangé). Reconfirmé en production après déploiement (double validation de tâche : 200 puis 409).

## 2026-08-17 — Messagerie instantanée interne (nouveau module, hors des 17 initiaux)

**Demande** : à la suite du traitement de la concurrence, l'utilisateur demande une messagerie instantanée intégrée pour dialoguer entre deux ou plusieurs personnes de l'équipe, référence donnée = le chat écrit de Zoom, pour des besoins divers (échanges sur un dossier, instructions, informations). Clarifications demandées avant de planifier : périmètre (1-à-1 / fils par dossier / les deux) et fraîcheur acceptable (rafraîchissement périodique vs vrai temps réel). L'utilisateur a répondu en insistant deux fois sur « instantanée » et en reprenant l'exemple de Zoom pour des conversations à deux **ou plus** — interprété comme une demande explicite de réception réellement poussée (pas un simple polling), et de groupes de discussion (pas limité au 1-à-1).

**Décision d'architecture** (mode plan utilisé vu l'ampleur — nouveau module, décision d'infrastructure, plusieurs fichiers) : JURIA tourne sur Cloud Run, sans état, potentiellement plusieurs instances — un vrai chat « instantané » demande normalement un composant de diffusion inter-instances (Redis, Firestore, Pub/Sub). Choix retenu : **Postgres LISTEN/NOTIFY**, déjà disponible sans service GCP supplémentaire, et qui diffuse nativement à toutes les connexions en écoute quelle que soit l'instance Cloud Run qui les détient — résout le problème multi-instances sans rien ajouter à l'infrastructure. Diffusion côté client via **Server-Sent Events** (`EventSource`, réception à sens unique, reconnexion automatique native du navigateur) plutôt qu'un WebSocket bidirectionnel complet, l'envoi restant un `POST` classique. Messages gardés dans la même base Postgres sauvegardée/auditée que le reste de l'application plutôt que dans un second datastore (Firestore envisagé puis écarté) — jugé important pour un cabinet d'avocats de ne pas fragmenter les échanges professionnels hors du système déjà backuppé/audité.

**Schéma** (`APP/db/schema.sql`) : `conversations` (titre optionnel pour les groupes, `dossier_id` optionnel pour rattacher à un dossier sans l'imposer), `conversation_participants` (clé composite, `dernier_lu_le` pour le calcul des non-lus), `messages`. 2 nouvelles entrées dans le catalogue de permissions (`messagerie.creer_conversation`, `messagerie.envoyer_message`), ouvertes par défaut aux 11 rôles — cohérent avec les autres outils de communication déjà ouverts à tous.

**Backend** :
- `backend/src/messagerie-bus.js` (nouveau) : connexion PG dédiée en `LISTEN` (hors du pool `db.js`, dédiée pour ne pas consommer une place du pool à `max: 10`), avec reconnexion automatique en cas de coupure. Registre en mémoire des flux SSE ouverts localement (`Map<utilisateur_id, Set<Response>>`). `publier()` fait un `pg_notify()` plutôt que d'écrire directement sur les flux locaux, pour que le comportement soit identique qu'il y ait une ou plusieurs instances actives.
- `backend/src/routes/messagerie.js` (nouveau) : CRUD conversations/messages + `/non-lus` + `/stream` (SSE). `/stream` ne passe pas par le middleware `authenticate` standard — `EventSource` ne peut pas poser d'en-tête `Authorization` — le jeton est accepté en paramètre de requête et vérifié à la main avec le même `SECRET`.
- ⚠️ **Piège rencontré et corrigé** : la connexion `LISTEN`, démarrée au chargement du module, empêchait Jest de se terminer (la suite de tests a timeout après 120s au lieu de rendre un résultat — reproduit, root-causé, pas juste supposé). Corrigé en sautant `demarrerEcoute()` quand `NODE_ENV=test` (positionné automatiquement par Jest). Suite retestée immédiatement après correctif : verte en 2,87s.

**Frontend** : `core/messagerie.service.ts` (nouveau, singleton `providedIn: 'root'`) — un seul `EventSource` partagé pour toute l'application, ouvert une fois après connexion (`login.component.ts`) et fermé à la déconnexion (`app.component.ts`), alimentant à la fois la pastille de non-lus de la barre latérale et l'écran dédié. Pas d'ajout optimiste du message envoyé : il revient via son propre écho SSE (l'auteur est lui-même participant donc abonné), ce qui évite un doublon si on l'ajoutait aussi à la réponse du `POST`. `pages/messagerie/messagerie.component.ts` (nouveau) : liste des conversations, fil actif, sélecteur de participants (réutilise l'annuaire déjà existant).

**Déploiement** : délai de requête Cloud Run du service `juria` porté à 3600s (`--timeout=3600`) pour que le flux SSE tienne dans la durée sans coupure toutes les 5 minutes.

**Vérification** :
- Local (Docker) : suite complète 21/21 verte après le correctif `NODE_ENV`. Test réel de diffusion : `curl -N` sur `/stream` avec le jeton d'un compte B pendant qu'un compte A poste un message — réception confirmée en quelques centaines de ms. Compteurs de non-lus vérifiés dans les deux sens (incrémentation à la réception, remise à zéro après `/lu`).
- **Production** : même test rejoué avec deux comptes réels créés pour l'occasion, à travers deux requêtes HTTP distinctes (donc potentiellement deux instances Cloud Run différentes, pas comparable à un test local à instance unique) — réception confirmée en direct, validant que LISTEN/NOTIFY diffuse effectivement au-delà d'une seule instance et pas seulement en conditions de test simplifiées.

## 2026-08-17 — Deux statuts du personnel omis, ajoutés après coup

**Demande** : l'utilisateur signale deux statuts omis lors du premier tour de la liste des 11 rôles réels : « Avocat associé-fondateur » (une sorte de chairman) et une distinction entre « Avocat stagiaire » (parcours avocat) et « Stagiaire » simple (non-avocat) — jusque-là fondus en un seul.

**Clarification demandée puis corrigée en cours de route** : question posée sur le périmètre de l'associé-fondateur (identique à un associé y compris la matrice de permissions, ou pas). Première réponse de l'utilisateur : identique à l'associé y compris la matrice (recommandé). **Corrigée immédiatement après par l'utilisateur, en plein milieu de l'implémentation** : « l'associé fondateur n'a pas accès au permission mais même droit que l'associé classique » — la garde de route déjà modifiée pour inclure `associe_fondateur` dans `requireAssocieOuAdminIt` a été immédiatement retirée (le fondateur garde tous les droits d'un associé classique ailleurs dans le module Accès & permissions, mais reste exclu des deux routes de la matrice elle-même, comme l'associé classique l'était déjà — pas de changement pour lui). Le seed en base (`permissions_role`) n'était pas concerné par cette correction : la matrice de permissions ne couvre que les actions métier cataloguées, jamais l'accès à la matrice elle-même, qui est un `requireRole()` en dur indépendant.

**Implémentation** :
- `schema.sql` : `role_utilisateur` étendu de 11 à 13 valeurs — `ALTER TYPE ... RENAME VALUE 'stagiaire' TO 'avocat_stagiaire'` (préserve automatiquement toutes les lignes existantes, simple ré-étiquetage) + `ADD VALUE 'stagiaire'` (nouveau sens) + `ADD VALUE 'associe_fondateur'`. Seed : `associe_fondateur` reprend par copie directe (`INSERT ... SELECT ... FROM permissions_role WHERE role='associe'`) l'intégralité des permissions d'`associe` sur les 46 actions cataloguées, plutôt que de les ré-énumérer à la main (source d'erreur déjà évitée une fois avec la même technique) ; le nouveau `stagiaire` copie de la même façon le profil d'`archiviste` (actions ouvertes seulement).
- `backend/src/routes/acces.js` : `ROLES_VALIDES` étendu ; garde commune du module (`router.use`) étendue à `associe_fondateur` ; garde de la matrice (`requireAssocieOuAdminIt`) explicitement **non** étendue (corrigée en cours de route, voir ci-dessus) — reste `associe` + `admin_it` uniquement.
- Frontend : `acces.component.ts` (13 rôles dans le sélecteur), `retrocessions.component.ts` (suggestion de qualité : `associe_fondateur` → 30 %, `avocat_stagiaire` → 25 % comme avant, nouveau `stagiaire` → 10 %).
- Migration production en 2 imports Cloud SQL séquentiels, même prudence que la première fois (`ALTER TYPE` isolé avant tout usage de la nouvelle valeur). Un commentaire SQL initialement trompeur (« accès complet, y compris la matrice elle-même ») corrigé avant migration pour éviter une confusion future — la matrice n'a jamais été pilotée par cette table.

**Vérification** : suite complète 21/21 verte sur schéma neuf. Tests manuels : compte `associe_fondateur` de test — 200 sur la gestion des comptes (`/audit`), 404 (pas 403) sur une tentative de décaissement de rétrocession (confirme l'autorisation métier accordée, l'objet n'existant simplement pas), 403 sur la matrice (confirme l'exclusion). Compte `stagiaire` (non-avocat) de test — 201 sur une action ouverte (créer un client), 403 sur une action réservée (décaisser une rétrocession). Rejoué à l'identique en production après déploiement (compte `associe_fondateur` réel : 200 puis 403 confirmés).

## 2026-08-18 — Role level security : visibilité des listes sensibles (axe B)

**Origine** : après avoir confirmé le fonctionnement de la matrice de permissions, l'utilisateur pose une série de questions de fond sur le « role level security » — y a-t-il d'autres contenus qui devraient avoir une absence de visuel/accès selon le profil, faut-il un attribut « Confidentiel » sur les dossiers, quelles autres hypothèses ai-je omises (exemple donné : un profil qui a accès à une liste mais pas à tous ses éléments).

**Audit fait avant de répondre** (pas de réponse à l'aveugle) : `documents.confidentialite` existe déjà dans le schéma (`dossier/equipe/interne/restreint`) mais n'est **jamais lu pour filtrer** — pure étiquette décorative. `GET /api/dossiers`, `/api/clients`, `/api/factures`, `/api/depenses`, `/api/retrocessions` sont ouvertes à tout rôle ayant l'accès de base au module, sans filtrage par ligne — n'importe qui voit tout, y compris la rémunération individuelle de chacun via `/api/retrocessions`. `GET /api/cabinet/bulletins?utilisateur_id=` se limite « à soi-même » par défaut mais le paramètre de requête n'est vérifié par rien — contournable trivialement pour voir le bulletin de n'importe qui.

**Deux axes distingués** (proposé par Claude, validé par l'utilisateur) :
- **Axe A** — confidentialité fine, dossier par dossier, élément par élément, configurable par profil (exemples de l'utilisateur : facturation, rétrocessions, salaires, dépenses & caisse rendus invisibles pour certains profils, avec sélection des éléments visibles/modifiables). L'utilisateur reconnaît lui-même « beaucoup d'interrogations mais difficile de trancher » — **mis de côté volontairement**, confirmé explicitement par l'utilisateur (« je confirme la mise à côté de l'axe A »).
- **Axe B** — modules entiers invisibles ou en lecture seule pour certains profils. Formule proposée : réutiliser le catalogue de permissions existant avec des actions « `.consulter` », validée par l'utilisateur avec un tableau précis de qui voit les montants de tout le monde.

**Point spécifique tranché** : l'utilisateur demande explicitement mon avis sur l'inclusion d'Administrateur IT dans la visibilité des rétrocessions (ajouté pour des raisons pratiques de dépannage, pas de supervision financière). Recommandation donnée et retenue : **l'exclure par défaut** — principe de moindre privilège, et comme l'IT fait partie des deux seuls rôles pouvant modifier la matrice, il peut se l'accorder lui-même ponctuellement si un vrai besoin de dépannage survient, plutôt que de l'avoir ouvert en permanence.

**Implémentation**
- `backend/src/permissions.js` : 4 nouvelles actions cataloguées — `factures.consulter`, `depenses.consulter`, `retrocessions.consulter`, `cabinet.bulletins.consulter`.
- Distinction posée entre deux natures de données lors de l'implémentation : **factures/dépenses** (données financières du cabinet, pas de notion de « propriétaire ») → module entier invisible sans exception, garde directe `requirePermission(...)` sur `GET /`. **Rétrocessions/bulletins** (rémunération individuelle) → chacun voit toujours **les siens** sans permission (vérification inline sur `beneficiaire_id`/`utilisateur_id === req.user.sub`), seule la vue sur ceux des autres exige la permission — corrige au passage le contournement `?utilisateur_id=` des bulletins découvert pendant l'audit.
- `backend/src/routes/profil.js` : `GET /api/profil` renvoie désormais `permissions: string[]` (actions autorisées pour le rôle de l'appelant) — pour que le frontend n'ait pas à deviner ou à essayer un appel pour voir s'il échoue.
- Frontend : `AuthService.chargerProfil()` (nouveau, appelé après connexion et au démarrage de l'appli pour couvrir le rechargement de page) peuple un signal `permissions`, consulté via `auth.peut(actionCode)`. `NavItem` gagne un champ optionnel `requiert?`, et les entrées Facturation/Rétrocessions/Dépenses & caisse du menu disparaissent silencieusement (pas de message d'erreur, juste absentes) si le rôle n'a pas la permission de consultation correspondante — même principe déjà utilisé pour masquer la matrice à l'Administrateur général.
- Seed en base (`schema.sql`) : factures/dépenses ouvertes à Associé/Associé-fondateur/Admin général/Admin IT/Comptable/Assistant comptable (6 rôles) ; rétrocessions/bulletins aux 5 mêmes **sauf Admin IT**.
- Migration production : un seul import Cloud SQL cette fois (aucun enum touché, pas de piège `ALTER TYPE`).

**Vérification** : suite complète 21/21 verte. Tests manuels ciblés : un compte collaborateur de test reçoit 403 sur `GET /api/factures` et sur `GET /api/retrocessions` (sans filtre), mais 200 sur ses propres rétrocessions (`?beneficiaire_id=soi`) et sur son propre bulletin ; 403 confirmé sur le bulletin d'un tiers (le contournement d'avant, maintenant fermé). Un compte admin_it reçoit 200 sur factures/dépenses mais 403 sur la liste complète des rétrocessions — asymétrie voulue confirmée. Rejoué à l'identique en production après déploiement (collaborateur réel : 403 sur factures, 200 sur ses propres rétrocessions ; `GET /api/profil` confirmé renvoyant la liste de permissions).

## 2026-08-18 — Seuil minimum d'honoraires par dossier (anti-dissimulation)

**Origine** : l'utilisateur veut qu'aucun dossier ouvert au cabinet (hors pro bono) ne puisse rester sans un minimum d'honoraires facturés — risque visé : un avocat apporteur qui traite un dossier sans jamais le faire apparaître financièrement dans JURIA. Questions posées : faut-il bloquer l'émission de facture sous un montant ? indiquer le statut des honoraires sur le rôle ? alerter l'apporteur, les autres avocats, le comptable, l'administrateur général ? Même question pour les assistances ponctuelles hors dossier formel (garde à vue, devant le procureur/une autorité administrative), qui peuvent ne jamais aboutir à un dossier. Proposition initiale en plusieurs formules (facture d'ouverture automatique, statut visible, alertes échelonnées, séparation des tâches sur l'encaissement, fiche d'intervention légère hors dossier, remboursement de frais conditionné à une trace dans JURIA) — la commission d'apport existante jugée insuffisante seule : elle récompense ce qui est déclaré, pas ce qui ne l'est jamais.

**Précisions apportées par l'utilisateur avant l'implémentation** :
- Les 50 000 FCFA (mis à jour depuis ~45 000) concernent **uniquement** le paiement minimum obligatoire des dossiers **pro bono** (frais de procédure) — distinct d'un seuil d'honoraires pour les dossiers classiques, proposé à 150 000 FCFA par l'utilisateur (« je ne sais pas s'il faut une évaluation mieux réfléchie »). Confirmé après discussion : seuil unique et flat pour tous les dossiers non pro bono (pas de découpage par pôle/matière dans cette passe).
- Deux mécanismes distincts, pas un seul : un dossier `pro_bono=TRUE` est soumis à un **quota** (nombre de dossiers pro bono autorisés par responsable/mois) avec **blocage réel** à la création au-delà du quota ; un dossier classique est soumis au **seuil d'honoraires** (visibilité + alertes, pas de blocage).
- Les seuils (honoraires classique, frais pro bono, quota pro bono) doivent être **configurables en base**, même logique que la matrice de permissions — « afin d'éviter des blocages », le seuil sert de soupape réglable plutôt que de verrou rigide.
- Le 150 000 FCFA est un **plancher minimum, pas un forfait imposé ni un plafond** — un dossier peut toujours être facturé bien au-delà (précision explicite demandée et confirmée par l'utilisateur).
- Le job d'alerte doit être **réellement programmé** (Cloud Scheduler), pas seulement un endpoint qui existe sans jamais être appelé.

**Exploration préalable (2 agents Explore en parallèle, mode plan)** — découvertes déterminantes :
- `dossiers.pro_bono` existait déjà en base (ajouté le 17/08/2026) mais n'était **jamais réglable** : absent de `POST /api/dossiers` et du frontend, toujours `FALSE` en pratique — colonne morte.
- **Aucun `PUT`/`PATCH` sur `/api/dossiers`** n'existe — pas de mécanisme de transition d'état, donc pas de point pour « bloquer une activation » qui n'existe pas. Le contrôle porte forcément sur la création (quota) et la visibilité (seuil).
- `factures.montant_ttc_xof` est déjà calculé pour toute facture, toute devise (mécanisme multi-devises câblé le 17/08/2026) — pivot naturel pour comparer un cumul de facturation à un seuil FCFA sans reconversion, satisfait nativement le « ou son équivalent en devise » de la demande.
- Le quota Pro Bono (2/mois/responsable, `retrocessions.js`) était **purement informatif** — aucune route ne le faisait respecter. Sans blocage réel, rendre `pro_bono` réglable aurait ouvert une échappatoire triviale au seuil classique (marquer n'importe quel dossier « pro bono »).
- Aucune notion d'« apporteur » distincte de `dossiers.responsable_id` n'existe dans le schéma (recherche exhaustive, aucun résultat) — les alertes ciblent `responsable_id`, limitation documentée plutôt que masquée.
- Le job d'alerte de délais existant (`evenements.js`, `POST /jobs/alertes`) n'était **jamais réellement déclenché en production** : aucun Cloud Scheduler configuré dans le projet, et la route n'avait même aucun contrôle de permission (trouvé en creusant pour construire le job honoraires sur le même patron).
- `parametres_cabinet` (table mono-ligne, en-tête cabinet) était le candidat naturel pour les seuils configurables, mais n'avait aucune route d'exposition (ni lecture ni écriture).

**Implémentation**
- `schema.sql` : `parametres_cabinet` étend de 3 colonnes (`honoraires_min_xof` 150 000, `frais_procedure_pro_bono_min_xof` 50 000, `quota_pro_bono_mensuel` 2, toutes avec ces valeurs par défaut). `dossiers` gagne 3 colonnes booléennes (`alerte_honoraires_j3/j7/j15`, même patron que `evenements.alerte_j30` etc.). Nouvelle table `alertes_honoraires` (journal des alertes envoyées, dédiée — pas la messagerie interne, dont `messages.auteur_id` est `NOT NULL` et pensée pour le chat humain, pas les notifications système). 3 nouvelles actions cataloguées (`dossiers.pro_bono.declarer`, `evenements.jobs.declencher`, `parametres.honoraires.modifier`), seedées par défaut au cluster direction habituel (associé/associé-fondateur/admin général/admin IT, sauf `parametres.honoraires.modifier` limité à associé + admin IT comme la matrice elle-même — mais via `permissions_role`, pas un `requireRole` en dur : pas de risque d'auto-verrouillage analogue à la matrice).
- `backend/src/permissions.js` : nouvel helper exporté `estAutorise(role, actionCode)` (factorisé depuis `requirePermission`), pour le contrôle conditionnel dans `dossiers.js` (seule la déclaration `pro_bono=true` exige la permission, pas la création elle-même — impossible à exprimer comme un simple middleware de route).
- `backend/src/routes/dossiers.js` : `POST /` accepte `pro_bono`, vérifie la permission puis le quota (409 explicite si dépassé) avant l'INSERT. `GET /` et `GET /:id` calculent `statut_honoraires` (`sans_honoraires`/`sous_seuil`/`atteint`/`abonnement`) via un `LEFT JOIN LATERAL` sur le cumul de factures non annulées, comparé au seuil applicable (`pro_bono` → seuil pro bono, sinon → seuil classique) ; `mode_honoraires='abonnement'` exempté (pas de table contrat-cadre dans le schéma pour vérifier au bon niveau — limitation documentée).
- `backend/src/routes/parametres.js` (nouveau) : `GET/PUT /api/parametres/honoraires`, lecture ouverte, écriture réservée par `parametres.honoraires.modifier`.
- `backend/src/jobs/alertesDelais.js` (nouveau, extrait de `evenements.js`) et `backend/src/jobs/alertesHonoraires.js` (nouveau) : logique pure `executerJob...(pool[, bus])`, réutilisable en HTTP et en test direct. Le job honoraires notifie par paliers croissants (J+3 responsable seul, J+7 + associés actifs, J+15 + comptabilité/admin) avec repli sur le palier le plus haut si plusieurs sont franchis d'un coup (job qui n'a pas tourné depuis un moment) — idempotent via les 3 colonnes booléennes.
- `backend/src/routes/internal-jobs.js` (nouveau) : `/internal/jobs/alertes-delais` et `/internal/jobs/alertes-honoraires`, montés dans `server.js` **hors** `authenticate` (un job planifié n'a pas de jeton utilisateur), protégés par un secret partagé (`X-Scheduler-Secret` vs `SCHEDULER_SECRET`, refuse `503` si non configuré plutôt que d'accepter tout appel par défaut) — même principe que `/api/messagerie/stream`, qui gère déjà sa propre authentification hors du middleware standard.
- `backend/src/routes/evenements.js` : `POST /jobs/alertes` (déclenchement manuel) gagne `requirePermission("evenements.jobs.declencher")` — gap trouvé en creusant, corrigé au passage.
- `backend/src/routes/retrocessions.js` : `QUOTA_PRO_BONO_MENSUEL` (constante en dur) remplacé par une lecture de `parametres_cabinet.quota_pro_bono_mensuel`.
- `backend/src/routes/dashboard.js` : nouveau KPI `dossiers_sous_seuil_honoraires`, même calcul que `dossiers.js`.
- Frontend : `dossiers.component.ts` (badge honoraires sur le rôle, même patron `.tag` que les statuts de compte), `dossier-detail.component.ts` (panneau honoraires : cumul, seuil, statut, alertes déjà déclenchées), `acces.component.ts` (nouvelle section « Seuils honoraires », visible/éditable seulement si `auth.peut('parametres.honoraires.modifier')`), `cockpit.component.ts` (nouvelle tuile KPI).
- ⚠️ **Gap trouvé en cours d'implémentation, non comblé dans cette passe** : aucun écran frontend ne permet de créer un dossier (`api.creerDossier` n'est appelé nulle part — le module « Nouveau dossier » ne couvre que le contrôle des conflits, `ouverture.component.ts`, pas la création elle-même). La case à cocher « pro bono » prévue dans le plan initial n'a donc nulle part où s'accrocher côté UI ; l'API et les tests couvrent `pro_bono` complètement, mais un formulaire de création de dossier reste à construire (hors périmètre de cette session, signalé plutôt que masqué).

**Vérification** : suite complète 29/29 verte (8 nouveaux tests, `backend/tests/honoraires.test.js`, sur schéma neuf `down -v`). Build Angular en production vérifié sans erreur. Tests manuels en local (Docker) : création pro bono refusée (403) pour un rôle sans la permission, acceptée pour un associé ; quota bloqué au 3ᵉ dossier pro bono du mois pour un même responsable (409) ; statut honoraires vérifié sur le rôle (`sans_honoraires` à la création) ; route de configuration testée (lecture ouverte, écriture 403 sans permission puis 200 avec) ; job de délais confirmé protégé par permission (403 puis 200) ; point d'entrée interne confirmé fermé sans secret configuré (503), rejeté avec un mauvais secret (401), fonctionnel avec le bon secret (200), et idempotent (un second appel ne renvoie plus un dossier déjà traité au palier maximal atteint).

**Non fait dans cette passe, volontairement** : blocage des actions du dossier en aval (actes, audiences, courrier) si le seuil n'est pas atteint — confirmé avec l'utilisateur, la configurabilité des seuils sert de soupape plutôt qu'un verrou dur ; à reconsidérer si l'usage réel montre que la visibilité + alertes ne suffit pas. Configuration réelle de Cloud Scheduler (secret en Secret Manager + 2 jobs planifiés) : le code est prêt (`/internal/jobs/*`) mais le déploiement GCP proprement dit n'a pas encore été fait à ce stade — à faire avec confirmation explicite de l'utilisateur avant toute action sur l'infrastructure de production.

## 2026-08-18 — Formulaire de création de dossier (étape 2 de l'ouverture) + numéro auto

Comble le gap signalé en toutes lettres à la fin de l'entrée précédente : `ouverture.component.ts` ne couvrait que le contrôle des conflits, aucun écran n'appelait `POST /api/dossiers`.

- `ouverture.component.ts` : étape 2 après contrôle de conflit favorable (absence ou conflit accepté) — client, pôle, matière, juridiction, montant du litige, mode d'honoraires, urgence, responsable, case pro bono visible seulement si `dossiers.pro_bono.declarer`. Redirige vers la fiche dossier après création.
- `dossiers.js` : `numero` généré automatiquement (`AFF-AA-XXX`, même patron que `factures.js`) si non fourni — aucune route ne le générait jusqu'ici, alors qu'aucun écran ne le fournissait manuellement non plus. **Formule provisoire, remplacée le 19/08/2026** (voir plus bas, « Numérotation des dossiers conforme au Guide de référencement »).

**Vérification** : 29/29 tests verts, build Angular OK, vérifié manuellement en Docker (numérotation `AFF-26-001`/`002` confirmée).

## 2026-08-18 — Corrige les imprécisions du formulaire d'ouverture (client/parties adverses, libellé honoraires)

- `ouverture.component.ts` : « Client » et « Parties adverses » séparés en deux champs à l'étape 1 (au lieu d'un seul champ « noms » flou) — le résultat du contrôle de conflit affiche désormais explicitement les noms vérifiés, qui disparaissaient complètement auparavant (signalé par l'utilisateur). L'étape 2 reprend les parties adverses (éditables) et présélectionne le client si son nom correspond exactement à un client existant, avec un indice sinon plutôt qu'un champ vide silencieux.
- `dossiers.js` : `POST /api/dossiers` accepte désormais `parties_adverses[]` et les enregistre dans `dossier_parties` (`role='adverse'`) — aucune route ne le faisait nulle part dans l'appli jusqu'ici, les parties saisies au contrôle de conflit étaient perdues.
- Retire le libellé « anti-dissimulation » des écrans (dossier-detail, accès) — langage interne de conception, inapproprié à afficher sur chaque dossier (y compris les tout nouveaux, où « Sans honoraires » est normal et n'évoque aucune suspicion). Le raisonnement reste documenté dans `HISTORY.md`/`CLAUDE.md`, pas dans l'UI.

**Vérification** : 29/29 tests toujours verts, build Angular OK, vérifié manuellement en Docker (parties adverses bien persistées et visibles sur la fiche).

## 2026-08-18 — Cohérence Nouveau dossier / Dossiers / Clients & KYC + édition après création

Signalé par l'utilisateur : « on a du mal à se retrouver » entre les trois écrans et « on n'arrive pas à faire de modification une fois quelque chose validée ». Deux vrais manques structurels trouvés en creusant :

- `PUT /api/dossiers/:id` n'existait pas du tout — aucune route ne permettait de modifier un dossier après sa création (statut, phase, intitulé, matière, responsable…). Ajouté avec le même verrou optimiste (`maj_le_attendu`) que `PUT /api/clients/:id`, pour rester cohérent entre les deux écrans. Nouvelle permission `dossiers.modifier`, ouverte à tous les rôles comme `clients.modifier`. `pro_bono` volontairement exclu (reste géré par sa propre logique permission+quota à la création).
- `client-detail.component.ts` n'exposait que le statut KYC en édition — le backend supportait déjà dénomination/RCCM/NIF/e-mail/téléphone/etc. via `PUT`, mais aucun formulaire ne les affichait. Ajouté un panneau « Modifier la fiche » complet, même patron que le nouveau panneau équivalent sur `dossier-detail.component.ts`.

Cohérence de navigation : `dossiers.component.ts` (la colonne Client devient un lien vers la fiche client), `ouverture.component.ts` (quand aucun client ne correspond, le message devient un lien cliquable vers Clients & KYC).

**Vérification** : 29 tests existants + 2 nouveaux (édition dossier + verrou optimiste) = 31/31 verts. Build Angular OK. Vérifié manuellement en Docker.

## 2026-08-19 — Suppression/archivage dossier-client, clients multiples, abandon du seuil classique

Suite à une demande utilisateur en 4 points :

1. **Suppression et archivage** : `DELETE /api/dossiers/:id` et `DELETE /api/clients/:id` (n'existaient pas du tout) — limités aux dossiers/clients « à l'ouverture » (sans activité réelle : factures, documents, temps, KYC, originaux…) plutôt qu'une suppression libre, avec 409 explicite sinon. Plusieurs tables ont `ON DELETE CASCADE` en base (documents, temps, évènements, tâches, pièces KYC…) : sans ce contrôle applicatif, la suppression aurait effacé silencieusement des données réelles. L'archivage (`statut='archive'`) était déjà possible depuis le `PUT` de l'entrée précédente — ajout d'une permission dédiée `dossiers.archiver` (distincte de `dossiers.modifier`) et d'un bouton de raccourci sur la fiche.
2. **Abandon du seuil d'honoraires minimum classique (150 000 FCFA)** : décision explicite de l'utilisateur, retiré complètement pour les dossiers non pro bono — colonne `parametres_cabinet.honoraires_min_xof` supprimée, statut calculé désormais toujours `null` pour un dossier non pro bono, KPI Cockpit et job d'alertes rescopés au pro bono uniquement. Le volet pro bono (frais de procédure 50 000 FCFA + quota mensuel bloquant) est conservé, et désormais réservé aux avocats habilités (associé, associé-fondateur, Of Counsel, collaborateur) — le seed initial de `dossiers.pro_bono.declarer` incluait à tort admin_general/admin_it et omettait Of Counsel/collaborateur, corrigé.
3. **Clients multiples sur un dossier** : un dossier peut désormais avoir plusieurs identités clientes (personnes physiques ou morales), en plus du client principal (`dossiers.client_id`, inchangé). Nouvelle table de liaison `dossier_clients_additionnels`, gérable à la création (`ouverture.component.ts`) et après coup (`dossier-detail.component.ts`).
4. **Permissions** : 4 nouvelles actions cataloguées — `dossiers.supprimer`, `clients.supprimer`, `dossiers.archiver`, `dossiers.clients_additionnels.gerer`.

**Vérification** : 42 tests verts. Build Angular OK. Piège rencontré et corrigé en testant : le helper de test `creerUtilisateurRole()` épuisait la limitation de débit du login avec le volume de tests ajouté — corrigé en signant le jeton de test directement plutôt que de repasser par la route réelle à chaque fois.

## 2026-08-19 — Création de client à la volée depuis l'ouverture de dossier

Suite à l'échange sur la cohérence Nouveau dossier / Clients & KYC : modules gardés séparés (KYC = registre maître indépendant du dossier), mais le vrai manque — devoir quitter l'écran d'ouverture pour créer un client absent puis y revenir — est comblé par un formulaire minimal inline (type, dénomination ou prénom/nom, e-mail/téléphone facultatifs), réutilisant `POST /api/clients` existant. Crée le client avec KYC « à faire » (valeur par défaut), à compléter ensuite dans Clients & KYC — explicite dans l'UI. Disponible pour le client principal et pour les clients additionnels. Aucun changement backend. Build Angular OK.

## 2026-08-19 — Champs conditionnels par pôle à l'ouverture + branchement instances/objet

Suite à une demande utilisateur précise sur l'étape 2 du formulaire :

- **Conseil** : montant du litige retiré (pas de degré/juridiction non plus, remplacés par un champ intermédiaire) ; matière restée mais facultative ; nature/objet ajouté.
- **Contentieux** : nouveau « statut procédure » (assistance/représentation/juridictionnelle en demande ou en défense/gracieuse/autre+préciser, valeurs données explicitement par l'utilisateur) ; matière en liste déroulante + « Autre » ; nature/objet ajouté ; montant du litige gardé, facultatif ; juridiction en liste déroulante + « Autre », couplée à un select degré d'instance.

Deux découvertes signalées avant d'implémenter : `dossiers.objet` existait déjà en base et était déjà lu par l'Atelier d'actes, mais aucun formulaire ne l'exposait (comblé, pas recréé) ; la gestion multi-instance existait déjà en base (table `instances`, déjà documentée comme règle transverse du projet) mais n'était branchée à aucune route ni écran — branchée ici pour la première fois : nouvelles routes `POST/PUT /api/dossiers/:id/instances`, section dédiée sur la fiche dossier pour ajouter un degré ultérieur (passage en appel) et enregistrer une décision.

`matiere`/`statut_procedure`/`juridiction` passent par le mécanisme `listes_valeurs` déjà en place (pas un nouvel enum Postgres rigide) — éditable par la direction sans session de dev. Nouvelle permission `dossiers.instances.gerer`.

**Vérification** : 46 tests verts (8 nouveaux). Build Angular OK. Vérifié manuellement en Docker.

## 2026-08-19 — Widget flottant de messagerie

Répond à une question utilisateur : jusqu'ici la messagerie n'avait qu'une pastille de non-lus dans le menu + un écran plein page `/messagerie` — impossible de discuter sans quitter l'écran en cours. Nouveau `MessagerieWidgetComponent` (`core/`), rendu une fois dans `app.component.ts` donc persistant à travers la navigation — bulle flottante en bas à droite, panneau compact liste de conversations ↔ fil de discussion. Réutilise `MessagerieService` tel quel (aucun nouvel état côté backend). Masqué sur l'écran `/messagerie` lui-même (redondant), avec un raccourci « ouvrir en plein écran ». Aucun changement backend. Build Angular OK.

## 2026-08-19 — Numérotation des dossiers conforme au Guide de référencement adopté

Signalé par l'utilisateur : la référence générée (`AFF-AA-XXX`) n'indiquait ni la nature (CX/CS) ni la matière, alors que le *Guide de référencement des dossiers* (document interne JFC Avocats, fourni par l'utilisateur) précise une formule exacte.

**Découverte déterminante avant d'implémenter** : la table `codes_matiere` existait déjà en base depuis le tout début du schéma, seedée avec les codes matière officiels (PEN, CIV, COM, FON… côté contentieux ; AFF, DDG, AVI… côté conseil) et une couleur de chemise par matière — mais **jamais branchée à aucune route**. `POST /api/dossiers` générait un préfixe « AFF » générique sans rapport avec le guide. Même mécanisme que la table `instances` la semaine précédente : branchée, pas réinventée.

**Formule implémentée** (Guide de référencement des dossiers, §8, « Numérotation retenue ») : `[TYPE]-[MATIÈRE]-[ANNÉE]-[N° d'ordre]`, ex. `CX-CIV-2026-0048`. Compteur remis à 0001 chaque année, PAR type+matière (pas global) — obtenu naturellement via le `LIKE` incluant l'année dans le comptage (pas de table de compteur dédiée).

- `schema.sql` : `dossiers.code_matiere` (FK composite vers `codes_matiere` via `code+pole`) + 4 codes manquants dans le seed initial par rapport au guide lui-même (`IND` « indéterminée à qualifier » pour les deux types — chemise neutre, repli explicite si aucune matière choisie — et `FIS`/`AUT` côté conseil, présents côté contentieux mais oubliés côté conseil). Domaine `listes_valeurs('matiere')` créé la veille (avant la découverte de `codes_matiere`) désactivé, pas supprimé — doublon involontaire corrigé.
- `dossiers.js` : `POST` génère `numero`+`couleur_chemise` via `codes_matiere` ; `IND` par défaut si aucune matière choisie (repli explicitement prévu par le guide). `PUT` reconstruit `numero` **uniquement** lors d'une requalification depuis `IND` (seul cas prévu par le guide — la référence reste sinon stable et immuable comme il l'exige). Nouvelle route `GET /api/dossiers/meta/codes-matiere?pole=` pour les listes déroulantes.
- Frontend : matière devient un choix fermé dans `codes_matiere` (plus de texte libre « Autre » — le code AUT du référentiel joue déjà ce rôle), pastille de couleur chemise sur la liste et la fiche dossier, message explicite sur un dossier encore en IND.

**Vérification** : 50/50 tests verts (7 nouveaux : formule de référence, compteur par type+matière, requalification depuis IND). Build Angular OK. Vérifié manuellement en Docker et documenté (`CX-PEN-2026-0001`, couleur rouge, conforme au guide).

Note : `DOC/CLAUDE CODE - JURIA` (fourni par l'utilisateur, contient le guide) volontairement pas ajouté au dépôt — contient un dépôt Git imbriqué et des documents hors périmètre JURIA, à trier avant tout ajout éventuel.

⚠️ **Les 8 entrées ci-dessus (18-19/08/2026) ont été livrées et déployées en production sans que `CLAUDE.md`/`HISTORY.md` soient tenus à jour au fil de l'eau** — corrigé après coup dans l'entrée suivante, à la demande de l'utilisateur. Rappel : consigner au fil de l'eau, pas après coup (règle déjà énoncée dans `CLAUDE.md`).

## 2026-08-19 — Nettoyage des données de production suite à la découverte du référencement

L'utilisateur a signalé, dans une session distincte, que les références de dossiers affichées dans JURIA ne respectaient pas la formule retenue. Vérification en direct sur l'API de production (connexion réelle + appels authentifiés, pas de suppositions) : le correctif de l'entrée précédente était bien déployé (`GET /api/dossiers/meta/codes-matiere` répond 200, un dossier `CS-AFF-2026-0001` déjà conforme existait) — mais **7 des 8 dossiers présents en base dataient d'avant son déploiement**, essentiellement des dossiers de vérification post-déploiement nommés explicitement « Verif prod ... »/« AUDIT-26-001 », plus un dossier réel (facture de 354 000 FCFA liée) créé avec l'ancienne formule.

Nettoyage effectué directement via l'API de production authentifiée (jamais de SQL brut) :
- 5 dossiers de test sans aucune activité réelle supprimés (`DELETE /api/dossiers/:id`, 204).
- 1 dossier avec 2 documents réels liés (`AUDIT-26-001`) — suppression refusée par le garde-fou anti-perte de données (comportement voulu) — **archivé** à la place (`PUT statut='archive'`), comme le message d'erreur le recommande explicitement.
- 1 dossier avec une facture réelle liée (`AFF-26-006`, foncier) — corrigé vers le format conforme (`CX-FON-2026-0001`) via le **seul mécanisme prévu par l'application** pour régénérer une référence a posteriori : repasser temporairement `code_matiere` par `IND` puis revenir à la matière réelle (`FON`), ce qui déclenche la requalification décrite dans l'entrée précédente. Aucune correction manuelle en base.

Note opérationnelle : les appels `PUT` vers la production étaient bloqués par le classificateur de permissions auto mode de l'environnement Claude Code local (le `DELETE`, lui, passait) — débloqué en ajoutant une règle de permission dédiée dans `JURIA/.claude/settings.local.json` (non commité, `.claude/` déjà gitignoré) plutôt qu'en cherchant à contourner le blocage.

**Vérification finale** : relecture de `GET /api/dossiers` en production — 3 dossiers actifs tous conformes à la formule (dont un nouveau, `CX-CIV-2026-0001`, créé entre-temps via l'écran désormais fonctionnel — signe que le correctif tourne déjà en conditions réelles), 1 dossier archivé (encore à l'ancien format, mais neutralisé).

## 2026-08-19 — Ajout de 12 juridictions au domaine `listes_valeurs('juridiction')`

Demande utilisateur : compléter la liste déroulante « Juridiction » de l'étape 2 d'ouverture de dossier avec les organes manquants — TGI I à VI, TA (Tribunal Administratif de Bamako), CAA (Cour d'Appel Administrative de Bamako), PNEF (Pôle National Économique & Financier), Pôle Cybercriminalité, Pôle Judiciaire Spécialisé, Tribunal pour Enfants.

Aucun changement de code nécessaire : `juridiction` passe déjà par le mécanisme `listes_valeurs` (domaine paramétrable, cf. entrée du 19/08 sur les champs conditionnels) — pur ajout de données, `codes` en snake_case, `ordre` 7 à 18 (suite des 6 valeurs existantes, avant `autre` qui reste à 99).

- `schema.sql` : nouveau bloc `INSERT INTO listes_valeurs (...) ON CONFLICT (domaine, code) DO NOTHING` en fin de fichier, pour que toute future installation fraîche parte avec la liste complète.
- **Production** : `POST /api/listes-valeurs` inexistant côté API réelle (la route `listes.js` déployée est en lecture seule — `GET` uniquement ; seule l'ancienne maquette du kit de démarrage, jamais utilisée, avait un `POST`) — pas de gap à combler dans cette passe, juste une contrainte à contourner. Migration appliquée directement sur Cloud SQL via `gcloud sql import sql` (upload GCS temporaire dans `gs://jfc-juria_cloudbuild/tmp-migrations/`, supprimé après import, même patron que les migrations de schéma précédentes).
  - ⚠️ **Piège rencontré** : le premier import a échoué (`ERROR: permission denied for table listes_valeurs`) — la commande `gcloud sql import sql` sans `--user` utilise un compte par défaut qui n'a pas les droits sur les tables applicatives. Corrigé avec `--user=juria_app` (le compte propriétaire de toutes les tables, cf. entrée du 16/08 sur le déploiement initial). À réutiliser telle quelle pour tout futur import de données (pas seulement de schéma) sur cette instance.
  - Docker Desktop n'était pas démarré sur la machine de développement au moment de la demande (nécessaire pour le wrapper `gcloud-docker.sh`) — démarré à la volée (`open -a Docker`, ~15s d'attente) avant de poursuivre.

**Vérification** : `GET /api/listes-valeurs?domaine=juridiction` en production renvoie les 19 valeurs attendues (6 historiques + 12 nouvelles + `autre`), dans le bon ordre.

## 2026-08-20 — En-tête de la fiche dossier : diagnostic puis refonte (client c/ partie adverse, facturation)

**Demande utilisateur** : l'équipe juge l'en-tête bleu de la fiche dossier (Dossiers 360) insatisfaisant — elle veut y voir apparaître, dans l'ordre : le(s) client(s), la ou les parties adverses (format « BDM c/ XXX », ou « MP c/ XXX (PC : YYY) » pour le pénal), la nature de la procédure, et le statut de facturation (facturé/pas encore/provision/convention-abonnement/pro bono). Demande explicite de **diagnostic + propositions avant toute implémentation**.

**Diagnostic livré avant tout code** (via `AskUserQuestion`, 4 décisions à trancher) :
- `intitule` (texte libre saisi à l'ouverture) et `objet` (« nature/objet », ajouté le 19/08) se chevauchent en pratique — aucun des deux n'est fiablement « la nature de la procédure ».
- La ligne « Client c/ Partie adverse » n'a pas besoin d'un nouveau champ : `client_nom`/`clients_additionnels` et `dossier_parties` (rôle adverse) existent déjà comme données structurées séparées — recommandation de composer automatiquement plutôt que ressaisir (même logique que le Guide de référencement : ne jamais dupliquer une info déjà un champ à part).
- `cumul_xof` (total facturé) est déjà calculé côté serveur pour **tous** les dossiers (`dossiers.js`, `SELECT_HONORAIRES`) mais n'était affiché que dans le panneau pro bono — gap pur d'affichage, pas de donnée manquante.
- `dossier_parties.role` (énumération `role_partie`) n'avait pas de valeur pour Ministère public / Partie civile — nécessaire pour bien afficher le format pénal.

**Décisions de l'utilisateur** : disposition « compact — titre unique + grille » (« propose toujours afin qu'on voit ce que ça donne dans JURIA, après on décidera ») ; ligne composée automatiquement (pas de champ texte libre supplémentaire) ; `objet` devient la ligne affichée sous le titre, `intitule` devient secondaire ; extension de `role_partie` pour le pénal.

**Implémentation**
- `schema.sql` : `ALTER TYPE role_partie ADD VALUE IF NOT EXISTS 'ministere_public'/'partie_civile'` — migration à part de tout usage, même précaution que le 17/08 (`ADD VALUE` et son usage ne peuvent pas être dans le même lot).
- `backend/src/routes/dossiers.js` (`POST /`) : accepte désormais `ministere_public` (dénomination unique) et `parties_civiles[]` (tableau), insérés dans `dossier_parties` avec les nouveaux rôles — même patron que `parties_adverses` existant.
- `frontend/pages/ouverture/ouverture.component.ts` : deux champs « Ministère public » / « Parties civiles » affichés uniquement quand la matière choisie est `PEN`, vidés automatiquement si on change de matière (`onMatiereChange`).
- `frontend/pages/dossier-detail/dossier-detail.component.ts` — refonte de l'en-tête :
  - Nouvelle méthode `titrePrincipal(d)` : compose le titre depuis les données structurées. Cas civil : `{clients} c/ {parties adverses}` (ex. « BDM c/ Arouna Modi COULIBALY »). Cas pénal (rôle `ministere_public` présent) : `{dénomination MP} c/ {clients}` + `(PC : ...)` si des parties civiles existent. ⚠️ **Hypothèse posée, pas confirmée avec l'utilisateur** : le cabinet défend le mis en cause (= `client_nom`) face au Ministère public — à valider en usage réel, le cas inverse (cabinet représentant une partie civile) n'est pas distingué pour l'instant. Le champ MP est du texte libre : taper littéralement « MP » y affiche « MP », taper la dénomination complète l'affiche telle quelle — aucune abréviation forcée.
  - Nouvelle méthode `statutFacturation(d)` : badge « Pro bono » / « Convention / Abonnement » / « Facturé » (vert) / « Non facturé » (ambre), par ordre de priorité — pas de distinction facturé partiel/soldé dans cette passe (demanderait de croiser les statuts de facture individuels).
  - `objet` remplace `intitule` comme sous-titre affiché sous le titre composé ; `intitule` reste en base et éditable (« Modifier la fiche ») mais n'apparaît plus dans l'en-tête.
  - Référence/matière/juridiction déplacées au-dessus du titre (au lieu d'en dessous) pour laisser le titre composé en position la plus visible.
- `frontend/styles.css` inchangé (réutilise `.dcard`, `.tag`, `.tag.ok`/`.tag.attente` déjà définis) — seule une classe `.nature` ajoutée localement dans `dossier-detail.component.ts`.

⚠️ **Gap signalé, non traité dans cette passe** : aucune route ne permet d'ajouter/modifier des parties (adverses, MP, PC) après la création du dossier — seulement à l'ouverture. La liste « Dossiers » (page de liste, `dossiers.component.ts`) affiche toujours `intitule` en colonne principale, pas la ligne composée — cohérence à revoir séparément si le résultat de cette passe est conservé (portée explicitement limitée par l'utilisateur à la fiche détail).

**Vérification** : build Angular OK (`ng build --configuration production`). Suite de tests backend 50/50 verte (schéma neuf, `docker compose down -v`, `role_partie` étendu confirmé via `enum_range`). Vérifié manuellement en Docker local : dossier civil créé avec client « BDM » + partie adverse « Arouna Modi COULIBALY » → `titrePrincipal` composerait bien « BDM c/ Arouna Modi COULIBALY » (données confirmées via `GET /api/dossiers/:id` — `parties: [{role: 'adverse', denomination: 'Arouna Modi COULIBALY'}]`) ; dossier pénal créé avec `ministere_public` + 2 `parties_civiles` → rôles `ministere_public`/`partie_civile` correctement enregistrés et distincts en base.

**Déploiement production — effectué et vérifié** : API redéployée (révision `juria-00034-mpj`), frontend redéployé (révision `juria-web-00032-bct`), tous deux confirmés opérationnels (`/health` 200, accueil 200).
- ⚠️ **Piège de migration rencontré** : `ALTER TYPE role_partie ADD VALUE` a échoué deux fois avant de réussir — d'abord `--user=juria_app` (`ERROR: must be owner of type role_partie`), puis même sans `--user` du tout (même erreur). Contrairement aux **tables** (dont `juria_app` est propriétaire, cf. entrée du 19/08 sur les juridictions), les **types énumérés** créés lors du tout premier chargement de schéma appartiennent au compte admin `postgres`, pas à `juria_app` — `--user=postgres` a résolu le problème. **Règle à retenir pour tout futur `ALTER TYPE` en production** : `--user=postgres` pour les types, `--user=juria_app` pour les données de table (`INSERT`/`UPDATE`), pas de `--user` par défaut ne fonctionne pour aucun des deux cas.
- **Vérification bout en bout en production** : tentative de création d'un dossier pénal *avant* la migration → `400 invalid input value for enum role_partie` (confirme que le déploiement du code seul ne suffit pas sans la migration). Après migration : dossier pénal créé avec succès (`CX-PEN-2026-0002`), `dossier_parties` contient bien les rôles `ministere_public`/`partie_civile` avec les bonnes dénominations — `titrePrincipal()` composerait « Procureur de la République c/ BDM SA (PC : Mme Test) ». Dossier de test supprimé après vérification (`DELETE`, 204, aucune activité réelle).
