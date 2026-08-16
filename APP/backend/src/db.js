// JURIA — connexion PostgreSQL (pool partagé)
// En local : variables du fichier .env. En production (Cloud Run + Cloud SQL) :
// DB_HOST = /cloudsql/PROJET:REGION:INSTANCE (socket Unix), fourni par le déploiement.
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "juria_app",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "juria",
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 5432,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => console.error("Erreur pool PostgreSQL :", err.message));

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
