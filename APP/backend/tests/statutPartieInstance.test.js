// JURIA — statut de la partie dans l'instance (19/09/2026, demande
// explicite de l'utilisateur) : le libellé affiché dépend du degré
// (Demandeur→Appelant→Demandeur au pourvoi selon le degré), mais la
// VALEUR stockée en base ne change jamais — ces tests portent sur le
// stockage/la sélection de l'instance la plus récente, pas sur le
// libellé (dérivé côté frontend, non testé ici). Voir CLAUDE.md pour la
// conception complète.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
let userId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client statut partie ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

async function creerDossier() {
  const clientId = await creerClient();
  const res = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `SPI-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test statut partie",
      client_id: clientId,
      pole: "contentieux",
      responsable_id: userId,
      mode_honoraires: "forfait",
    });
  return res.body.id;
}

describe("Statut de la partie dans l'instance", () => {
  test("une instance créée sans statut_partie n'en a pas (facultatif)", async () => {
    const dossierId = await creerDossier();
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", juridiction: "Tribunal de commerce de Bamako" });
    expect(res.status).toBe(201);
    expect(res.body.statut_partie).toBeNull();
  });

  test("une instance avec statut_partie='demandeur' le persiste tel quel", async () => {
    const dossierId = await creerDossier();
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", statut_partie: "demandeur" });
    expect(res.status).toBe(201);
    expect(res.body.statut_partie).toBe("demandeur");
  });

  test("statut_partie='autre' avec précision libre est persisté", async () => {
    const dossierId = await creerDossier();
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ degre: "cassation", statut_partie: "autre", statut_partie_precision: "Curateur ad hoc" });
    expect(res.status).toBe(201);
    expect(res.body.statut_partie).toBe("autre");
    expect(res.body.statut_partie_precision).toBe("Curateur ad hoc");
  });

  test("une valeur hors énumération est refusée (400)", async () => {
    const dossierId = await creerDossier();
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", statut_partie: "victime" });
    expect(res.status).toBe(400);
  });

  test("PUT met à jour statut_partie sans toucher aux autres champs (COALESCE)", async () => {
    const dossierId = await creerDossier();
    const creation = await request(app)
      .post(`/api/dossiers/${dossierId}/instances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", juridiction: "Tribunal de commerce de Bamako", statut_partie: "demandeur" });
    const instanceId = creation.body.id;

    const maj = await request(app)
      .put(`/api/dossiers/${dossierId}/instances/${instanceId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statut_partie: "defendeur" });
    expect(maj.status).toBe(200);
    expect(maj.body.statut_partie).toBe("defendeur");
    expect(maj.body.juridiction).toBe("Tribunal de commerce de Bamako");
  });

  test("GET /:id renvoie l'historique complet des instances avec leur statut", async () => {
    const dossierId = await creerDossier();
    await request(app).post(`/api/dossiers/${dossierId}/instances`).set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", statut_partie: "demandeur" });
    await request(app).post(`/api/dossiers/${dossierId}/instances`).set("Authorization", `Bearer ${token}`)
      .send({ degre: "appel", statut_partie: "defendeur" });

    const res = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.instances).toHaveLength(2);
    const degres = res.body.instances.map((i) => i.degre);
    expect(degres).toEqual(expect.arrayContaining(["premiere_instance", "appel"]));
  });

  test("GET / (liste) expose le statut de l'instance la plus récente, pas la première", async () => {
    const dossierId = await creerDossier();
    await request(app).post(`/api/dossiers/${dossierId}/instances`).set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", statut_partie: "demandeur" });
    await request(app).post(`/api/dossiers/${dossierId}/instances`).set("Authorization", `Bearer ${token}`)
      .send({ degre: "appel", statut_partie: "defendeur" });

    const complet = await request(app).get("/api/dossiers").set("Authorization", `Bearer ${token}`);
    const ligne = complet.body.find((d) => d.id === dossierId);
    expect(ligne).toBeTruthy();
    expect(ligne.instance_degre).toBe("appel");
    expect(ligne.instance_statut_partie).toBe("defendeur");
  });

  test("un dossier sans instance n'a pas de statut_partie dans la liste (null, pas d'erreur)", async () => {
    const dossierId = await creerDossier();
    const complet = await request(app).get("/api/dossiers").set("Authorization", `Bearer ${token}`);
    const ligne = complet.body.find((d) => d.id === dossierId);
    expect(ligne).toBeTruthy();
    expect(ligne.instance_degre).toBeNull();
    expect(ligne.instance_statut_partie).toBeNull();
  });
});
