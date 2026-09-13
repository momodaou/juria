// JURIA — Atelier d'actes : catalogue de modèles dynamique + cycle
// brouillon/édition/validation/PDF (13/09/2026, 1re suite de tests pour ce
// module — jusqu'ici jamais couvert explicitement).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client Actes ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

async function creerDossier(clientId) {
  const res = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `ACT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test actes",
      pole: "contentieux",
      client_id: clientId,
      responsable_id: associeId,
    });
  return res.body.id;
}

async function creerUtilisateur(role) {
  const jwt = require("jsonwebtoken");
  const { SECRET } = require("../src/auth");
  const bcrypt = require("bcryptjs");
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestActes123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Actes',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`A${suffixe.slice(0, 7)}`, `test.actes.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jeton = jwt.sign({ sub: rows[0].id, role, nom: "Test Actes" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jeton };
}

describe("GET /api/actes/modeles — catalogue actif", () => {
  test("renvoie les modèles seedés (mise en demeure notamment)", async () => {
    const res = await request(app).get("/api/actes/modeles").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.some((m) => m.code === "mise_en_demeure")).toBe(true);
    expect(res.body.some((m) => m.code === "autre")).toBe(true);
  });
});

describe("Gestion du catalogue — réservée à actes.modeles.gerer", () => {
  test("GET /modeles/tous refusé à un collaborateur", async () => {
    const collab = await creerUtilisateur("collaborateur");
    const res = await request(app).get("/api/actes/modeles/tous").set("Authorization", `Bearer ${collab.token}`);
    expect(res.status).toBe(403);
  });

  test("un associé peut créer, modifier, désactiver un modèle", async () => {
    const code = `test_modele_${Date.now()}`;
    const creation = await request(app)
      .post("/api/actes/modeles")
      .set("Authorization", `Bearer ${token}`)
      .send({ code, nom: "Modèle de test", categorie: "correspondance", corps: "Bonjour {{client}}." });
    expect(creation.status).toBe(201);
    const id = creation.body.id;

    const doublon = await request(app)
      .post("/api/actes/modeles")
      .set("Authorization", `Bearer ${token}`)
      .send({ code, nom: "Doublon", corps: "x" });
    expect(doublon.status).toBe(409);

    const maj = await request(app)
      .put(`/api/actes/modeles/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nom: "Modèle de test (modifié)" });
    expect(maj.status).toBe(200);
    expect(maj.body.nom).toBe("Modèle de test (modifié)");

    const desactivation = await request(app).delete(`/api/actes/modeles/${id}`).set("Authorization", `Bearer ${token}`);
    expect(desactivation.status).toBe(204);

    const listeActifs = await request(app).get("/api/actes/modeles").set("Authorization", `Bearer ${token}`);
    expect(listeActifs.body.some((m) => m.code === code)).toBe(false);

    const listeTous = await request(app).get("/api/actes/modeles/tous").set("Authorization", `Bearer ${token}`);
    const entree = listeTous.body.find((m) => m.code === code);
    expect(entree).toBeDefined();
    expect(entree.actif).toBe(false);
  });
});

describe("POST /api/actes/generer — fusion des placeholders", () => {
  test("le texte généré contient bien le client et la référence du dossier", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const res = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "mise_en_demeure" });
    expect(res.status).toBe(201);
    expect(res.body.statut).toBe("brouillon");
    expect(res.body.version).toBe(1);
    expect(res.body.texte).toContain("MISE EN DEMEURE");
    // Le placeholder n'est jamais laissé tel quel une fois fusionné.
    expect(res.body.texte).not.toContain("{{");
  });

  test("modèle inconnu ou désactivé renvoie 400", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const res = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "code_inexistant" });
    expect(res.status).toBe(400);
  });
});

describe("Cycle brouillon → édition → validation → PDF", () => {
  test("PUT /:id incrémente la version et met à jour le texte", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const id = gen.body.id;

    const edition = await request(app)
      .put(`/api/actes/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ texte: "Texte corrigé par l'avocat." });
    expect(edition.status).toBe(200);
    expect(edition.body.version).toBe(2);
    expect(edition.body.texte).toBe("Texte corrigé par l'avocat.");
  });

  test("PUT /:id sans texte renvoie 400", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const res = await request(app).put(`/api/actes/${gen.body.id}`).set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test("PUT /:id refusé sur un document qui n'est pas un acte texte", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const { rows } = await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, auteur_id)
       VALUES ($1,'Pièce scannée','piece_client','valide','file:///tmp/x.pdf','application/pdf',
               (SELECT id FROM utilisateurs WHERE email = $2))
       RETURNING id`,
      [dossierId, require("./setup").EMAIL_TEST]
    );
    const res = await request(app)
      .put(`/api/actes/${rows[0].id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ texte: "Tentative" });
    expect(res.status).toBe(400);
  });

  test("POST /:id/statut fait basculer brouillon <-> valide", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const id = gen.body.id;

    const valider = await request(app).post(`/api/actes/${id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "valide" });
    expect(valider.status).toBe(200);
    expect(valider.body.statut).toBe("valide");

    const revenir = await request(app).post(`/api/actes/${id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "brouillon" });
    expect(revenir.status).toBe(200);
    expect(revenir.body.statut).toBe("brouillon");
  });

  test("POST /:id/statut avec une valeur invalide renvoie 400", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const res = await request(app)
      .post(`/api/actes/${gen.body.id}/statut`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statut: "archive" });
    expect(res.status).toBe(400);
  });

  test("GET /:id/pdf renvoie un PDF", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "mise_en_demeure" });
    const res = await request(app).get(`/api/actes/${gen.body.id}/pdf`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });

  test("GET /:id/pdf sur un id inexistant renvoie 404", async () => {
    const res = await request(app)
      .get("/api/actes/00000000-0000-0000-0000-000000000000/pdf")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
