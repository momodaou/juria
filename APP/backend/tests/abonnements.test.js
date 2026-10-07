// JURIA — Clients contractuels (abonnement), 05/10/2026. Voir CLAUDE.md/
// HISTORY.md pour la synthèse de conception complète : périodicité de
// facturation (mensuelle/trimestrielle/semestrielle/annuelle) stockée sur le
// dossier "abonnement" (ombrelle par client, une seule convention-cadre
// active à la fois), statut "à jour/en retard" toujours DÉRIVÉ (jamais une
// case à cocher) de la dernière facture réellement émise et liée au
// dossier, registre GET /api/dossiers/meta/abonnements (gardé par
// factures.consulter, pas de nouveau concept de permission).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
let associeId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerClient(overrides = {}) {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client abonnement ${Date.now()}-${Math.random()}`, ...overrides });
  return res.body.id;
}

function creerDossier(payload) {
  return request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `ABO-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test abonnement",
      pole: "contentieux",
      mode_honoraires: "abonnement",
      responsable_id: associeId,
      ...payload,
    });
}

describe("Périodicité d'abonnement — validation à la création", () => {
  test("refusé (400) : périodicité réservée au mode 'abonnement'", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({
      client_id: clientId, mode_honoraires: "forfait",
      abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/abonnement/i);
  });

  test("refusé (400) : periodicite et prochaine_facturation doivent être fournis ensemble", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({ client_id: clientId, abonnement_periodicite: "mensuelle" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ensemble/i);
  });

  test("refusé (400) : périodicité invalide (ex. 'ponctuelle', sans sens pour un abonnement)", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({
      client_id: clientId, abonnement_periodicite: "ponctuelle", abonnement_prochaine_facturation: "2026-11-05",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test("accepté (201) : mensuelle, formule dérivée (jour seul, pas de mois d'ancrage)", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({
      client_id: clientId, abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05",
    });
    expect(res.status).toBe(201);
    const relu = await request(app).get(`/api/dossiers/${res.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_periodicite).toBe("mensuelle");
    expect(relu.body.abonnement_jour_facturation).toBe(5);
    expect(relu.body.abonnement_mois_facturation).toBeNull();
  });

  test("accepté (201) : annuelle, jour ET mois d'ancrage dérivés", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({
      client_id: clientId, abonnement_periodicite: "annuelle", abonnement_prochaine_facturation: "2026-03-15",
    });
    expect(res.status).toBe(201);
    const relu = await request(app).get(`/api/dossiers/${res.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_jour_facturation).toBe(15);
    expect(relu.body.abonnement_mois_facturation).toBe(3);
  });
});

describe("Statut dérivé (à jour / en retard), jamais stocké", () => {
  test("en retard : échéance du mois déjà passée, aucune facture jamais émise sur ce dossier", async () => {
    const clientId = await creerClient();
    // Ancrage au 1er du mois — à coup sûr déjà dépassé aujourd'hui.
    const creation = await creerDossier({
      client_id: clientId, abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01",
    });
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_statut).toBe("en_retard");
  });

  test("à jour après émission d'une facture liée au dossier", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({
      client_id: clientId, abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01",
    });
    const dossierId = creation.body.id;
    // Facture émise AUJOURD'HUI sur ce dossier → clôt la période en retard,
    // la prochaine échéance calculée (mensuelle, jour 1) retombe sur le 1er
    // du mois courant ou suivant — jamais déjà dépassée.
    const facture = await request(app).post("/api/factures").set("Authorization", `Bearer ${token}`).send({
      dossier_id: dossierId, mode: "abonnement", montant_ht: 100000,
    });
    expect(facture.status).toBe(201);
    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_statut).toBe("a_jour");
    expect(relu.body.abonnement_derniere_facture_le).not.toBeNull();
  });

  test("une facture ANNULÉE ne compte pas — le dossier reste en retard", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({
      client_id: clientId, abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01",
    });
    const dossierId = creation.body.id;
    const facture = await request(app).post("/api/factures").set("Authorization", `Bearer ${token}`).send({
      dossier_id: dossierId, mode: "abonnement", montant_ht: 100000,
    });
    await request(app).post(`/api/factures/${facture.body.id}/annuler`).set("Authorization", `Bearer ${token}`);
    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_statut).toBe("en_retard");
    expect(relu.body.abonnement_derniere_facture_le).toBeNull();
  });

  test("null (pas de badge) tant qu'aucune périodicité n'est configurée", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({ client_id: clientId });
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_statut).toBeNull();
    expect(relu.body.abonnement_prochaine_echeance).toBeNull();
  });
});

describe("PUT /api/dossiers/:id — correction de la formule après coup", () => {
  test("changer de trimestrielle (avec mois d'ancrage) vers mensuelle efface bien le mois (pas de COALESCE fantôme)", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({
      client_id: clientId, abonnement_periodicite: "trimestrielle", abonnement_prochaine_facturation: "2026-06-10",
    });
    const dossierId = creation.body.id;
    let relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_mois_facturation).toBe(6);

    const maj = await request(app).put(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`).send({
      abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-06-20",
    });
    expect(maj.status).toBe(200);
    relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_periodicite).toBe("mensuelle");
    expect(relu.body.abonnement_jour_facturation).toBe(20);
    expect(relu.body.abonnement_mois_facturation).toBeNull();
  });

  test("PUT avec abonnement_periodicite/abonnement_prochaine_facturation en chaîne vide (formulaire d'édition d'un dossier non-abonnement) n'échoue pas", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({ client_id: clientId, mode_honoraires: "forfait" });
    const dossierId = creation.body.id;
    const maj = await request(app).put(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`).send({
      urgence: "haute", abonnement_periodicite: "", abonnement_prochaine_facturation: "",
    });
    expect(maj.status).toBe(200);
  });

  test("PUT sans toucher à l'abonnement laisse la formule existante intacte", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({
      client_id: clientId, abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-06-10",
    });
    const dossierId = creation.body.id;
    const maj = await request(app).put(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`).send({ objet: "Mise à jour sans rapport" });
    expect(maj.status).toBe(200);
    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_periodicite).toBe("mensuelle");
    expect(relu.body.abonnement_jour_facturation).toBe(10);
  });
});

describe("GET /api/dossiers/meta/abonnements — registre, gardé par factures.consulter", () => {
  test("présent pour l'associé (a factures.consulter)", async () => {
    const res = await request(app).get("/api/dossiers/meta/abonnements").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("un dossier abonnement y apparaît avec son statut", async () => {
    const clientId = await creerClient({ denomination: `Client registre ${Date.now()}` });
    const creation = await creerDossier({
      client_id: clientId, abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01",
    });
    const res = await request(app).get("/api/dossiers/meta/abonnements").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ligne = res.body.find((r) => r.dossier_id === creation.body.id);
    expect(ligne).toBeDefined();
    expect(ligne.abonnement_statut).toBe("en_retard");
  });
});
