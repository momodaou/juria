// JURIA — 19/11/2026 : nature « Frais de notaire » (débours : jamais sur la petite caisse, dans le catalogue de la caisse frais de justice).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { estDebours, CATALOGUE_PROCEDURE, CATALOGUE_PETITE_CAISSE, libelleCategorie } = require("../src/categoriesDepense");

let token, uid;
const auth = () => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => {
  await assurerUtilisateurTest();
  const l = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = l.body.token; uid = l.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

describe("Frais de notaire", () => {
  test("catalogue : débours, caisse frais de justice, pas la petite caisse", () => {
    expect(estDebours("frais_notaire")).toBe(true);
    expect(CATALOGUE_PROCEDURE).toContain("frais_notaire");
    expect(CATALOGUE_PETITE_CAISSE).not.toContain("frais_notaire");
    expect(libelleCategorie("frais_notaire")).toBe("Frais de notaire");
  });
  test("dépense de dossier en frais de notaire acceptée ; refusée sur la petite caisse", async () => {
    const cl = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client notaire ${Date.now()}` });
    const d = await request(app).post("/api/dossiers").set(auth()).send({
      numero: `NOT-${Date.now()}`, client_id: cl.body.id, intitule: "Cession de parts", pole: "conseil", responsable_id: uid, mode_honoraires: "forfait" });
    expect(d.status).toBe(201);
    const ok = await request(app).post("/api/depenses").set(auth()).send({
      type: "ponctuelle", categorie: "frais_notaire", libelle: "Acte de cession, Me X", montant: 150000, nature: "dossier", dossier_id: d.body.id });
    expect(ok.status).toBe(201);
    expect(ok.body.categorie).toBe("frais_notaire");
    const refus = await request(app).post("/api/depenses").set(auth()).send({
      type: "ponctuelle", categorie: "frais_notaire", libelle: "Acte", montant: 1000, petite_caisse: true });
    expect(refus.status).toBe(409);
  });
});
