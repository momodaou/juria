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
  test("n'envoie PAS d'e-mail pour un message isolé (Bonjour) sans relance, même après 10 min hors ligne", async () => {
    const destId = await creerUtilisateur();
    const convId = await creerConversation(destId);
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Bonjour" });
    await pool.query("UPDATE messages SET cree_le = now() - interval '15 minutes' WHERE conversation_id = $1", [convId]);

    envoyerEmail.mockClear();
    await executerJobMessagerieNotifications(pool);
    const utilisateur = await pool.query("SELECT email FROM utilisateurs WHERE id = $1", [destId]);
    const recut = envoyerEmail.mock.calls.some((c) => c[0].to === utilisateur.rows[0].email);
    expect(recut).toBe(false);
  });

  test("envoie un e-mail pour un SEUL message marqué important, sans attendre un 2e message", async () => {
    const destId = await creerUtilisateur();
    const convId = await creerConversation(destId);
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Merci de rappeler le client avant 17h", important: true });
    await pool.query("UPDATE messages SET cree_le = now() - interval '15 minutes' WHERE conversation_id = $1", [convId]);

    envoyerEmail.mockClear();
    const resultat = await executerJobMessagerieNotifications(pool);
    expect(resultat.notifies).toBeGreaterThanOrEqual(1);
    const utilisateur = await pool.query("SELECT email FROM utilisateurs WHERE id = $1", [destId]);
    const recut = envoyerEmail.mock.calls.some((c) => c[0].to === utilisateur.rows[0].email);
    expect(recut).toBe(true);
  });

  test("envoie un e-mail groupé à partir de 2 messages non lus depuis >10 min, destinataire hors ligne", async () => {
    const destId = await creerUtilisateur();
    const convId = await creerConversation(destId);
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Message de test job" });
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Relance sans réponse" });
    // Recule artificiellement les messages de 15 min (le job ne notifie qu'à
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
    await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Deuxième message, toujours en ligne" });
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

describe("Masquer / archiver / supprimer une conversation (13/09/2026, personnel)", () => {
  test("masquer retire la conversation de ma liste, sans effet chez l'autre participant", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);

    const jwt = require("jsonwebtoken");
    const { SECRET } = require("../src/auth");
    const jetonAutre = jwt.sign({ sub: autreId, role: "collaborateur", nom: "Autre" }, SECRET, { expiresIn: "1h" });

    const masquer = await request(app).post(`/api/messagerie/conversations/${convId}/masquer`).set("Authorization", `Bearer ${token}`);
    expect(masquer.status).toBe(204);

    const listeMoi = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    expect(listeMoi.body.some((c) => c.id === convId)).toBe(false);

    const listeAutre = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${jetonAutre}`);
    expect(listeAutre.body.some((c) => c.id === convId)).toBe(true);

    // Visible dans le rappel "masquées"
    const rappel = await request(app).get("/api/messagerie/conversations?masquees=true").set("Authorization", `Bearer ${token}`);
    expect(rappel.body.some((c) => c.id === convId)).toBe(true);

    // "Afficher" la fait revenir
    const afficher = await request(app).post(`/api/messagerie/conversations/${convId}/afficher`).set("Authorization", `Bearer ${token}`);
    expect(afficher.status).toBe(204);
    const listeApres = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    expect(listeApres.body.some((c) => c.id === convId)).toBe(true);
  });

  test("archiver disparaît puis réapparaît tout seul dès qu'un nouveau message arrive", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);

    await request(app).post(`/api/messagerie/conversations/${convId}/archiver`).set("Authorization", `Bearer ${token}`);
    const apresArchivage = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    expect(apresArchivage.body.some((c) => c.id === convId)).toBe(false);

    const jwt = require("jsonwebtoken");
    const { SECRET } = require("../src/auth");
    const jetonAutre = jwt.sign({ sub: autreId, role: "collaborateur", nom: "Autre" }, SECRET, { expiresIn: "1h" });
    await request(app).post(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${jetonAutre}`).send({ contenu: "Un nouveau message" });

    const apresNouveauMessage = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    expect(apresNouveauMessage.body.some((c) => c.id === convId)).toBe(true);
  });

  test("supprimer une conversation : réapparaît sur nouveau message, mais l'historique antérieur reste caché pour toujours", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);
    await request(app).post(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${token}`).send({ contenu: "Message avant suppression" });

    await request(app).post(`/api/messagerie/conversations/${convId}/supprimer`).set("Authorization", `Bearer ${token}`);
    const apresSuppression = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    expect(apresSuppression.body.some((c) => c.id === convId)).toBe(false);

    const jwt = require("jsonwebtoken");
    const { SECRET } = require("../src/auth");
    const jetonAutre = jwt.sign({ sub: autreId, role: "collaborateur", nom: "Autre" }, SECRET, { expiresIn: "1h" });
    await request(app).post(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${jetonAutre}`).send({ contenu: "Message après suppression" });

    // La conversation revient (jamais quittée)
    const apresNouveauMessage = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    expect(apresNouveauMessage.body.some((c) => c.id === convId)).toBe(true);

    // Mais l'historique d'avant la suppression reste invisible pour moi
    const messages = await request(app).get(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${token}`);
    const contenus = messages.body.map((m) => m.contenu);
    expect(contenus).not.toContain("Message avant suppression");
    expect(contenus).toContain("Message après suppression");

    // L'autre participant, lui, voit toujours tout
    const messagesAutre = await request(app).get(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${jetonAutre}`);
    expect(messagesAutre.body.map((m) => m.contenu)).toContain("Message avant suppression");
  });
});

