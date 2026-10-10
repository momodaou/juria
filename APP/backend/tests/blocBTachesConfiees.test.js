// JURIA — 10/10/2026, Bloc B du diagnostic "instruction avocat ->
// collaborateur" (voir CLAUDE.md/HISTORY.md) : tuile "Tâches que j'ai
// confiées" (symétrique de "Mes tâches" côté donneur d'instruction) +
// job d'alerte quotidien sur les tâches en retard (un e-mail personnalisé
// par destinataire, pas de diffusion collective).
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { executerJobAlertesTachesRetard } = require("../src/jobs/alertesTachesRetard");
const { envoyerEmail } = require("../src/mailer");

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
  const email = `test.blocb.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestBlocB123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','BlocB',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`B${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test BlocB" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, email, token: t };
}

function appelsVers(email) {
  return envoyerEmail.mock.calls.filter((c) => c[0].to === email);
}

describe("Tableau de bord — tuile « Tâches que j'ai confiées »", () => {
  test("une tâche confiée à quelqu'un d'autre apparaît dans le compte et l'aperçu", async () => {
    const assigne = await creerUtilisateurRole("collaborateur");
    const avant = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche confiée à un collaborateur", responsable_id: assigne.id });
    expect(creation.status).toBe(201);

    const apres = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(apres.body.taches_confiees_n).toBe(avant.body.taches_confiees_n + 1);
    expect(apres.body.taches_confiees_apercu.some((t) => t.id === creation.body.id)).toBe(true);

    const detail = await request(app).get("/api/dashboard/detail/taches_confiees").set("Authorization", `Bearer ${token}`);
    const ligne = detail.body.find((t) => t.id === creation.body.id);
    expect(ligne).toBeTruthy();
    expect(ligne.responsable).toBe("Test BlocB");
  });

  test("une tâche auto-assignée n'apparaît PAS dans « Tâches que j'ai confiées »", async () => {
    const avant = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche auto-assignée", responsable_id: userId });
    expect(creation.status).toBe(201);

    const apres = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(apres.body.taches_confiees_n).toBe(avant.body.taches_confiees_n);
  });
});

describe("Job alertesTachesRetard — un e-mail personnalisé par destinataire", () => {
  test("le responsable ET le créateur (différent) d'une tâche en retard reçoivent chacun un e-mail", async () => {
    envoyerEmail.mockClear();
    const assigne = await creerUtilisateurRole("collaborateur");
    const createur = await creerUtilisateurRole("juriste");
    await pool.query(
      `INSERT INTO taches (titre, statut, echeance, responsable_id, cree_par)
       VALUES ('Tâche en retard test', 'a_faire', current_date - 3, $1, $2)`,
      [assigne.id, createur.id]
    );

    const resultat = await executerJobAlertesTachesRetard(pool);
    expect(resultat.taches_en_retard).toBeGreaterThanOrEqual(1);

    expect(appelsVers(assigne.email).length).toBe(1);
    expect(appelsVers(assigne.email)[0][0].html).toContain("qui vous sont assignées");
    expect(appelsVers(assigne.email)[0][0].html).toContain("Tâche en retard test");

    expect(appelsVers(createur.email).length).toBe(1);
    expect(appelsVers(createur.email)[0][0].html).toContain("que vous avez confiées");
    expect(appelsVers(createur.email)[0][0].html).toContain("Test BlocB"); // nom du responsable mentionné
  });

  test("une tâche auto-assignée en retard ne génère qu'un seul e-mail (pas de doublon assignée/confiée)", async () => {
    envoyerEmail.mockClear();
    const solo = await creerUtilisateurRole("collaborateur");
    await pool.query(
      `INSERT INTO taches (titre, statut, echeance, responsable_id, cree_par)
       VALUES ('Tâche solo en retard', 'a_faire', current_date - 1, $1, $1)`,
      [solo.id]
    );

    await executerJobAlertesTachesRetard(pool);
    expect(appelsVers(solo.email).length).toBe(1);
    const html = appelsVers(solo.email)[0][0].html;
    expect(html).toContain("qui vous sont assignées");
    expect(html).not.toContain("que vous avez confiées");
  });

  test("une tâche dont l'échéance n'est pas encore passée ne déclenche rien", async () => {
    envoyerEmail.mockClear();
    const futur = await creerUtilisateurRole("collaborateur");
    await pool.query(
      `INSERT INTO taches (titre, statut, echeance, responsable_id, cree_par)
       VALUES ('Tâche future', 'a_faire', current_date + 5, $1, $1)`,
      [futur.id]
    );

    await executerJobAlertesTachesRetard(pool);
    expect(appelsVers(futur.email).length).toBe(0);
  });

  test("une tâche terminée ou annulée en retard ne déclenche rien", async () => {
    envoyerEmail.mockClear();
    const termine = await creerUtilisateurRole("collaborateur");
    await pool.query(
      `INSERT INTO taches (titre, statut, echeance, responsable_id, cree_par)
       VALUES ('Tâche terminée en retard', 'termine', current_date - 2, $1, $1)`,
      [termine.id]
    );

    await executerJobAlertesTachesRetard(pool);
    expect(appelsVers(termine.email).length).toBe(0);
  });
});
