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

// Ajout 19/08/2026 : champs objet/statut_procedure/intermediaire (existaient
// pour objet, ou nouveaux, mais jamais exposés/persistés via l'API pour la
// création) + branchement de la table `instances`, déjà en base mais jamais
// utilisée par aucune route avant ce jour.
describe("Champs objet/statut_procedure/intermediaire — persistés à la création et à l'édition", () => {
  test("POST /api/dossiers les enregistre tous", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId, {
      objet: "Recouvrement d'une créance impayée",
      statut_procedure: "representation",
      intermediaire: "Cabinet Correspondant XYZ",
    });
    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.objet).toBe("Recouvrement d'une créance impayée");
    expect(relu.body.statut_procedure).toBe("representation");
    expect(relu.body.intermediaire).toBe("Cabinet Correspondant XYZ");
  });

  test("PUT /api/dossiers/:id les met à jour", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const res = await request(app)
      .put(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ objet: "Objet modifié", statut_procedure: "autre", statut_procedure_precision: "Médiation" });
    expect(res.status).toBe(200);

    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.objet).toBe("Objet modifié");
    expect(relu.body.statut_procedure).toBe("autre");
    expect(relu.body.statut_procedure_precision).toBe("Médiation");
  });
});

describe("Instances (1re instance / appel / cassation) — table déjà en base, branchée pour la première fois", () => {
  test("instance_initiale à la création crée bien une ligne instances", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId, {
      instance_initiale: { degre: "premiere_instance", juridiction: "Tribunal de Commerce de Bamako" },
    });
    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.instances).toHaveLength(1);
    expect(relu.body.instances[0].degre).toBe("premiere_instance");
    expect(relu.body.instances[0].juridiction).toBe("Tribunal de Commerce de Bamako");
  });

  test("POST puis PUT /api/dossiers/:id/instances — passage en appel puis décision rendue", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId, {
      instance_initiale: { degre: "premiere_instance", juridiction: "TPI Bamako" },
    });

    const appel = await request(app)
      .post(`/api/dossiers/${dossierId}/instances`)
      .set("Authorization", `Bearer ${token}`)
      .send({ degre: "appel", juridiction: "Cour d'Appel de Bamako" });
    expect(appel.status).toBe(201);
    expect(appel.body.degre).toBe("appel");

    const maj = await request(app)
      .put(`/api/dossiers/${dossierId}/instances/${appel.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "Confirmation du jugement de première instance", numero_role: "RG-2026-042" });
    expect(maj.status).toBe(200);
    expect(maj.body.decision).toBe("Confirmation du jugement de première instance");
    expect(maj.body.numero_role).toBe("RG-2026-042");

    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.instances).toHaveLength(2);
  });
});

// Ajout 19/08/2026 : la numérotation générait jusqu'ici un "AFF-AA-XXX"
// générique sans rapport avec le Guide de référencement des dossiers
// adopté par le cabinet (fourni par l'utilisateur, DOC/CLAUDE CODE - JURIA/).
// Ces tests fixent la vraie formule : [TYPE]-[MATIÈRE]-[ANNÉE]-[N°], via la
// table codes_matiere (déjà en base, jamais branchée avant ce jour).
describe("Numérotation selon le Guide de référencement des dossiers", () => {
  test("sans matière choisie : IND par défaut (chemise neutre à qualifier, prévu par le guide)", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/dossiers")
      .set("Authorization", `Bearer ${token}`)
      .send({ intitule: "Sans matière", client_id: clientId, pole: "contentieux", responsable_id: userId });
    expect(res.status).toBe(201);
    const annee = new Date().getFullYear();
    expect(res.body.numero).toMatch(new RegExp(`^CX-IND-${annee}-\\d{4}$`));
    expect(res.body.code_matiere).toBe("IND");
  });

  test("code_matiere choisi : format CX-COM-AAAA-NNNN, compteur incrémental par type+matière", async () => {
    const clientId = await creerClient();
    const annee = new Date().getFullYear();

    const premier = await request(app)
      .post("/api/dossiers")
      .set("Authorization", `Bearer ${token}`)
      .send({ intitule: "Commercial 1", client_id: clientId, pole: "contentieux", responsable_id: userId, code_matiere: "COM" });
    const second = await request(app)
      .post("/api/dossiers")
      .set("Authorization", `Bearer ${token}`)
      .send({ intitule: "Commercial 2", client_id: clientId, pole: "contentieux", responsable_id: userId, code_matiere: "COM" });

    expect(premier.body.numero).toMatch(new RegExp(`^CX-COM-${annee}-\\d{4}$`));
    const n1 = Number(premier.body.numero.split("-")[3]);
    const n2 = Number(second.body.numero.split("-")[3]);
    expect(n2).toBe(n1 + 1);
    expect(premier.body.couleur_chemise).toBe("bleu"); // Guide §6 : CX-COM → bleu
  });

  test("compteur distinct pour un autre type+matière (CS-AFF vs CX-COM)", async () => {
    const clientId = await creerClient();
    const annee = new Date().getFullYear();
    const res = await request(app)
      .post("/api/dossiers")
      .set("Authorization", `Bearer ${token}`)
      .send({ intitule: "Conseil affaires", client_id: clientId, pole: "conseil", responsable_id: userId, code_matiere: "AFF" });
    expect(res.body.numero).toMatch(new RegExp(`^CS-AFF-${annee}-0001$`));
  });
});

describe("Requalification depuis IND — seul cas où la référence, normalement stable, est reconstruite", () => {
  test("PUT code_matiere depuis IND régénère numero et couleur_chemise ; un changement ultérieur laisse numero stable", async () => {
    const clientId = await creerClient();
    const creation = await request(app)
      .post("/api/dossiers")
      .set("Authorization", `Bearer ${token}`)
      .send({ intitule: "À qualifier", client_id: clientId, pole: "contentieux", responsable_id: userId });
    const dossierId = creation.body.id;
    expect(creation.body.code_matiere).toBe("IND");
    const ancienNumero = creation.body.numero;

    const requalif = await request(app)
      .put(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code_matiere: "CIV" });
    expect(requalif.status).toBe(200);
    expect(requalif.body.numero).not.toBe(ancienNumero);
    expect(requalif.body.numero).toMatch(/^CX-CIV-\d{4}-\d{4}$/);
    expect(requalif.body.code_matiere).toBe("CIV");
    expect(requalif.body.couleur_chemise).toBe("jaune"); // Guide §6 : CX-CIV → jaune

    const numeroApresRequalif = requalif.body.numero;
    const autreChangement = await request(app)
      .put(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ code_matiere: "FAM" });
    expect(autreChangement.status).toBe(200);
    expect(autreChangement.body.numero).toBe(numeroApresRequalif);
  });
});
