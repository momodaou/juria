// JURIA — Clients contractuels (abonnement), ancrage par CLIENT (09/10/2026,
// revu depuis le 05/10/2026). Voir CLAUDE.md/HISTORY.md pour l'analyse
// complète demandée par l'utilisateur (exemples réels BDM/Orabank : une
// facture périodique unique rémunère TOUS les dossiers du client — l'ancien
// ancrage par dossier ne reflétait jamais ce cas). Périodicité/ancrage/
// montant convenu vivent désormais sur `clients` (PUT /api/clients/:id/
// abonnement) ; un dossier `mode_honoraires='abonnement'` est un indicateur
// ENTIÈREMENT DÉRIVÉ de l'état de son client (resoudreModeHonorairesEffectif,
// dossiers.js) — jamais choisi manuellement. Statut "à jour/en retard"
// toujours DÉRIVÉ (jamais une case à cocher) de la dernière facture
// réellement émise pour CE CLIENT (factures.client_id, qu'elle soit liée ou
// non à l'un de ses dossiers). Registre GET /api/clients/meta/abonnements
// (gardé par factures.consulter, pas de nouveau concept de permission).
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

function majAbonnementClient(clientId, payload) {
  return request(app)
    .put(`/api/clients/${clientId}/abonnement`)
    .set("Authorization", `Bearer ${token}`)
    .send(payload);
}

function creerDossier(payload) {
  return request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `ABO-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test abonnement",
      pole: "contentieux",
      mode_honoraires: "forfait",
      responsable_id: associeId,
      ...payload,
    });
}

describe("PUT /api/clients/:id/abonnement — configuration de la convention-cadre", () => {
  test("refusé (400) : periodicite et prochaine_facturation doivent être fournis ensemble", async () => {
    const clientId = await creerClient();
    const res = await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ensemble/i);
  });

  test("refusé (400) : périodicité invalide (ex. 'ponctuelle', sans sens pour un abonnement)", async () => {
    const clientId = await creerClient();
    const res = await majAbonnementClient(clientId, {
      abonnement_periodicite: "ponctuelle", abonnement_prochaine_facturation: "2026-11-05",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalide/i);
  });

  test("accepté (200) : mensuelle, formule dérivée (jour seul, pas de mois d'ancrage)", async () => {
    const clientId = await creerClient();
    const res = await majAbonnementClient(clientId, {
      abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05",
    });
    expect(res.status).toBe(200);
    expect(res.body.abonnement_jour_facturation).toBe(5);
    expect(res.body.abonnement_mois_facturation).toBeNull();
  });

  test("accepté (200) : annuelle, jour ET mois d'ancrage dérivés, montant convenu enregistré", async () => {
    const clientId = await creerClient();
    const res = await majAbonnementClient(clientId, {
      abonnement_periodicite: "annuelle", abonnement_prochaine_facturation: "2026-03-15", montant_convenu: 2500000,
    });
    expect(res.status).toBe(200);
    expect(res.body.abonnement_jour_facturation).toBe(15);
    expect(res.body.abonnement_mois_facturation).toBe(3);
    expect(Number(res.body.abonnement_montant_convenu_xof)).toBe(2500000);
  });

  test("retrait de la convention (periodicite ET prochaine_facturation omises) efface aussi le montant convenu", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, {
      abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05", montant_convenu: 100000,
    });
    const res = await majAbonnementClient(clientId, {});
    expect(res.status).toBe(200);
    expect(res.body.abonnement_periodicite).toBeNull();
    expect(res.body.abonnement_montant_convenu_xof).toBeNull();
  });
});

describe("Création de dossier — mode_honoraires dérivé de l'état du client", () => {
  test("client SANS convention : 'abonnement' refusé explicitement (400)", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({ client_id: clientId, mode_honoraires: "abonnement" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/convention/i);
  });

  test("client SOUS convention : le mode demandé (même 'forfait') est coercé en 'abonnement'", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05" });
    const res = await creerDossier({ client_id: clientId, mode_honoraires: "forfait" });
    expect(res.status).toBe(201);
    const relu = await request(app).get(`/api/dossiers/${res.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.mode_honoraires).toBe("abonnement");
  });

  test("client SOUS convention : 2 dossiers distincts (contentieux + conseil) deviennent TOUS DEUX 'abonnement'", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "trimestrielle", abonnement_prochaine_facturation: "2026-11-05" });
    const d1 = await creerDossier({ client_id: clientId, pole: "contentieux" });
    const d2 = await creerDossier({ client_id: clientId, pole: "conseil" });
    expect(d1.status).toBe(201);
    expect(d2.status).toBe(201);
    const relu1 = await request(app).get(`/api/dossiers/${d1.body.id}`).set("Authorization", `Bearer ${token}`);
    const relu2 = await request(app).get(`/api/dossiers/${d2.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu1.body.mode_honoraires).toBe("abonnement");
    expect(relu2.body.mode_honoraires).toBe("abonnement");
  });

  test("mode_honoraires toujours requis pour un client sans convention", async () => {
    const clientId = await creerClient();
    const res = await creerDossier({ client_id: clientId, mode_honoraires: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/honoraires/i);
  });
});

describe("PUT /api/dossiers/:id — recalcul du mode effectif seulement si pertinent", () => {
  test("changer de client vers un client sous convention bascule le dossier en 'abonnement'", async () => {
    const clientSansConvention = await creerClient();
    const clientAvecConvention = await creerClient();
    await majAbonnementClient(clientAvecConvention, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05" });
    const creation = await creerDossier({ client_id: clientSansConvention, mode_honoraires: "forfait" });
    const maj = await request(app).put(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`).send({
      client_id: clientAvecConvention,
    });
    expect(maj.status).toBe(200);
    expect(maj.body.mode_honoraires).toBe("abonnement");
  });

  test("une édition sans toucher à client_id/mode_honoraires laisse le mode existant intact", async () => {
    const clientId = await creerClient();
    const creation = await creerDossier({ client_id: clientId, mode_honoraires: "forfait" });
    const maj = await request(app).put(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`).send({ objet: "Mise à jour sans rapport" });
    expect(maj.status).toBe(200);
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.mode_honoraires).toBe("forfait");
  });
});

describe("Statut dérivé (à jour / en retard) — ancré sur le CLIENT, pas le dossier", () => {
  test("en retard : échéance déjà passée, aucune facture jamais émise pour ce client", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01" });
    await creerDossier({ client_id: clientId });
    const relu = await request(app).get(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.abonnement_statut).toBe("en_retard");
  });

  test("une facture CONSOLIDÉE (client seul, sans dossier_id) remet TOUS les dossiers du client à jour", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01" });
    const d1 = await creerDossier({ client_id: clientId });
    const d2 = await creerDossier({ client_id: clientId });

    // Bug réel signalé par l'utilisateur, corrigé ici : jusqu'au 09/10/2026,
    // une facture sans dossier_id ne remettait AUCUN dossier à jour (la
    // jointure filtrait strictement factures.dossier_id = d.id).
    const facture = await request(app).post("/api/factures").set("Authorization", `Bearer ${token}`).send({
      client_id: clientId, mode: "abonnement", montant_ht: 1000000,
    });
    expect(facture.status).toBe(201);

    const client = await request(app).get(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(client.body.abonnement_statut).toBe("a_jour");
    expect(client.body.abonnement_derniere_facture_le).not.toBeNull();

    // Les 2 dossiers eux-mêmes n'ont plus de statut propre (déplacé sur le
    // client) — mais les deux pointent bien vers le MÊME client, désormais
    // à jour.
    const relu1 = await request(app).get(`/api/dossiers/${d1.body.id}`).set("Authorization", `Bearer ${token}`);
    const relu2 = await request(app).get(`/api/dossiers/${d2.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu1.body.client_id).toBe(clientId);
    expect(relu2.body.client_id).toBe(clientId);
  });

  test("une facture liée à UN SEUL dossier du client remet aussi le client à jour (donc tous ses autres dossiers, par construction)", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01" });
    const d1 = await creerDossier({ client_id: clientId });
    await creerDossier({ client_id: clientId }); // 2e dossier du même client, jamais facturé individuellement

    const facture = await request(app).post("/api/factures").set("Authorization", `Bearer ${token}`).send({
      dossier_id: d1.body.id, mode: "abonnement", montant_ht: 500000,
    });
    expect(facture.status).toBe(201);

    const client = await request(app).get(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(client.body.abonnement_statut).toBe("a_jour");
  });

  test("une facture ANNULÉE ne compte pas — le client reste en retard", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01" });
    const facture = await request(app).post("/api/factures").set("Authorization", `Bearer ${token}`).send({
      client_id: clientId, mode: "abonnement", montant_ht: 100000,
    });
    await request(app).post(`/api/factures/${facture.body.id}/annuler`).set("Authorization", `Bearer ${token}`);
    const client = await request(app).get(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(client.body.abonnement_statut).toBe("en_retard");
    expect(client.body.abonnement_derniere_facture_le).toBeNull();
  });

  test("null (pas de statut) tant qu'aucune périodicité n'est configurée sur le client", async () => {
    const clientId = await creerClient();
    const client = await request(app).get(`/api/clients/${clientId}`).set("Authorization", `Bearer ${token}`);
    expect(client.body.abonnement_statut).toBeNull();
    expect(client.body.abonnement_prochaine_echeance).toBeNull();
  });
});

