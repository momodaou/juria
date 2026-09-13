// JURIA — messagerie interne : présence, indicateur de frappe, accusé de
// lecture et notification e-mail (13/09/2026, demande différée le
// 11/09/2026, reprise après l'audit du 13/09/2026 — 1ʳᵉ suite de tests
// pour ce module, jusqu'ici jamais couvert explicitement).
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { executerJobMessagerieNotifications } = require("../src/jobs/messagerieNotifications");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, moiId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  moiId = login.body.utilisateur.id;
});

afterEach(() => {
  envoyerEmail.mockClear();
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateur() {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const res = await request(app)
    .post("/api/acces/utilisateurs")
    .set("Authorization", `Bearer ${token}`)
    .send({ code: `M${suffixe.slice(0, 7)}`, prenom: "Test", nom: "Messagerie", email: `test.msg.${suffixe}@jfcavocats-mali.com`, role: "collaborateur" });
  await request(app).post(`/api/acces/utilisateurs/${res.body.id}/valider`).set("Authorization", `Bearer ${token}`);
  return res.body.id;
}

async function creerConversation(autreId) {
  const res = await request(app)
    .post("/api/messagerie/conversations")
    .set("Authorization", `Bearer ${token}`)
    .send({ participants: [autreId] });
  return res.body.id;
}

describe("Présence — GET /api/utilisateurs expose en_ligne", () => {
  test("false sans ligne de présence", async () => {
    const id = await creerUtilisateur();
    const res = await request(app).get("/api/utilisateurs").set("Authorization", `Bearer ${token}`);
    const u = res.body.find((x) => x.id === id);
    expect(u.en_ligne).toBe(false);
  });

  test("true avec une activité récente, false si périmée (>45s)", async () => {
    const id = await creerUtilisateur();
    await pool.query("INSERT INTO presence_utilisateurs (utilisateur_id, derniere_activite) VALUES ($1, now())", [id]);
    let res = await request(app).get("/api/utilisateurs").set("Authorization", `Bearer ${token}`);
    expect(res.body.find((x) => x.id === id).en_ligne).toBe(true);

    await pool.query(
      "UPDATE presence_utilisateurs SET derniere_activite = now() - interval '1 minute' WHERE utilisateur_id = $1",
      [id]
    );
    res = await request(app).get("/api/utilisateurs").set("Authorization", `Bearer ${token}`);
    expect(res.body.find((x) => x.id === id).en_ligne).toBe(false);
  });
});

describe("Indicateur de frappe — POST /conversations/:id/frappe", () => {
  test("204 pour un participant", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);
    const res = await request(app)
      .post(`/api/messagerie/conversations/${convId}/frappe`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  test("403 pour un non-participant", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);
    const tiers = await creerUtilisateur();
    // Un jeton signé directement (même pratique que les autres fichiers de
    // tests de cette suite) plutôt qu'un login réel — le mot de passe
    // temporaire du tiers n'est pas récupérable ici sans le stocker.
    const jwt = require("jsonwebtoken");
    const { SECRET } = require("../src/auth");
    const jetonTiers = jwt.sign({ sub: tiers, role: "collaborateur", nom: "Tiers" }, SECRET, { expiresIn: "1h" });
    const res = await request(app)
      .post(`/api/messagerie/conversations/${convId}/frappe`)
      .set("Authorization", `Bearer ${jetonTiers}`);
    expect(res.status).toBe(403);
  });
});

describe("Accusé de lecture — GET .../lecture + POST .../lu", () => {
  test("dernier_lu_le null avant lecture, renseigné après", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);

    const avant = await request(app)
      .get(`/api/messagerie/conversations/${convId}/lecture`)
      .set("Authorization", `Bearer ${token}`);
    expect(avant.body).toEqual([{ utilisateur_id: autreId, dernier_lu_le: null }]);

    const jwt = require("jsonwebtoken");
    const { SECRET } = require("../src/auth");
    const jetonAutre = jwt.sign({ sub: autreId, role: "collaborateur", nom: "Autre" }, SECRET, { expiresIn: "1h" });
    await request(app).post(`/api/messagerie/conversations/${convId}/lu`).set("Authorization", `Bearer ${jetonAutre}`);

    const apres = await request(app)
      .get(`/api/messagerie/conversations/${convId}/lecture`)
      .set("Authorization", `Bearer ${token}`);
    expect(apres.body[0].utilisateur_id).toBe(autreId);
    expect(apres.body[0].dernier_lu_le).not.toBeNull();
  });
});

describe("Job de notification e-mail (13/09/2026)", () => {
  test("envoie un e-mail groupé pour un message non lu depuis >10 min, destinataire hors ligne", async () => {
    const destId = await creerUtilisateur();
    const convId = await creerConversation(destId);
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Message de test job" });
    // Recule artificiellement le message de 15 min (le job ne notifie qu'à
    // partir de 10 min) — pas d'autre moyen de tester ce délai sans attendre.
    await pool.query("UPDATE messages SET cree_le = now() - interval '15 minutes' WHERE conversation_id = $1", [convId]);

    const resultat = await executerJobMessagerieNotifications(pool);
    expect(resultat.notifies).toBeGreaterThanOrEqual(1);
    expect(envoyerEmail).toHaveBeenCalled();

    // Ne renotifie pas immédiatement tant que le destinataire n'a pas lu
    // (dernier_email_notifie_le vient d'être posé, reste > dernier_lu_le).
    envoyerEmail.mockClear();
    const resultat2 = await executerJobMessagerieNotifications(pool);
    expect(resultat2.notifies).toBe(0);
  });

  test("ne notifie pas un destinataire actuellement en ligne", async () => {
    const destId = await creerUtilisateur();
    const convId = await creerConversation(destId);
    await pool.query("INSERT INTO presence_utilisateurs (utilisateur_id, derniere_activite) VALUES ($1, now())", [destId]);
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Message pendant que le destinataire est en ligne" });
    await pool.query("UPDATE messages SET cree_le = now() - interval '15 minutes' WHERE conversation_id = $1", [convId]);

    envoyerEmail.mockClear();
    await executerJobMessagerieNotifications(pool);
    // Le destinataire de cette conversation précise ne doit pas avoir reçu
    // d'e-mail (d'autres candidats issus de tests précédents peuvent
    // exister dans la même base, d'où la vérification ciblée sur l'email).
    const utilisateur = await pool.query("SELECT email FROM utilisateurs WHERE id = $1", [destId]);
    const recut = envoyerEmail.mock.calls.some((c) => c[0].to === utilisateur.rows[0].email);
    expect(recut).toBe(false);
  });
});
