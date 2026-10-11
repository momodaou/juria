// JURIA — 11/10/2026 : « Diffuser » le rôle d'audience envoie désormais
// réellement un e-mail (avec le PDF du rôle en pièce jointe) à tout le
// personnel ACTIF du cabinet — jusqu'ici l'action ne faisait que basculer
// un statut (constat utilisateur : « l'option diffusée suppose un envoi
// mail à tous non ? »). Voir CLAUDE.md pour la synthèse de conception.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { envoyerEmail } = require("../src/mailer");

// Semaine aléatoire très lointaine (2030+) pour ne jamais entrer en
// collision avec les dates en dur utilisées par les autres fichiers de
// tests sur `roles_audience` (ex. resultatAudienceEtendu.test.js, déjà
// propriétaire de "2027-03-01"/"2027-03-08") — base partagée, jamais
// réinitialisée entre fichiers d'une même exécution de la suite complète.
function lundiAleatoire(decalageSemaines = 0) {
  const base = new Date(Date.UTC(2030, 0, 1));
  const joursAleatoires = Math.floor(Math.random() * 50000) + decalageSemaines * 7;
  const d = new Date(base.getTime() + joursAleatoires * 86400000);
  const jourSemaine = d.getUTCDay(); // 0=dim..6=sam
  const decalage = jourSemaine === 0 ? 1 : jourSemaine === 1 ? 0 : 8 - jourSemaine;
  d.setUTCDate(d.getUTCDate() + decalage);
  return d.toISOString().slice(0, 10);
}

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

async function creerClientEtDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client diffusion ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test diffusion rôle", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

async function compterDestinatairesActifs() {
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM utilisateurs WHERE actif");
  return rows[0].n;
}

describe("POST /api/roles-audience/:id/diffuser — envoi e-mail réel à tout le personnel actif", () => {
  test("envoie un e-mail (PDF joint) à tous les comptes actifs, et seulement une fois", async () => {
    envoyerEmail.mockClear();
    const dossierId = await creerClientEtDossier();
    const semaine = lundiAleatoire();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: semaine, juridiction: "TGI Test", type: "mise_en_etat" });
    expect(creation.status).toBe(201);
    const roleId = creation.body.role_id;

    const validation = await request(app).post(`/api/roles-audience/${roleId}/valider`).set("Authorization", `Bearer ${token}`);
    expect(validation.status).toBe(200);
    expect(validation.body.statut).toBe("valide");

    const nbActifs = await compterDestinatairesActifs();
    const diffusion = await request(app).post(`/api/roles-audience/${roleId}/diffuser`).set("Authorization", `Bearer ${token}`);
    expect(diffusion.status).toBe(200);
    expect(diffusion.body.statut).toBe("diffuse");
    expect(diffusion.body.destinataires).toBe(nbActifs);
    expect(diffusion.body.mails_envoyes).toBe(nbActifs);
    expect(envoyerEmail).toHaveBeenCalledTimes(nbActifs);

    // Chaque appel porte bien le PDF en pièce jointe (buffer non vide).
    const premierAppel = envoyerEmail.mock.calls[0][0];
    expect(premierAppel.attachments).toBeTruthy();
    expect(premierAppel.attachments[0].filename).toMatch(/\.pdf$/);
    expect(Buffer.isBuffer(premierAppel.attachments[0].content)).toBe(true);
    expect(premierAppel.attachments[0].content.length).toBeGreaterThan(100);
    expect(premierAppel.subject).toContain("Rôle d'audience");

    // Idempotence : un 2e appel échoue (le rôle n'est plus "valide") — pas de second lot d'e-mails.
    envoyerEmail.mockClear();
    const secondAppel = await request(app).post(`/api/roles-audience/${roleId}/diffuser`).set("Authorization", `Bearer ${token}`);
    expect(secondAppel.status).toBe(404);
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  test("refuse de diffuser un rôle encore en brouillon (non validé)", async () => {
    const dossierId = await creerClientEtDossier();
    const semaine = lundiAleatoire(1);
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: semaine, juridiction: "TGI Test", type: "mise_en_etat" });
    const roleId = creation.body.role_id;

    envoyerEmail.mockClear();
    const diffusion = await request(app).post(`/api/roles-audience/${roleId}/diffuser`).set("Authorization", `Bearer ${token}`);
    expect(diffusion.status).toBe(404);
    expect(envoyerEmail).not.toHaveBeenCalled();
  });
});
