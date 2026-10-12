// JURIA — 12/10/2026, correction de la règle du 21/09/2026 (« tout le
// monde peut être audiencier, avocat ou non avocat ») : administrateur
// général, administrateur IT et assistante ne peuvent plus être désignés
// audiencier (ni à la création d'une ligne de rôle, ni en correction),
// voir CLAUDE.md et le registre des notifications. Ils continuent
// normalement de recevoir la diffusion e-mail du rôle — règle distincte,
// non testée ici (déjà couverte par diffuserRole.test.js).
const bcrypt = require("bcryptjs");
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, userId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const email = `test.audiencier.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestAudiencier123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Audiencier',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`A${suffixe.slice(0, 7)}`, email, hash, role]
  );
  return rows[0].id;
}

async function creerDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client audiencier ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test audiencier", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("POST /api/roles-audience/lignes — garde audiencier", () => {
  test.each(["admin_general", "admin_it", "assistante"])(
    "refuse %s comme audiencier à la création",
    async (role) => {
      const dossierId = await creerDossier();
      const exclu = await creerUtilisateurRole(role);
      const res = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
        .send({ dossier_id: dossierId, date_prevue: "2032-01-12", type: "mise_en_etat", avocat_id: exclu });
      expect(res.status).toBe(400);
    }
  );

  test("accepte un avocat comme audiencier", async () => {
    const dossierId = await creerDossier();
    const avocat = await creerUtilisateurRole("collaborateur");
    const res = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2032-01-13", type: "mise_en_etat", avocat_id: avocat });
    expect(res.status).toBe(201);
  });

  test("sans avocat_id (facultatif) : toujours accepté", async () => {
    const dossierId = await creerDossier();
    const res = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2032-01-14", type: "mise_en_etat" });
    expect(res.status).toBe(201);
  });
});

describe("PUT /api/roles-audience/audiences/:id — garde audiencier", () => {
  test("refuse une correction désignant un administrateur IT comme audiencier", async () => {
    const dossierId = await creerDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2032-01-15", type: "mise_en_etat" });
    const exclu = await creerUtilisateurRole("admin_it");
    const res = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`).send({ avocat_id: exclu });
    expect(res.status).toBe(400);
  });
});
