// JURIA — point d'entrée de l'API (Node.js + Express)
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { authenticate } = require("./src/auth");

const app = express();
app.use(cors());
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

// 404 par défaut
app.use((req, res) => res.status(404).json({ error: "Ressource introuvable" }));

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
app.listen(port, () => console.log(`JURIA API démarrée sur le port ${port}`));

module.exports = app;
