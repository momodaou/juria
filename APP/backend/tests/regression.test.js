// JURIA — tests de non-régression ciblés.
//
// Contexte : le 17/08/2026, un audit a trouvé le même bug dans 6 fichiers de
// routes différents, découvert uniquement en testant manuellement à la main :
// un COALESCE($n, 'litteral') ou CASE WHEN $n = 'litteral' sur une colonne
// ENUM ou UUID PostgreSQL, sans cast explicite, fait échouer la requête dès
// que le champ optionnel correspondant est omis par le client (erreur
// « column is of type X but expression is of type text »).
//
// Ce fichier ne vise pas une couverture exhaustive de l'API : il fige un
// filet de sécurité précis pour CE motif de bug précis, sur les routes qui
// l'ont déjà eu — pour qu'il ne puisse plus revenir sans qu'un test rouge
// ne le signale immédiatement.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
let userId;
let clientId;
let dossierId;

beforeAll(async () => {
  await assurerUtilisateurTest();

  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;

  const client = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: "Client Test Régression" });
  clientId = client.body.id;

  const dossier = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `TREG-${Date.now()}`,
      intitule: "Dossier fixture régression",
      client_id: clientId,
      pole: "contentieux",
      responsable_id: userId,
    });
  dossierId = dossier.body.id;
});

afterAll(async () => {
  await pool.end();
});

describe("Connexion", () => {
  test("refuse un mauvais mot de passe", async () => {
    const res = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: "faux-mot-de-passe" });
    expect(res.status).toBe(401);
  });

  test("accepte les bons identifiants", async () => {
    const res = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });
});

describe("Régression — champs enum/UUID optionnels omis", () => {
  test("POST /api/dossiers sans urgence (bug d'origine)", async () => {
    const res = await request(app)
      .post("/api/dossiers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        numero: `TREG-D-${Date.now()}`,
        intitule: "Dossier sans urgence explicite",
        client_id: clientId,
        pole: "contentieux",
        responsable_id: userId,
      });
    expect(res.status).toBe(201);
  });

  test("POST /api/taches sans type/priorite/responsable", async () => {
    const res = await request(app)
      .post("/api/taches")
      .set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche minimale" });
    expect(res.status).toBe(201);
  });

  test("POST /api/roles-audience/lignes sans type/avocat", async () => {
    const res = await request(app)
      .post("/api/roles-audience/lignes")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-01" });
    expect(res.status).toBe(201);
  });

  test("POST /api/courriers sans support/imputation", async () => {
    const res = await request(app)
      .post("/api/courriers")
      .set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Correspondant test" });
    expect(res.status).toBe(201);
  });

  test("POST /api/documents sans categorie/confidentialite", async () => {
    const res = await request(app)
      .post("/api/documents")
      .set("Authorization", `Bearer ${token}`)
      .field("dossier_id", dossierId)
      .attach("fichier", Buffer.from("contenu de test"), "test.txt");
    expect(res.status).toBe(201);
  });

  test("POST /api/cabinet/conges sans utilisateur_id (demande pour soi-même)", async () => {
    const res = await request(app)
      .post("/api/cabinet/conges")
      .set("Authorization", `Bearer ${token}`)
      .send({ date_debut: "2026-12-01", date_fin: "2026-12-05" });
    expect(res.status).toBe(201);
  });
});
