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

// Ajout 20/08/2026 (diagnostic utilisateur) : parties adverses/tiers — la
// route de rectification (POST/PUT/DELETE .../parties) existait déjà mais
// le PUT ne permettait pas de revoir le rôle (imposé 'adverse' à la
// création). Vérifie aussi le CRUD complet (ajout, correction, retrait).
describe("Parties du dossier — CRUD complet, rôle rectifiable après création", () => {
  test("POST crée une partie 'adverse' par défaut, PUT peut requalifier son rôle", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);

    const ajout = await request(app)
      .post(`/api/dossiers/${dossierId}/parties`)
      .set("Authorization", `Bearer ${token}`)
      .send({ denomination: "SODIMA Sarl" });
    expect(ajout.status).toBe(201);
    expect(ajout.body.role).toBe("adverse");

    const maj = await request(app)
      .put(`/api/dossiers/${dossierId}/parties/${ajout.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ role: "co_defendeur" });
    expect(maj.status).toBe(200);
    expect(maj.body.role).toBe("co_defendeur");
    expect(maj.body.denomination).toBe("SODIMA Sarl"); // inchangé (COALESCE)

    const retrait = await request(app)
      .delete(`/api/dossiers/${dossierId}/parties/${ajout.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(retrait.status).toBe(204);

    const relu = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.parties).toHaveLength(0);
  });
});

