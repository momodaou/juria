// JURIA — point d'entrée de l'API (Node.js + Express)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { authenticate } = require("./src/auth");

// Origines autorisées : liste séparée par des virgules dans ALLOWED_ORIGINS
// (ex. le domaine personnalisé une fois mappé), avec un repli sur les
// origines connues (frontend Cloud Run + dev local Angular/Docker).
const ORIGINES_AUTORISEES = (
  process.env.ALLOWED_ORIGINS ||
  "https://juria-web-552099340909.europe-west1.run.app,http://localhost:4200"
).split(",").map((o) => o.trim());

const app = express();
// Cloud Run place l'app derrière le proxy front-end de Google : sans ce
// réglage, req.ip renvoie l'IP du proxy pour toutes les requêtes, ce qui
// ferait retomber la limitation de débit ci-dessous sur un seul « client »
// partagé par tout le monde au lieu d'une limite par IP réelle.
app.set("trust proxy", 1);
// CSP désactivée (API JSON pure, ne sert aucune page HTML — sans objet ici) ;
// Cross-Origin-Resource-Policy assoupli en "cross-origin" car le frontend
// (juria-web-*.run.app) et l'API (juria-*.run.app) sont deux origines
// distinctes et le frontend télécharge des fichiers (GED, KYC, bibliothèque)
// directement depuis l'API.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(cors({ origin: ORIGINES_AUTORISEES }));
app.use(express.json({ limit: "2mb" }));

// Santé (utilisé par Cloud Run pour vérifier que le service répond)
app.get("/health", (req, res) => res.json({ status: "ok", service: "juria-api" }));

// Authentification (public)
app.use("/auth", require("./src/routes/auth"));

// Modules métier (protégés par jeton)
app.use("/api/dossiers", authenticate, require("./src/routes/dossiers"));
app.use("/api/clients", authenticate, require("./src/routes/clients"));
app.use("/api/conflict-checks", authenticate, require("./src/routes/conflicts"));
app.use("/api/documents", authenticate, require("./src/routes/documents"));
app.use("/api/temps", authenticate, require("./src/routes/temps"));
app.use("/api/factures", authenticate, require("./src/routes/factures"));
app.use("/api/evenements", authenticate, require("./src/routes/evenements"));
app.use("/api/taches", authenticate, require("./src/routes/taches"));
app.use("/api/ia", authenticate, require("./src/routes/ia"));
app.use("/api/dashboard", authenticate, require("./src/routes/dashboard"));
app.use("/api/communications", authenticate, require("./src/routes/communications"));
app.use("/api/originaux", authenticate, require("./src/routes/originaux"));
app.use("/api/listes-valeurs", authenticate, require("./src/routes/listes"));
app.use("/api/roles-audience", authenticate, require("./src/routes/audiences"));
app.use("/api/courriers", authenticate, require("./src/routes/courriers"));
app.use("/api/actes", authenticate, require("./src/routes/actes"));
app.use("/api/biblio", authenticate, require("./src/routes/biblio"));
app.use("/api/utilisateurs", authenticate, require("./src/routes/utilisateurs"));
app.use("/api/depenses", authenticate, require("./src/routes/depenses"));
app.use("/api/retrocessions", authenticate, require("./src/routes/retrocessions"));
app.use("/api/acces", authenticate, require("./src/routes/acces"));
app.use("/api/profil", authenticate, require("./src/routes/profil"));
app.use("/api/cabinet", authenticate, require("./src/routes/cabinet"));

// 404 par défaut
app.use((req, res) => res.status(404).json({ error: "Ressource introuvable" }));

// Gestion centralisée des erreurs non interceptées par une route (ex. rejet
// d'un fichier par uploadFilter) : réponse JSON propre plutôt que la page
// HTML d'erreur par défaut d'Express.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || "Requête invalide" });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => console.log(`JURIA API démarrée sur le port ${port}`));

module.exports = app;