describe("GET /api/clients/meta/abonnements — registre, gardé par factures.consulter", () => {
  test("présent pour l'associé (a factures.consulter)", async () => {
    const res = await request(app).get("/api/clients/meta/abonnements").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test("un client sous convention y apparaît une seule fois, même avec plusieurs dossiers", async () => {
    const clientId = await creerClient({ denomination: `Client registre ${Date.now()}` });
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2020-01-01" });
    await creerDossier({ client_id: clientId });
    await creerDossier({ client_id: clientId });
    const res = await request(app).get("/api/clients/meta/abonnements").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const lignes = res.body.filter((r) => r.client_id === clientId);
    expect(lignes.length).toBe(1);
    expect(lignes[0].abonnement_statut).toBe("en_retard");
  });
});

describe("Rétrocessions — aucune pour un dossier de client sous convention (09/10/2026)", () => {
  test("refusé (400) : dossier_id d'un client sous convention", async () => {
    const clientId = await creerClient();
    await majAbonnementClient(clientId, { abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2026-11-05" });
    const dossier = await creerDossier({ client_id: clientId });
    const res = await request(app).post("/api/retrocessions").set("Authorization", `Bearer ${token}`).send({
      beneficiaire_id: associeId, qualite: "associe", base_ht: 500000, dossier_id: dossier.body.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/convention/i);
  });

  test("accepté pour un dossier d'un client SANS convention", async () => {
    const clientId = await creerClient();
    const dossier = await creerDossier({ client_id: clientId });
    const res = await request(app).post("/api/retrocessions").set("Authorization", `Bearer ${token}`).send({
      beneficiaire_id: associeId, qualite: "associe", base_ht: 500000, dossier_id: dossier.body.id,
    });
    expect(res.status).toBe(201);
  });
});
