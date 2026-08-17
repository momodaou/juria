// JURIA — utilitaires partagés pour les tests d'intégration.
// Nécessite une base PostgreSQL accessible (voir APP/README.md pour la
// commande d'exécution des tests).
const bcrypt = require("bcryptjs");
const { pool } = require("../src/db");

const EMAIL_TEST = "test.regression@jfcavocats-mali.com";
const MDP_TEST = "TestRegression123!";

// Crée (ou met à jour) un utilisateur de test actif et validé, idempotent
// d'un run à l'autre grâce à ON CONFLICT.
async function assurerUtilisateurTest() {
  const hash = await bcrypt.hash(MDP_TEST, 10);
  await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ('TREG','Test','Régression',$1,$2,'associe',TRUE,now())
     ON CONFLICT (email) DO UPDATE SET mot_de_passe = EXCLUDED.mot_de_passe, actif = TRUE, valide_le = now()`,
    [EMAIL_TEST, hash]
  );
}

module.exports = { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool };
