# JURIA — Contexte du projet

> **Ce fichier est volontairement court (limite de 150 000 caractères).** Le détail chronologique de tout ce qui a été construit se trouve dans `HISTORY.md`. La version complète de l'ancien `CLAUDE.md` (état au 16/10/2026, ~486 000 caractères) est conservée dans `DOC/CLAUDE_archive_16.10.2026.md` — la lire seulement pour retrouver un détail précis (grep), jamais en entier.

## Description
JURIA est une application de gestion de cabinet d'avocats développée pour **JFC Avocats Mali** (droit OHADA) : dossiers, clients/KYC, procédure et échéances, facturation, administratif/RH, assistant IA.
Dépôt GitHub : https://github.com/momodaou/juria.git — branche `main`.
Spécification initiale : démo HTML (`JURIA demo - MAJ 09.08.2026.html`), retranscrite dans `DOC/JURIA - Dossier de Specifications Fonctionnelles - MAJ 16.08.2026.docx`.

### Modules (17 + messagerie)
Tableau de bord (ex-Cockpit) · Dossiers 360 · Nouveau dossier (ouverture + contrôle de conflits) · Clients & KYC · Échéances (ex-Échéancier) · Rôle d'audience · Registre du courrier · Atelier d'actes · Bibliothèque · Tâches (ex-Plan d'action, route `/plan-action`) · Chrono & Facturation · Dépenses & caisse · Rétrocessions · Accès & permissions · Administratif & RH (ex-Cabinet RH) · Assistant IA · Portail client (simple aperçu côté cabinet, pas un vrai extranet) · Messagerie instantanée interne (module 18).
Les renommages sont des renommages d'**affichage** : routes et noms de fichiers techniques inchangés.

### Rôles (13 statuts réels)
`associe`, `associe_fondateur` (chairman — mêmes droits qu'un associé SAUF la matrice de permissions et le module Accès & permissions), `of_counsel` (profil volontairement restreint), `collaborateur` (avocat), `avocat_stagiaire`, `stagiaire` (non-avocat), `juriste` (collaborateur non-avocat), `admin_general` (volontairement sans droits de décision : congés, dépenses, conflits, bulletins), `assistante`, `comptable`, `assistant_comptable`, `admin_it`, `archiviste`. Plus Client (portail, sans authentification séparée).
Permissions : table `permissions_role` + catalogue statique `backend/src/permissions.js` + middleware `requirePermission(code)`. Modifiables dans la Matrice (écran Accès & permissions, réservé associé + admin_it). Le module Accès & permissions lui-même reste verrouillé en dur (`requireRole`) pour éviter tout auto-verrouillage.

### Règles métier transverses
- Export Excel/CSV + impression PDF (en-tête cabinet) sur chaque écran (composant générique `export-print`)
- Alertes de délai : J-7 rouge / J-15 orange / au-delà bleu
- Multi-instance (1re instance / appel / cassation-CCJA) sous une référence de dossier unique
- FCFA devise pivot, EUR à 655,957 fixe, autres devises au taux du jour verrouillé à l'émission
- Échéances fiscales/sociales maliennes pré-paramétrées (TVA, INPS, ITS, IS, patente, Ordre, RC pro)
- Référence dossier : `[CS|CX]-[MATIÈRE]-[ANNÉE]-[N°]` (ex. `CX-CIV-2026-0048`), code `IND` si matière non qualifiée
- Rétrocessions réservées aux avocats : associé 30 % / collaborateur-stagiaire-Of Counsel 25 % ; règle « tout ou rien » (rien tant que la facture n'est pas intégralement encaissée) ; aucune rétrocession sur les dossiers d'un client sous convention-cadre (abonnement)
- Pro bono : quota mensuel par responsable (2 par défaut), responsable obligatoirement associé

## Structure du dépôt
- `APP/` code (backend Node, frontend Angular, db, scripts, monitoring) · `DOC/` documentation (`DOC/CLAUDE CODE - JURIA/` = maquettes, chartes, registres, **non versionné**) · `CLAUDE.md` ce fichier · `HISTORY.md` journal chronologique détaillé.

## Stack technique
- **Frontend** : Angular 22 (standalone, signals, `@if`/`@for`), TypeScript, `APP/frontend/`. Aperçu de fichiers côté client (`mammoth`, `xlsx` depuis le CDN SheetJS, pas npm). `qrcode` pour les étiquettes.
- **Backend** : Node.js/Express en **JavaScript**, JWT (`jsonwebtoken` + `bcryptjs`), `multer` pour les uploads, `@google-cloud/storage` pour la GED, `pdfkit` pour les PDF (factures, actes, rôle), `nodemailer` via `backend/src/mailer.js` (SMTP Infomaniak).
- **Base** : PostgreSQL 15, SQL écrit à la main (`APP/db/schema.sql`, aucun ORM), client `pg`.
- **Prod** : GCP projet `jfc-juria`, région `europe-west1` — Cloud Run (services `juria` = API, `juria-web` = frontend), Cloud SQL `juria-pg`, bucket GCS privé `jfc-juria-ged`, Secret Manager, Cloud Scheduler. Domaine cible `juria.jfcavocats-mali.com` (variable `FRONTEND_URL` posée sur le service API pour les liens des e-mails).
- **IA** : Gemini/Vertex AI prévu (`backend/src/ia.js`), toujours avec garde-fou « projet à valider ».
- **Dev local** : Docker uniquement (pas de Node sur la machine) — voir `APP/README.md`. Tests : Jest + Supertest dans `backend/tests/` (lancement documenté dans `APP/README.md`, base neuve, conteneur `node:22` ; ne pas lancer via l'image `api` de prod qui fixe `NODE_ENV=production`). Vérifs visuelles : Playwright headless via Docker (`--host-resolver-rules=MAP localhost <IP hôte>` pour garder l'origine `localhost` côté CORS ; ne pas utiliser `waitUntil:'networkidle'`, le flux SSE de la messagerie ne se termine jamais).

## Déploiement (commandes pour l'utilisateur — le classificateur de permissions les bloque pour Claude, il les lance via `!`)
- `./scripts/deploy.sh api | web | both | migration <fichier> [utilisateur]` — `gcloud` se pilote via `scripts/gcloud-docker.sh` (aucun outil GCP sur l'hôte). Le conteneur ne monte que le dépôt : un fichier de migration doit être copié dans le dépôt le temps de l'opération puis supprimé, jamais committé.
- Toujours demander l'accord explicite de l'utilisateur avant de déployer ou de toucher à l'infrastructure de production.
- Après déploiement : vérifier `/health` (API) et `/` (frontend) en `200`, et consigner révisions + vérifications dans `HISTORY.md`.

## Conventions
- Code backend/DB en français fonctionnel (`dossiers`, `utilisateurs`, `mot_de_passe`…), cohérent avec le kit d'origine.
- Toute décision structurante est consignée dans `HISTORY.md` **au fil de l'eau**, pas après coup ; garder ce fichier court (résumé + règles), le détail va dans `HISTORY.md`.
- Répondre à l'utilisateur **en français**.

## Pièges techniques récurrents (à vérifier systématiquement)
1. **Pas de zone.js** : après un `.subscribe`, ne jamais muter une propriété d'un objet issu d'un signal — réécrire le signal (`.set()`/`.update()`). Un `computed()` ne se réévalue que si un **signal** change (pas une propriété modifiée par `[(ngModel)]`).
2. **SQL brut** : `COALESCE($n,'litteral')` ou `CASE WHEN $n=…` sur une colonne ENUM ou UUID → caster (`$n::mon_enum`, `$n::uuid`). Chaque `$n` du tableau de paramètres doit apparaître dans la requête (sinon « could not determine data type of parameter »).
3. **Templates Angular** : une apostrophe échappée dans une interpolation (`'l\'achat'`) casse le parseur sans erreur de build → utiliser des guillemets doubles ou une méthode TS. Un **backtick** dans un commentaire à l'intérieur d'un template literal (`styles`, `template`, SQL en `` ` ``) casse la compilation → vérifier le solde de backticks.
4. **Migrations Cloud SQL** (`gcloud sql import sql`) : le script s'exécute dans **une seule transaction** côté serveur. (a) `ALTER TYPE … ADD VALUE` ne peut pas être utilisé dans le même import → 2 imports séquentiels. (b) Une erreur n'importe où annule **tout** (y compris le début) → revérifier par une lecture applicative après un import qui a suivi un échec. (c) `--user=juria_app` est parfois refusé (« must be owner of table ») → réessayer avec `--user=postgres` (défaut du script). Rendre les migrations idempotentes (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
5. **Un déploiement ne rétroagit pas** sur une action passée : avant d'affirmer qu'un comportement déployé s'est appliqué à un événement antérieur, comparer l'heure de l'événement à l'heure de création de la révision (`gcloud run revisions list`).
6. Un composant `<button>` n'hérite pas la couleur de son parent (`color:inherit`) ; un enfant flex a besoin de `min-width:0` (ellipse) / `min-height:0` (défilement) ; `position:sticky` ne marche pas sur une cellule à `colspan` ni sans conteneur à hauteur bornée ; `position:absolute` d'un menu est coupé par un ancêtre en `overflow` → utiliser `position:fixed` (cf. `core/menu-actions.component.ts`).
7. Les nouveaux endpoints de **consultation** doivent être gardés par une permission adaptée à la sensibilité de la donnée (plusieurs fuites ont été trouvées par audit : congés, taux horaires, courriers par id, rétrocessions). Les lignes de données personnelles (rétrocessions, bulletins, congés) : chacun voit toujours les siennes, voir celles des autres exige une permission.
8. Tout bouton/panneau lié à une action du catalogue doit être masqué côté écran avec `auth.peut('code')` (pas seulement refusé en 403 au clic).
9. Les valeurs d'ENUM devenues obsolètes ne sont **jamais supprimées** (historique) mais plus utilisées par le code.

## Règles de conduite à respecter (décisions explicites de l'utilisateur)
- **CI/CD : abandonné** (17/08/2026). Ne pas relancer ce chantier sans demande explicite.
- **JURIA n'est pas responsive sur mobile** (menu latéral fixe 220 px) : mis de côté. Ne pas s'y attaquer sans demande explicite.
- **Cloud Scheduler en PAUSE — ne rien relancer sans autorisation écrite de l'utilisateur** (`gcloud scheduler jobs resume <nom> --project=jfc-juria --location=europe-west1`) : `juria-alertes-abonnements`, `juria-alertes-taches-retard`, `juria-alertes-doublons`. Il veut « nettoyer JURIA avant ». Les jobs actifs : `juria-alertes-delais`, `juria-alertes-honoraires` (aucun e-mail réel : indicateurs/notifications internes), `juria-alertes-facturation-discipline`, `juria-alertes-retours-manquants`, `juria-messagerie-notifications`.
- **Associé-fondateur suspendu** de deux volets : décision de conflit d'intérêts (`conflits.decision` = FALSE) et notification de création de dossier. Ne pas le réactiver sans demande explicite.
- **Réserve doublons** : pas de justification obligatoire à « Créer quand même », pas de correspondance floue, pas de couverture doublon pour tâches/courriers/documents/actes/bibliothèque/factures/événements — ne pas relancer sans demande.
- **Petite caisse — règle « engageur ≠ valideur »** (validation après coup par un autre associé) : tout assouplissement est **en réserve** (17/10/2026) — ne pas proposer d'exception sans demande explicite.
- **Rétrocessions** : `non_avocat` reste dans l'ENUM pour l'historique mais est refusé pour toute nouvelle rétrocession.
- **Of Counsel** garde un profil restreint (exception explicite) ; ajustable au cas par cas dans la Matrice.
- Les jetons, mots de passe temporaires et identifiants réels ne doivent jamais être committés (`DOC/CLAUDE CODE - JURIA/JURIA - Registre des identifiants - MAJ 04.09.2026.md` est volontairement hors Git).

## État de la production (au 15/10/2026)
- Frontend : https://juria-web-552099340909.europe-west1.run.app — API : https://juria-552099340909.europe-west1.run.app
- Dernières révisions : API `juria-00157-bdp`, frontend `juria-web-00206-k9k`. Tests backend : **601/601**.
- Comptes de service dédiés : `juria-api-sa`, `juria-web-sa`. Sauvegardes Cloud SQL quotidiennes + récupération à l'instant T. CORS restreint (`ALLOWED_ORIGINS`), helmet, limitation de débit sur `/auth`, filtrage de type sur les téléversements, GED sur GCS (`GED_BUCKET=jfc-juria-ged`), supervision e-mail (canal vérifié).
- **`APP/db/schema.sql` est la source du schéma, mais la production fait foi pour les permissions** : la matrice a été modifiée à la main en prod ; le bloc final « ALIGNEMENT DE LA MATRICE DE PERMISSIONS SUR LA PRODUCTION » (25/09/2026) en est la photographie. Toute case modifiée dans la Matrice doit être reportée dans ce bloc, et toute nouvelle action cataloguée doit y être ajoutée pour les 13 rôles.
- Documents de référence (hors Git, dans `DOC/CLAUDE CODE - JURIA/`) : registre des notifications par e-mail, registre des identifiants, chartes graphiques et supports physiques, maquettes des 4 chemises à rabat (étiquette JURIA 100×60 mm sur page A4 ; 4 couleurs : bleu, doré, rouge, vert).
- Fonctions notables à connaître (détail dans `HISTORY.md` et l'archive) : lettre de mission auto-générée à l'ouverture ; discipline de facturation (statuts « en attente »/« toujours pas facturé » + alertes) ; convention-cadre (abonnement) portée par le **client** ; vignettes de plaidoirie ancrées sur l'instance ; journal d'audit procédural + bandeaux « Créé par / Dernière modification » ; délégations d'accès réellement effectives ; contrôle de conflits asynchrone (registre `/conflits`) ; messagerie type WhatsApp (LISTEN/NOTIFY + SSE) ; rôle d'audience (retours, renvois chaînés, diffusion e-mail avec PDF) ; registre du courrier (viser, expédier, numérisation, dépôt temporaire avant dossier).

## Notes pour les futures sessions Claude
- Avant toute action structurante, consigner l'entrée dans `HISTORY.md`.
- Tenir ce fichier à jour **en le gardant court** : ajouter une ligne de résumé ici, le détail dans `HISTORY.md`. Si ce fichier dépasse ~100 000 caractères, le réduire à nouveau.
