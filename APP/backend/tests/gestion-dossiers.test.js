// JURIA — tests ciblés sur les capacités ajoutées le 18/08/2026 suite à un
// retour utilisateur : suppression d'un dossier/client "à l'ouverture"
// (bloquée dès qu'une activité réelle existe), archivage d'un dossier
// (permission dédiée, distincte de l'édition générale), et clients
// additionnels sur un dossier (un dossier peut avoir plusieurs identités
// clientes). Aucune de ces routes n'existait avant ce jour.
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

async function creerClient(overrides = {}) {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client gestion ${Date.now()}-${Math.random()}`, ...overrides });
  return res.body.id;
}

async function creerDossier(clientId, overrides = {}) {
  const res = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `GES-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test gestion",
      client_id: clientId,
      pole: "contentieux",
      responsable_id: userId,
      ...overrides,
    });
  return res.body.id;
}

describe("DELETE /api/dossiers/:id — limité aux dossiers sans activité", () => {
  test("supprime un dossier fraîchement créé, sans activité", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);

    const res = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);

    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.status).toBe(404);
  });

  test("refuse (409) si le dossier a déjà une facture", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: dossierId, mode: "forfait", montant_ht: 100000 });

    const res = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);

    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.status).toBe(200); // toujours là
  });
});

describe("DELETE /api/clients/:id — limité aux clients sans activité", () => {
  test("supprime un client fraîchement créé, sans dossier ni pièce KYC", async () => {
    const clientId = await creerClient();
    const res = await request(app).delete(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  test("refuse (409) si le client a un dossier", async () => {
    const clientId = await creerClient();
    await creerDossier(clientId);
    const res = await request(app).delete(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});

describe("Archivage — permission dédiée, distincte de l'édition générale", () => {
  test("PUT statut='archive' fonctionne pour un rôle avec dossiers.archiver (associé)", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const res = await request(app)
      .put(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statut: "archive" });
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe("archive");
  });
});

describe("Clients additionnels — un dossier peut avoir plusieurs identités clientes", () => {
  test("ajout à la création, visible sur la fiche", async () => {
    const clientPrincipal = await creerClient();
    const clientAdditionnel = await creerClient();
    const dossierId = await creerDossier(clientPrincipal, { clients_additionnels: [clientAdditionnel] });

    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.clients_additionnels).toHaveLength(1);
    expect(relu.body.clients_additionnels[0].id).toBe(clientAdditionnel);
  });

  test("ajout/retrait après création via POST/DELETE dédiés", async () => {
    const clientPrincipal = await creerClient();
    const autreClient = await creerClient();
    const dossierId = await creerDossier(clientPrincipal);

    const ajout = await request(app)
      .post(`/api/dossiers/${dossierId}/clients`)
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: autreClient });
    expect(ajout.status).toBe(201);

    const apresAjout = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(apresAjout.body.clients_additionnels).toHaveLength(1);

    const retrait = await request(app)
      .delete(`/api/dossiers/${dossierId}/clients/${autreClient}`)
      .set("Authorization", `Bearer ${token}`);
    expect(retrait.status).toBe(204);

    const apresRetrait = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(apresRetrait.body.clients_additionnels).toHaveLength(0);
  });
});
