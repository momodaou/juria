# JURIA — Application (APP/)

Application de gestion de cabinet d'avocats pour **JFC AVOCATS MALI** (droit OHADA).
Voir `/CLAUDE.md` (racine du dépôt) pour le contexte projet complet et `/DOC/` pour les spécifications fonctionnelles.

> Pile : **Angular 22** (front) · **API Node.js/Express** (back) · **PostgreSQL 15** (base) · **Google Cloud** (hébergement : Cloud Run, Cloud SQL, Cloud Storage, Secret Manager).

---

## 1. Structure

```
APP/
├── README.md                 ← ce guide
├── .env.example               ← modèle de variables d'environnement (backend)
├── docker-compose.yml         ← PostgreSQL + API pour le développement local
├── Dockerfile                 ← image de l'API (pour Cloud Run)
├── db/
│   ├── schema.sql              ← schéma complet de la base
│   └── seed_utilisateurs.sql   ← jeu de données de démarrage (utilisateurs)
├── backend/
│   ├── package.json
│   ├── server.js               ← point d'entrée de l'API
│   └── src/
│       ├── db.js                ← connexion PostgreSQL
│       ├── auth.js              ← jetons (JWT) et contrôle des rôles
│       ├── ia.js                ← intégration Assistant IA
│       ├── storage.js           ← GED (Cloud Storage)
│       └── routes/
│           ├── auth.js              ← POST /auth/login
│           ├── dossiers.js          ← /api/dossiers
│           ├── clients.js           ← /api/clients + /conflict-check
│           ├── dashboard.js         ← /api/dashboard (Cockpit)
│           ├── communications.js    ← /api/communications (fil du dossier)
│           ├── documents.js         ← /api/documents (GED)
│           ├── evenements.js        ← /api/evenements (délais/échéancier)
│           ├── taches.js            ← /api/taches (plan d'action)
│           ├── temps.js             ← /api/temps (chrono)
│           ├── factures.js          ← /api/factures (facturation)
│           └── ia.js                ← /api/ia (assistant)
└── frontend/                  ← projet Angular 22 complet (scaffoldé via Angular CLI + socle du kit)
    └── src/app/
        ├── app.component.ts    ← coquille (menu latéral)
        ├── app.routes.ts       ← routes + guard d'authentification
        ├── core/                ← auth.service, auth.guard, auth.interceptor, api.service
        └── pages/               ← login, cockpit, dossiers, dossier-detail, ouverture, echeancier, facturation
```

Le dépôt ne contient **aucun** `node_modules/` ni fichier `.env` (voir `.gitignore` racine) — Node.js n'étant pas installé sur la machine de développement actuelle, tout le développement/build passe par **Docker**.

---

## 2. Démarrage rapide (local, avec Docker)

### Backend + base de données

```bash
cd APP
docker compose up --build
```

Lance PostgreSQL (schéma chargé automatiquement) puis l'API sur http://localhost:8080.
Vérification : `curl http://localhost:8080/health` → `{"status":"ok","service":"juria-api"}`.

### Frontend (Angular)

Aucun conteneur dédié encore défini pour le dev du front — à lancer via une image Node :

```bash
cd APP/frontend
docker run --rm -it -v "$(pwd)":/workspace -w /workspace -p 4200:4200 node:22 \
  bash -c "npm install && npm start -- --host 0.0.0.0"
```

Puis ouvrir http://localhost:4200 (le front pointe vers l'API sur `http://localhost:8080`, voir `src/environments/environment.ts`).

### Créer un premier utilisateur de test

```bash
# Depuis le conteneur api en cours d'exécution :
docker exec app-api-1 node -e "console.log(require('bcryptjs').hashSync('MotDePasseFort!', 10))"
# copier le hash, puis :
docker exec app-db-1 psql -U juria_app -d juria -c "INSERT INTO utilisateurs (code,prenom,nom,email,mot_de_passe,role) \
  VALUES ('MDA','Me','Daou','associe@jfcavocats-mali.com','<HASH>','associe');"
```

Connexion :
```bash
curl -X POST http://localhost:8080/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"associe@jfcavocats-mali.com","mot_de_passe":"MotDePasseFort!"}'
```
La réponse contient un `token` à envoyer dans l'en-tête `Authorization: Bearer <token>` pour appeler `/api/...`.

**Statut vérifié (16/08/2026)** : build Angular OK, `docker compose up` OK, schéma chargé (36 tables), login + `/api/dashboard` + `/api/dossiers` testés avec succès.

---

## 3. API disponible

