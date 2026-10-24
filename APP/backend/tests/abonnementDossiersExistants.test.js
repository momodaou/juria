// JURIA — un dossier ouvert AVANT la convention-cadre de son client passe en « abonnement »
// quand la convention est configurée, et la fiche dossier expose l'état du client (25/10/2026).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let associeId;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token; associeId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

const creerClient = async () => (await request(app).post("/api/clients").set(auth())
  .send({ type: "morale", denomination: `Client sync ${Date.now()}-${Math.random()}` })).body.id;
const creerDossier = (clientId, mode = "forfait") => request(app).post("/api/dossiers").set(auth())
  .send({ numero: `SYN-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier sync", pole: "contentieux", mode_honoraires: mode, responsable_id: associeId, client_id: clientId });
const fiche = async (id) => (await request(app).get(`/api/dossiers/${id}`).set(auth())).body;

describe("Convention-cadre configurée après l'ouverture des dossiers", () => {
  test("les dossiers déjà rattachés passent en abonnement ; la fiche expose client_sous_convention", async () => {
    const clientId = await creerClient();
    const d1 = (await creerDossier(clientId, "forfait")).body.id;
    const d2 = (await creerDossier(clientId, "temps_passe")).body.id;
    expect(await fiche(d1)).toMatchObject({ mode_honoraires: "forfait", client_sous_convention: false });

    const r = await request(app).put(`/api/clients/${clientId}/abonnement`).set(auth())
      .send({ abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-12-01" });
    expect(r.status).toBe(200);
    expect(r.body.dossiers_rattaches).toBe(2);

    expect(await fiche(d1)).toMatchObject({ mode_honoraires: "abonnement", client_sous_convention: true });
    expect((await fiche(d2)).mode_honoraires).toBe("abonnement");
    // idempotent : une seconde configuration ne touche plus rien
    const r2 = await request(app).put(`/api/clients/${clientId}/abonnement`).set(auth())
      .send({ abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-12-01" });
    expect(r2.body.dossiers_rattaches).toBe(0);
  });

  test("retirer la convention ne touche pas aux dossiers ; un autre client n'est pas concerné", async () => {
    const abonne = await creerClient(); const autre = await creerClient();
    const dAutre = (await creerDossier(autre, "forfait")).body.id;
    await creerDossier(abonne, "forfait");
    await request(app).put(`/api/clients/${abonne}/abonnement`).set(auth())
      .send({ abonnement_periodicite: "trimestrielle", abonnement_prochaine_facturation: "2026-12-01" });
    expect((await fiche(dAutre)).mode_honoraires).toBe("forfait");
    const retrait = await request(app).put(`/api/clients/${abonne}/abonnement`).set(auth()).send({});
    expect(retrait.status).toBe(200);
    expect(retrait.body.dossiers_rattaches).toBe(0);
  });
});
