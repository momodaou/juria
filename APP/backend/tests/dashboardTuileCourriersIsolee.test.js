// JURIA — 05/11/2026 : une erreur sur la tuile « Courriers départ » ne doit jamais casser le Tableau de bord en entier
// (incident du 05/11/2026 : migration non appliquée en production → colonne absente → /api/dashboard en 500).
const request = require("supertest");
const app = require("../server");
const redaction = require("../src/courrier/redaction");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});
afterAll(async () => { jest.restoreAllMocks(); await pool.end(); });

describe("Tableau de bord : tuile Courriers départ isolée", () => {
  test("tuile normale quand tout va bien", async () => {
    const r = await request(app).get("/api/dashboard").set("Authorization", "Bearer " + token);
    expect(r.status).toBe(200);
    expect(r.body.courriers_depart).toMatchObject({ a_signer_n: expect.any(Number), brouillons_n: expect.any(Number) });
  });

  test("erreur sur la tuile : le tableau de bord se charge quand même, sans la tuile", async () => {
    jest.spyOn(redaction, "resume").mockRejectedValue(new Error('column c.etat_redaction does not exist'));
    jest.spyOn(console, "error").mockImplementation(() => {});
    const r = await request(app).get("/api/dashboard").set("Authorization", "Bearer " + token);
    expect(r.status).toBe(200);
    expect(r.body.courriers_depart).toBeNull();
    expect(Object.keys(r.body).length).toBeGreaterThan(10);   // le reste du tableau de bord est bien là
  });
});