| Méthode | Route | Rôle |
|--------|-------|------|
| POST | `/auth/login` | Connexion, renvoie un jeton |
| GET | `/api/dashboard` | Indicateurs du Cockpit |
| GET/POST | `/api/dossiers` | Lister / créer un dossier |
| GET | `/api/dossiers/:id` | Détail d'un dossier |
| GET/POST | `/api/clients` | Lister (recherche + filtre KYC) / créer un client |
| GET/PUT | `/api/clients/:id` | Fiche 360° (pièces KYC, dossiers, originaux, liens) / mise à jour |
| GET/POST/DELETE | `/api/clients/:id/kyc-pieces` | Pièces KYC (upload, liste, suppression) |
| GET | `/api/clients/kyc/alertes?jours=` | Pièces KYC expirées ou expirant sous N jours |
| POST | `/api/conflict-checks` | Contrôle des conflits d'intérêts (+ `/:id/decision`) |
| GET/POST | `/api/originaux` | Registre des originaux confiés (+ `/:id/restituer`) |
| GET | `/api/listes-valeurs?domaine=` | Nomenclatures paramétrables |
| GET/POST | `/api/roles-audience` | Rôle d'audience de la semaine (+ `/lignes`, `/:id/valider`, `/:id/diffuser`, `/motifs-renvoi`, `/audiences/:id/retour`) |
| GET/POST/PUT | `/api/courriers` | Registre du courrier (+ `/:id/statut`) — déclenchement auto d'événements/diligences/tâches |
| GET | `/api/actes/modeles` | Modèles d'actes disponibles |
| POST | `/api/actes/generer` | Génère un acte (modèle ou IA), enregistré dans la GED |
| GET/POST/DELETE | `/api/biblio` | Bibliothèque (jurisprudence, textes, veille, modèles, consultations, checklists) + `/:id/fichier` |
| GET/POST/PUT | `/api/taches` | Plan d'action (kanban) — `/:id` (statut), `/:id/valider` |
| GET | `/api/utilisateurs?actif=` | Annuaire interne (sélecteurs de responsable) |
| GET/POST | `/api/depenses` | Dépenses (circuit soumise/validée/décaissée) — `/:id/decision`, `/:id/decaisser`, `/comptes`, `/petite-caisse`, `/vignettes` |
| GET/POST | `/api/retrocessions` | Rétrocessions d'honoraires — `/qualites`, `/:id/decaisser` (règle tout ou rien), `/pro-bono` |
| PUT/GET/POST | `/api/acces` | Accès & permissions (associé/admin uniquement) — `/utilisateurs` (création de compte), `/utilisateurs/:id/valider` (validation à l'entrée), `/utilisateurs/:id/reinitialiser-mot-de-passe`, `/utilisateurs/:id/role`, `/utilisateurs/:id/actif`, `/delegations`, `/audit` |
| GET/PUT | `/api/profil` | Profil personnel (tout utilisateur authentifié) — `/mot-de-passe` pour changer son propre mot de passe |
| GET/POST | `/api/cabinet` | Cabinet RH — `/equipe`, `/echeances`, `/conges`, `/presences`, `/bulletins` |
| POST | `/api/ia/resume`, `/chronologie`, `/extraction-faits`, `/analyse-contrat`, `/traduction`, `/comparaison` | Assistant IA (6 capacités, toujours « projet à valider ») |
| GET/POST | `/api/communications` | Fil du dossier (journal des échanges) |
| GET/POST | `/api/documents`, `/api/evenements`, `/api/temps`, `/api/factures` | Présentes dans le code, **non auditées de bout en bout** cette session — vérifier le pattern de typage enum/UUID (cf. `CLAUDE.md`) avant usage en production |

Toutes les routes `/api/*` exigent un jeton valide.

---

## 4. Déploiement Google Cloud

Le script `JURIA deploiement gcp - MAJ 01.08.2026.sh` (dans le dossier Documentations utilisateur, à intégrer/adapter dans ce dépôt) crée le projet, la base **Cloud SQL**, le bucket **Cloud Storage** (GED), les secrets, puis déploie l'API sur **Cloud Run**.

---

## 5. Les 17 modules de la spécification fonctionnelle — statut

**Tous développés** (backend + écran Angular) : Cockpit, Dossiers 360, Nouveau dossier (conflits), Clients & KYC, Échéancier, Rôle d'audience, Registre du courrier, Atelier d'actes, Bibliothèque, Plan d'action, Chrono & Facturation, Dépenses & caisse, Rétrocessions, Accès & permissions, Cabinet (RH), Assistant IA, Portail client.

**Deux limitations assumées, pas des oublis** :
- **Portail client** est un écran d'**aperçu côté cabinet** (recherche un dossier, affiche ce qu'un client verrait), pas un vrai extranet avec compte client séparé — le schéma SQL lui-même classe ce module en extension post-MVP (voir commentaire de fin de `db/schema.sql`). Un vrai portail demande un système d'authentification distinct, à traiter comme projet à part.
- **Journal d'audit** (`journal_audit`) n'est alimenté que par la connexion et les actions du module Accès & permissions — pas par le reste de l'application (retrofit complet non fait).

**Non auditées de bout en bout** : `temps.js`, `evenements.js`, `communications.js`, `documents.js`, `dashboard.js` (fournies par le kit, jamais testées dans cette session). Voir la note sur le bug de typage enum/UUID récurrent dans `CLAUDE.md` avant de les utiliser en production.

## 6. Prochaines étapes

1. Auditer et tester les routes listées ci-dessus comme « non auditées » (même pattern de bug à vérifier systématiquement).
2. Étendre le journal d'audit au reste de l'application si la traçabilité complète est requise.
3. Décider si un vrai portail client (auth séparée, messagerie) est prioritaire, et le traiter comme un projet dédié.
4. Ajouter les tests automatisés (backend et frontend) et la validation des entrées.
5. Ajouter un service `frontend` à `docker-compose.yml` pour le dev local (actuellement lancé à la main, voir § 2).
6. Mettre en place les environnements **recette** et **production** sur GCP, un domaine personnalisé, et restreindre CORS (actuellement ouvert à tous les domaines).

> Sécurité : ne jamais committer de fichier `.env` ni de secret. Utiliser Secret Manager en production.