// Ajout 20/08/2026 (diagnostic utilisateur) : la table client_liens (LBC-FT
// — bénéficiaires effectifs, filiales, dirigeants…) était déjà lue par
// GET /api/clients/:id mais n'avait jamais eu de route d'écriture.
describe("Personnes/entités liées (client_liens) — CRUD + visibilité bidirectionnelle", () => {
  test("un lien créé depuis A est visible sur A (liens) et sur B (liens_inverses)", async () => {
    const clientA = await creerClient({ denomination: "Holding A" });
    const clientB = await creerClient({ denomination: "Filiale B" });

    const ajout = await request(app)
      .post(`/api/clients/${clientA}/liens`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lie_a_id: clientB, nature: "actionnaire de" });
    expect(ajout.status).toBe(201);

    const ficheA = await request(app).get(`/api/clients/${clientA}`).set("Authorization", `Bearer ${token}`);
    expect(ficheA.body.liens).toHaveLength(1);
    expect(ficheA.body.liens[0].lie_a_id).toBe(clientB);

    const ficheB = await request(app).get(`/api/clients/${clientB}`).set("Authorization", `Bearer ${token}`);
    expect(ficheB.body.liens_inverses).toHaveLength(1);
    expect(ficheB.body.liens_inverses[0].lie_a_id).toBe(clientA);

    // Retrait depuis l'autre bout (B) — doit fonctionner, pas seulement
    // depuis la fiche où le lien a été créé (A).
    const retrait = await request(app)
      .delete(`/api/clients/${clientB}/liens/${ajout.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(retrait.status).toBe(204);

    const ficheApresRetrait = await request(app).get(`/api/clients/${clientA}`).set("Authorization", `Bearer ${token}`);
    expect(ficheApresRetrait.body.liens).toHaveLength(0);
  });

  test("refuse un lien d'un client vers lui-même", async () => {
    const clientA = await creerClient();
    const res = await request(app)
      .post(`/api/clients/${clientA}/liens`)
      .set("Authorization", `Bearer ${token}`)
      .send({ lie_a_id: clientA, nature: "dirigeant" });
    expect(res.status).toBe(400);
  });
});

// Ajout 20/08/2026 (diagnostic utilisateur) : aucune contrainte d'unicité
// n'existe sur rccm/nif — ce contrôle prévient sans bloquer (voir clients.js).
describe("GET /api/clients/verifier-doublon — signale sans bloquer", () => {
  test("détecte un RCCM identique", async () => {
    const rccm = `RCCM-${Date.now()}`;
    await creerClient({ rccm });
    const res = await request(app)
      .get("/api/clients/verifier-doublon")
      .query({ type: "morale", denomination: "Autre nom", rccm })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].motifs).toContain("RCCM identique");
  });

  test("détecte un nom identique (personne morale)", async () => {
    const denomination = `Bâtir SA ${Date.now()}`;
    await creerClient({ denomination });
    const res = await request(app)
      .get("/api/clients/verifier-doublon")
      .query({ type: "morale", denomination })
      .set("Authorization", `Bearer ${token}`);
    expect(res.body[0].motifs).toContain("Nom identique");
  });

  // Ajout 21/08/2026 : la comparaison de noms ignore désormais espace/tiret/
  // point/virgule — un simple ILIKE exact ratait ce rapprochement pourtant
  // réel (RCCM/NIF, eux, restent comparés tels quels, non normalisés).
  test("détecte un nom identique malgré un tiret à la place d'un espace", async () => {
    const suffixe = `${Date.now()}`;
    await creerClient({ denomination: `Bâtir-SA-Rapprochement-${suffixe}` });
    const res = await request(app)
      .get("/api/clients/verifier-doublon")
      .query({ type: "morale", denomination: `Bâtir SA Rapprochement ${suffixe}` })
      .set("Authorization", `Bearer ${token}`);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].motifs).toContain("Nom identique");
  });

  test("aucune correspondance → tableau vide", async () => {
    const res = await request(app)
      .get("/api/clients/verifier-doublon")
      .query({ type: "morale", denomination: `Inexistant ${Date.now()}-${Math.random()}` })
      .set("Authorization", `Bearer ${token}`);
    expect(res.body).toEqual([]);
  });
});

// Ajout 21/08/2026 (diagnostic utilisateur, dernier point) : le contrôle de
// conflit à l'ouverture ratait un rapprochement pourtant réel dès qu'un
// espace/tiret différait entre le terme recherché et le nom déjà en base
// (client ou partie adverse d'un autre dossier) — même limite que le
// contrôle de doublon client ci-dessus, corrigée par la même normalisation.
describe("POST /api/conflict-checks — comparaison insensible à l'espace/tiret", () => {
  test("un client existant nommé avec un tiret est retrouvé en cherchant avec un espace", async () => {
    const suffixe = `${Date.now()}`;
    await creerClient({ denomination: `SODIMA-Conflit-${suffixe}` });

    const res = await request(app)
      .post("/api/conflict-checks")
      .set("Authorization", `Bearer ${token}`)
      .send({ noms: `SODIMA Conflit ${suffixe}` });

    expect(res.status).toBe(201);
    expect(res.body.resultat).toBe("potentiel");
    expect(res.body.details[0].correspondances.some((c) => c.source === "client")).toBe(true);
  });

  test("une partie adverse d'un autre dossier, nommée avec un espace, est retrouvée en cherchant avec un tiret", async () => {
    const suffixe = `${Date.now()}`;
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app)
      .post(`/api/dossiers/${dossierId}/parties`)
      .set("Authorization", `Bearer ${token}`)
      .send({ denomination: `Tiers Rapproche ${suffixe}` });

    const res = await request(app)
      .post("/api/conflict-checks")
      .set("Authorization", `Bearer ${token}`)
      .send({ noms: `Tiers-Rapproche-${suffixe}` });

    expect(res.body.resultat).toBe("potentiel");
    expect(res.body.details[0].correspondances.some((c) => c.source === "partie_adverse")).toBe(true);
  });
});

// Ajout 20/08/2026 (diagnostic utilisateur) : ?statut=&responsable= existaient
// déjà côté API mais n'étaient jamais exposés à l'écran ; masquer_archives
// est nouveau (permet d'exclure les dossiers archivés sans cibler un statut
// précis).
describe("GET /api/dossiers — filtres statut/responsable/masquer_archives", () => {
  test("masquer_archives exclut les dossiers archivés, statut cible un statut précis", async () => {
    const clientId = await creerClient();
    const actif = await creerDossier(clientId);
    const archive = await creerDossier(clientId);
    await request(app).put(`/api/dossiers/${archive}`).set("Authorization", `Bearer ${token}`).send({ statut: "archive" });

    const sansArchives = await request(app).get("/api/dossiers?masquer_archives=true").set("Authorization", `Bearer ${token}`);
    const ids = sansArchives.body.map((d) => d.id);
    expect(ids).toContain(actif);
    expect(ids).not.toContain(archive);

    const seulementArchives = await request(app).get("/api/dossiers?statut=archive").set("Authorization", `Bearer ${token}`);
    const idsArchives = seulementArchives.body.map((d) => d.id);
    expect(idsArchives).toContain(archive);
    expect(idsArchives).not.toContain(actif);
  });
});

// Ajout 20/08/2026 (diagnostic utilisateur) : recherche clients élargie
// (RCCM/NIF/email/téléphone), auparavant limitée à dénomination/nom/prénom.
describe("GET /api/clients?q= — recherche élargie au RCCM/NIF/email/téléphone", () => {
  test("trouve un client par son RCCM", async () => {
    const rccm = `RCCM-RECH-${Date.now()}`;
    const clientId = await creerClient({ rccm, denomination: "Nom Sans Rapport" });
    const res = await request(app).get(`/api/clients?q=${rccm}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.map((c) => c.id)).toContain(clientId);
  });

  test("trouve un client par son email", async () => {
    const email = `client-${Date.now()}@exemple.ml`;
    const clientId = await creerClient({ email, denomination: "Encore Un Autre Nom" });
    const res = await request(app).get(`/api/clients?q=${email}`).set("Authorization", `Bearer ${token}`);
    expect(res.body.map((c) => c.id)).toContain(clientId);
  });
});

// Ajout 20/08/2026 (diagnostic utilisateur) : le garde-fou anti-perte de
// données de DELETE /api/dossiers/:id ne protégeait que documents/temps/
// factures/etc., pas les parties/instances/clients additionnels déjà
// saisis à l'ouverture — un dossier "à l'ouverture" avec ces informations
// pouvait être supprimé sans avertissement.
describe("DELETE /api/dossiers/:id — garde-fou étendu aux parties/instances/clients additionnels", () => {
  test("refuse (409) si une partie adverse a déjà été saisie", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app)
      .post(`/api/dossiers/${dossierId}/parties`)
      .set("Authorization", `Bearer ${token}`)
      .send({ denomination: "Partie test" });

    const res = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  test("refuse (409) si un client additionnel a déjà été rattaché", async () => {
    const clientId = await creerClient();
    const autreClient = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app)
      .post(`/api/dossiers/${dossierId}/clients`)
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: autreClient });

    const res = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});
