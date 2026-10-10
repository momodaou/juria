// JURIA — 10/10/2026, Bloc D du diagnostic "instruction avocat ->
// collaborateur" (voir CLAUDE.md/HISTORY.md) : qui peut confier une tâche
// à quelqu'un d'autre. L'auto-assignation reste toujours libre pour tous ;
// seule la délégation à un tiers est restreinte :
// - un avocat peut confier n'importe quel type de tâche à n'importe qui ;
// - un juriste (collaborateur non-avocat) peut confier uniquement des
//   tâches administratives (dépôt, facturation, relance, collecte de
//   pièces, autre) à un stagiaire non-avocat ou à l'assistante ;
// - tout autre profil ne peut déléguer à personne.
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
  const email = `test.blocd.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestBlocD123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','BlocD',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`D${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test BlocD" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: t };
}

describe("POST /api/taches — délégation réservée aux avocats (sauf exceptions juriste)", () => {
  test("un associé peut confier n'importe quel type de tâche à n'importe qui", async () => {
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Recherche confiée par associé", type: "recherche", responsable_id: stagiaire.id });
    expect(res.status).toBe(201);
  });

  test("un avocat collaborateur peut confier une tâche à un juriste", async () => {
    const avocat = await creerUtilisateurRole("collaborateur");
    const juriste = await creerUtilisateurRole("juriste");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${avocat.token}`)
      .send({ titre: "Revue confiée à un juriste", type: "revue", responsable_id: juriste.id });
    expect(res.status).toBe(201);
  });

  test("un juriste peut confier une tâche administrative à un stagiaire non-avocat", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Dépôt confié par juriste", type: "depot", responsable_id: stagiaire.id });
    expect(res.status).toBe(201);
  });

  test("un juriste peut confier une tâche administrative à l'assistante", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const assistante = await creerUtilisateurRole("assistante");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Relance confiée par juriste", type: "relance", responsable_id: assistante.id });
    expect(res.status).toBe(201);
  });

  test("sans type fourni (défaut 'autre'), un juriste peut déléguer à un stagiaire", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Sans type explicite", responsable_id: stagiaire.id });
    expect(res.status).toBe(201);
  });

  test("un juriste ne peut PAS confier une tâche de type 'recherche' (réservée aux avocats pour déléguer)", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Recherche refusée", type: "recherche", responsable_id: stagiaire.id });
    expect(res.status).toBe(403);
  });

  test("un juriste ne peut PAS confier une tâche à un autre juriste (même administrative)", async () => {
    const juriste1 = await creerUtilisateurRole("juriste");
    const juriste2 = await creerUtilisateurRole("juriste");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste1.token}`)
      .send({ titre: "Dépôt vers un autre juriste", type: "depot", responsable_id: juriste2.id });
    expect(res.status).toBe(403);
  });

  test("un juriste ne peut PAS confier une tâche à un avocat", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const avocat = await creerUtilisateurRole("collaborateur");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Dépôt vers un avocat", type: "depot", responsable_id: avocat.id });
    expect(res.status).toBe(403);
  });

  // admin_general (et non comptable, qui n'a pas du tout taches.creer par
  // défaut — voir CLAUDE.md) : a bien le droit de créer une tâche, mais
  // n'est ni avocat ni juriste — sert ici à isoler la règle de délégation
  // elle-même du simple contrôle d'accès à la création.
  test("un profil ne pouvant pas déléguer (admin général) ne peut confier une tâche à personne d'autre", async () => {
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${adminGeneral.token}`)
      .send({ titre: "Tâche refusée", type: "autre", responsable_id: stagiaire.id });
    expect(res.status).toBe(403);
  });

  test("l'auto-assignation reste toujours libre, quel que soit le rôle et le type", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Auto-assignée", type: "recherche", responsable_id: juriste.id });
    expect(res.status).toBe(201);

    const adminGeneral = await creerUtilisateurRole("admin_general");
    const resAdminGeneral = await request(app).post("/api/taches").set("Authorization", `Bearer ${adminGeneral.token}`)
      .send({ titre: "Auto-assignée admin général" });
    expect(resAdminGeneral.status).toBe(201);
  });
});

describe("PUT /api/taches/:id/details — même règle à la réassignation", () => {
  test("un juriste ne peut pas réassigner une tâche à un avocat", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const avocat = await creerUtilisateurRole("collaborateur");
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Tâche à réassigner", type: "depot" });
    expect(creation.status).toBe(201);

    const res = await request(app).put(`/api/taches/${creation.body.id}/details`).set("Authorization", `Bearer ${juriste.token}`)
      .send({ responsable_id: avocat.id });
    expect(res.status).toBe(403);
  });

  test("un juriste ne peut pas changer le type vers 'recherche' d'une tâche déjà déléguée à un stagiaire", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Tâche déléguée", type: "depot", responsable_id: stagiaire.id });
    expect(creation.status).toBe(201);

    const res = await request(app).put(`/api/taches/${creation.body.id}/details`).set("Authorization", `Bearer ${juriste.token}`)
      .send({ type: "recherche" });
    expect(res.status).toBe(403);
  });

  test("un juriste peut librement changer le type d'une tâche qu'il s'est auto-assignée", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${juriste.token}`)
      .send({ titre: "Tâche personnelle", type: "depot" });
    expect(creation.status).toBe(201);

    const res = await request(app).put(`/api/taches/${creation.body.id}/details`).set("Authorization", `Bearer ${juriste.token}`)
      .send({ type: "recherche" });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe("recherche");
  });
});
