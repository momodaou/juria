// JURIA — 18/11/2026 : suspension des seuls e-mails de conflit (durée en heures), sans toucher à la création de dossier.
const request = require("supertest");
const app = require("../server");
const { pool } = require("../src/db");
const { envoiSuspendu, etatSuspension } = require("../src/suspensionEmails");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest } = require("./setup");

let tok;
beforeAll(async () => {
  await assurerUtilisateurTest();
  tok = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
});
afterAll(async () => {
  await pool.query("UPDATE parametres_cabinet SET emails_dossiers_suspendus_jusqu_a = NULL, emails_conflits_suspendus_jusqu_a = NULL WHERE id = 1");
  await pool.end();
});
const put = (u, b) => request(app).put(u).set("Authorization", `Bearer ${tok}`).send(b);

describe("Suspension des e-mails de conflit seuls", () => {
  test("3 h : conflit suspendu, création de dossier non ; réactivation", async () => {
    const r = await put("/api/parametres/emails-conflits", { heures: 3 });
    expect(r.status).toBe(200);
    expect(r.body.conflits_suspendu).toBe(true);
    expect(r.body.suspendu).toBe(false);
    const fin = new Date(r.body.conflits_jusqu_a).getTime() - Date.now();
    expect(fin).toBeGreaterThan(2.9 * 3600e3);
    expect(fin).toBeLessThan(3.1 * 3600e3);
    expect(await envoiSuspendu("decision_conflit", {})).toBe(true);
    expect(await envoiSuspendu("conflit_potentiel", {})).toBe(true);
    expect(await envoiSuspendu("creation_dossier", {})).toBe(false);
    const re = await put("/api/parametres/emails-conflits", { reactiver: true });
    expect(re.body.conflits_suspendu).toBe(false);
    expect(await envoiSuspendu("decision_conflit", {})).toBe(false);
  });
  test("durée invalide refusée ; la suspension générale reste valable pour les deux familles", async () => {
    expect((await put("/api/parametres/emails-conflits", { heures: 0 })).status).toBe(400);
    await put("/api/parametres/emails-dossiers", { heures: 1 });
    expect(await envoiSuspendu("creation_dossier", {})).toBe(true);
    expect(await envoiSuspendu("decision_conflit", {})).toBe(true);
    await put("/api/parametres/emails-dossiers", { reactiver: true });
    expect((await etatSuspension()).suspendu).toBe(false);
  });
});