describe("Supprimer un message précis (13/09/2026, personnel)", () => {
  test("masque le contenu chez moi uniquement, l'autre participant voit toujours le message", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);
    const envoi = await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Message à supprimer chez moi" });
    const messageId = envoi.body.id;

    const suppression = await request(app)
      .delete(`/api/messagerie/conversations/${convId}/messages/${messageId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(204);

    const mesMessages = await request(app).get(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${token}`);
    const mien = mesMessages.body.find((m) => m.id === messageId);
    expect(mien.masque).toBe(true);
    expect(mien.contenu).toBeNull();

    const jwt = require("jsonwebtoken");
    const { SECRET } = require("../src/auth");
    const jetonAutre = jwt.sign({ sub: autreId, role: "collaborateur", nom: "Autre" }, SECRET, { expiresIn: "1h" });
    const messagesAutre = await request(app).get(`/api/messagerie/conversations/${convId}/messages`).set("Authorization", `Bearer ${jetonAutre}`);
    const cheLAutre = messagesAutre.body.find((m) => m.id === messageId);
    expect(cheLAutre.masque).toBe(false);
    expect(cheLAutre.contenu).toBe("Message à supprimer chez moi");
  });

  test("404 sur un message inexistant, idempotent si déjà supprimé", async () => {
    const autreId = await creerUtilisateur();
    const convId = await creerConversation(autreId);
    const introuvable = await request(app)
      .delete(`/api/messagerie/conversations/${convId}/messages/00000000-0000-0000-0000-000000000000`)
      .set("Authorization", `Bearer ${token}`);
    expect(introuvable.status).toBe(404);

    const envoi = await request(app)
      .post(`/api/messagerie/conversations/${convId}/messages`)
      .set("Authorization", `Bearer ${token}`)
      .send({ contenu: "Message pour idempotence" });
    const messageId = envoi.body.id;
    const premiere = await request(app).delete(`/api/messagerie/conversations/${convId}/messages/${messageId}`).set("Authorization", `Bearer ${token}`);
    const seconde = await request(app).delete(`/api/messagerie/conversations/${convId}/messages/${messageId}`).set("Authorization", `Bearer ${token}`);
    expect(premiere.status).toBe(204);
    expect(seconde.status).toBe(204);
  });
});
