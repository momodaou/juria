// JURIA — imputation du responsable d'un dossier à un profil subordonné
// (30/08/2026, précision explicite de l'utilisateur, suite de l'exercice
// « pour chaque profil ») : « seul l'avocat associé peut imputer un
// dossier à un profil [Of Counsel, collaborateur, avocat stagiaire,
// juriste, stagiaire], sur tout dossier, classique ou pro bono. »
//
// Un collaborateur garde la capacité de CRÉER un dossier (dossiers.creer
// reste ouvert) — il ne peut simplement pas se désigner, ni désigner un
// autre profil subordonné, comme responsable : ce choix doit venir d'un
// compte associé. Aucune restriction sur les profils hors de cette liste
// (associé lui-même, rôles administratifs).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestImputation123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Imputation',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`I${suffixe.slice(0, 7)}`, `test.imputation.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jetons = jwt.sign({ sub: rows[0].id, role, nom: "Test Imputation" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jetons };
}

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client imputation ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

function creerDossier(tokenAppelant, payload) {
  return request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${tokenAppelant}`)
    .send({
      numero: `IMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test imputation",
      pole: "contentieux",
      ...payload,
    });
}

describe("Imputation du responsable — réservée aux associés pour les profils subordonnés (30/08/2026)", () => {
  test.each(["of_counsel", "collaborateur", "avocat_stagiaire", "juriste", "stagiaire"])(
    "%s ne peut pas se désigner lui-même comme responsable (403)",
    async (role) => {
      const clientId = await creerClient();
      const utilisateur = await creerUtilisateurRole(role);
      const res = await creerDossier(utilisateur.token, { client_id: clientId, responsable_id: utilisateur.id });
      expect(res.status).toBe(403);
    }
  );

  test("un collaborateur ne peut pas désigner un autre collaborateur comme responsable (403)", async () => {
    const clientId = await creerClient();
    const collaborateur1 = await creerUtilisateurRole("collaborateur");
    const collaborateur2 = await creerUtilisateurRole("collaborateur");
    const res = await creerDossier(collaborateur1.token, { client_id: clientId, responsable_id: collaborateur2.id });
    expect(res.status).toBe(403);
  });

  test("un collaborateur PEUT créer un dossier en désignant un associé comme responsable (201)", async () => {
    const clientId = await creerClient();
    const collaborateur = await creerUtilisateurRole("collaborateur");
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(collaborateur.token, { client_id: clientId, responsable_id: associe.id });
    expect(res.status).toBe(201);
  });

  test("un associé peut imputer un dossier à un profil subordonné (201)", async () => {
    const clientId = await creerClient();
    const collaborateur = await creerUtilisateurRole("collaborateur");
    const res = await creerDossier(token, { client_id: clientId, responsable_id: collaborateur.id });
    expect(res.status).toBe(201);
  });

  test("aucune restriction hors des 5 profils listés (ex. admin_general)", async () => {
    const clientId = await creerClient();
    const admin = await creerUtilisateurRole("admin_general");
    const res = await creerDossier(admin.token, { client_id: clientId, responsable_id: admin.id });
    expect(res.status).toBe(201);
  });

  test("PUT /api/dossiers/:id : réattribution à un profil subordonné refusée pour un non-associé", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    expect(creation.status).toBe(201);

    const collaborateur = await creerUtilisateurRole("collaborateur");
    const maj = await request(app)
      .put(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${collaborateur.token}`)
      .send({ responsable_id: collaborateur.id });
    expect(maj.status).toBe(403);
  });

  test("PUT /api/dossiers/:id : un dossier pro bono reste réservé à un responsable associé, même en réattribution par un associé", async () => {
    const clientId = await creerClient();
    const associe1 = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe1.id, pro_bono: true });
    expect(creation.status).toBe(201);

    const collaborateur = await creerUtilisateurRole("collaborateur");
    const maj = await request(app)
      .put(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`) // token = associe (test principal)
      .send({ responsable_id: collaborateur.id });
    expect(maj.status).toBe(400);
  });
});
