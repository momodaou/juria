// JURIA — réinitialisation de mot de passe en libre-service (31/08/2026).
//
// Le jeton envoyé au client n'est jamais stocké en clair (seul son hash est
// en base) — impossible pour un test de le relire directement en base
// comme pour d'autres flux. On simule l'envoi d'e-mail (mailer.envoyerEmail
// mocké) pour intercepter le lien réellement composé par la route et en
// extraire le jeton, exactement comme le ferait l'utilisateur en cliquant
// dans son e-mail.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

function extraireJeton(html) {
  const m = html.match(/token=([a-f0-9]+)/);
  return m ? m[1] : null;
}

beforeAll(async () => {
  await assurerUtilisateurTest();
});

beforeEach(() => {
  envoyerEmail.mockClear();
});

afterAll(async () => {
  await pool.end();
});

describe("Réinitialisation de mot de passe", () => {
  test("adresse inconnue : réponse générique 200, aucun e-mail envoyé (anti-énumération)", async () => {
    const res = await request(app)
      .post("/auth/mot-de-passe-oublie")
      .send({ email: "inconnu.jamais.utilise@jfcavocats-mali.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/Si un compte existe/);
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  test("adresse connue : e-mail envoyé, lien contient un jeton", async () => {
    const res = await request(app).post("/auth/mot-de-passe-oublie").send({ email: EMAIL_TEST });
    expect(res.status).toBe(200);
    expect(envoyerEmail).toHaveBeenCalledTimes(1);
    const appelArgs = envoyerEmail.mock.calls[0][0];
    expect(appelArgs.to).toBe(EMAIL_TEST);
    expect(extraireJeton(appelArgs.html)).toBeTruthy();
  });

  test("parcours complet : réinitialisation avec le jeton reçu, puis connexion avec le nouveau mot de passe", async () => {
    await request(app).post("/auth/mot-de-passe-oublie").send({ email: EMAIL_TEST });
    const jeton = extraireJeton(envoyerEmail.mock.calls[0][0].html);

    const nouveauMdp = "NouveauMdp123!";
    const reinit = await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: jeton, nouveau_mot_de_passe: nouveauMdp });
    expect(reinit.status).toBe(200);

    const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: nouveauMdp });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();

    // Remet le mot de passe de test dans son état attendu par les autres
    // suites (assurerUtilisateurTest ne le referait pas tant que l'email
    // existe déjà — évite de casser regression.test.js/finance.test.js…
    // exécutés dans le même run).
    await request(app).post("/auth/mot-de-passe-oublie").send({ email: EMAIL_TEST });
    const jetonRestauration = extraireJeton(envoyerEmail.mock.calls[envoyerEmail.mock.calls.length - 1][0].html);
    await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: jetonRestauration, nouveau_mot_de_passe: MDP_TEST });
  });

  test("jeton déjà utilisé : refusé au 2ᵉ essai (anti-double-déclenchement)", async () => {
    await request(app).post("/auth/mot-de-passe-oublie").send({ email: EMAIL_TEST });
    const jeton = extraireJeton(envoyerEmail.mock.calls[envoyerEmail.mock.calls.length - 1][0].html);

    const premier = await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: jeton, nouveau_mot_de_passe: "Temporaire123!" });
    expect(premier.status).toBe(200);

    const second = await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: jeton, nouveau_mot_de_passe: "AutreMdp456!" });
    expect(second.status).toBe(400);

    // Restaure le mot de passe de test.
    await request(app).post("/auth/mot-de-passe-oublie").send({ email: EMAIL_TEST });
    const jetonRestauration = extraireJeton(envoyerEmail.mock.calls[envoyerEmail.mock.calls.length - 1][0].html);
    await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: jetonRestauration, nouveau_mot_de_passe: MDP_TEST });
  });

  test("jeton invalide/inexistant : refusé", async () => {
    const res = await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: "jeton-inexistant-0123456789", nouveau_mot_de_passe: "PeuImporte123!" });
    expect(res.status).toBe(400);
  });

  test("nouveau mot de passe trop court : refusé (validation serveur)", async () => {
    await request(app).post("/auth/mot-de-passe-oublie").send({ email: EMAIL_TEST });
    const jeton = extraireJeton(envoyerEmail.mock.calls[envoyerEmail.mock.calls.length - 1][0].html);
    const res = await request(app)
      .post("/auth/reinitialiser-mot-de-passe")
      .send({ token: jeton, nouveau_mot_de_passe: "court" });
    expect(res.status).toBe(400);
  });
});
