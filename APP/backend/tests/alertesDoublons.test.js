// JURIA — 12/10/2026, rappel actif sur les doublons potentiels (filet de
// sécurité jusqu'ici purement passif, voir ../src/jobs/alertesDoublons.js).
// Destinataires calculés depuis permissions_role (action
// parametres.cabinet.modifier), pas une liste de rôles recopiée à la main.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));
const bcrypt = require("bcryptjs");
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { executerJobAlertesDoublons } = require("../src/jobs/alertesDoublons");
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

async function creerClient(denomination) {
  const res = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination });
  return res.body.id;
}

test("un doublon de client détecté déclenche un e-mail à qui a parametres.cabinet.modifier (associé)", async () => {
  envoyerEmail.mockClear();
  const denomination = `Doublon Job Test ${Date.now()}`;
  await creerClient(denomination);
  await creerClient(denomination);

  const resultat = await executerJobAlertesDoublons(pool);
  expect(resultat.doublons).toBeGreaterThanOrEqual(1);
  expect(resultat.destinataires).toBeGreaterThanOrEqual(1);
  expect(resultat.mails_envoyes).toBeGreaterThanOrEqual(1);

  const appel = envoyerEmail.mock.calls.find((c) => c[0].html.includes(denomination));
  expect(appel).toBeDefined();
});

test("un rôle sans parametres.cabinet.modifier (collaborateur) ne reçoit jamais ce rappel", async () => {
  envoyerEmail.mockClear();
  const email = `test.doublons.job.${Date.now()}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestDoublonsJob123!", 10);
  await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ('TDJ','Test','DoublonsJob',$1,$2,'collaborateur',TRUE,now())`,
    [email, hash]
  );
  const denomination = `Doublon Job Test 2 ${Date.now()}`;
  await creerClient(denomination);
  await creerClient(denomination);

  await executerJobAlertesDoublons(pool);
  const appelsVersCollaborateur = envoyerEmail.mock.calls.filter((c) => c[0].to === email);
  expect(appelsVersCollaborateur.length).toBe(0);
});
