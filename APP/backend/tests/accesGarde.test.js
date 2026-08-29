// JURIA — garde du module Accès & permissions (29/08/2026).
// Correction explicite de l'utilisateur : l'associé-fondateur avait mêmes
// droits qu'un associé classique sauf la Matrice (décision du 17/08/2026)
// — resserré le 29/08/2026 pour exclure le module Accès & permissions dans
// son ensemble (comptes, délégations, journal d'audit), pas seulement la
// Matrice qui l'était déjà.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { pool } = require("./setup");

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestAcces123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Acces',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`A${suffixe.slice(0, 7)}`, `test.acces.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return jwt.sign({ sub: rows[0].id, role, nom: "Test Acces" }, SECRET, { expiresIn: "1h" });
}

afterAll(async () => {
  await pool.end();
});

describe("Garde du module Accès & permissions — associe_fondateur exclu (29/08/2026)", () => {
  test.each(["associe", "admin_general", "admin_it"])("%s : accès autorisé (200)", async (role) => {
    const token = await creerUtilisateurRole(role);
    const res = await request(app).get("/api/acces/audit").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test("associe_fondateur : accès refusé (403) — module entier, pas seulement la matrice", async () => {
    const token = await creerUtilisateurRole("associe_fondateur");
    const audit = await request(app).get("/api/acces/audit").set("Authorization", `Bearer ${token}`);
    expect(audit.status).toBe(403);
    const delegations = await request(app).get("/api/acces/delegations").set("Authorization", `Bearer ${token}`);
    expect(delegations.status).toBe(403);
  });
});
