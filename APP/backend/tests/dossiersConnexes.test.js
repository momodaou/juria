// JURIA — 10/10/2026 : "Dossiers connexes" (même client ou même partie
// adverse), calculé à la volée sur la fiche dossier — voir CLAUDE.md/
// HISTORY.md pour la discussion qui a mené à ce choix (cas concret :
// saisie-revendication conservatoire + injonction de délivrer, facturées
// séparément, donc restées 2 dossiers malgré le lien juridique).
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

async function creerClient(denomination) {
  const res = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination });
  return res.body.id;
}

async function creerDossier({ clientId, partiesAdverses = [], clientsAdditionnels = [] }) {
  const res = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: clientId, intitule: "Dossier test connexes", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
      parties_adverses: partiesAdverses, clients_additionnels: clientsAdditionnels,
    });
  return res.body;
}

describe("GET /api/dossiers/:id/connexes", () => {
  test("détecte un dossier partageant le même client (meme_client=true, meme_partie=false)", async () => {
    const clientId = await creerClient(`Client connexe A ${Date.now()}-${Math.random()}`);
    const d1 = await creerDossier({ clientId, partiesAdverses: ["Débiteur Un"] });
    const d2 = await creerDossier({ clientId, partiesAdverses: ["Débiteur Deux (sans rapport)"] });

    const res = await request(app).get(`/api/dossiers/${d1.id}/connexes`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ligne = res.body.find((c) => c.id === d2.id);
    expect(ligne).toBeTruthy();
    expect(ligne.meme_client).toBe(true);
    expect(ligne.meme_partie).toBe(false);
  });

  test("détecte un dossier partageant la même partie adverse (insensible espace/tiret/casse)", async () => {
    const client1 = await creerClient(`Client connexe B1 ${Date.now()}-${Math.random()}`);
    const client2 = await creerClient(`Client connexe B2 ${Date.now()}-${Math.random()}`);
    const d1 = await creerDossier({ clientId: client1, partiesAdverses: ["Société Débitrice SARL"] });
    const d2 = await creerDossier({ clientId: client2, partiesAdverses: ["société-débitrice sarl"] });

    const res = await request(app).get(`/api/dossiers/${d1.id}/connexes`).set("Authorization", `Bearer ${token}`);
    const ligne = res.body.find((c) => c.id === d2.id);
    expect(ligne).toBeTruthy();
    expect(ligne.meme_client).toBe(false);
    expect(ligne.meme_partie).toBe(true);
  });

  test("un dossier avec un client ET une partie adverse totalement différents n'apparaît pas", async () => {
    const clientA = await creerClient(`Client connexe C ${Date.now()}-${Math.random()}`);
    const clientB = await creerClient(`Client connexe D ${Date.now()}-${Math.random()}`);
    const d1 = await creerDossier({ clientId: clientA, partiesAdverses: ["Partie sans aucun rapport"] });
    const d2 = await creerDossier({ clientId: clientB, partiesAdverses: ["Autre partie distincte"] });

    const res = await request(app).get(`/api/dossiers/${d1.id}/connexes`).set("Authorization", `Bearer ${token}`);
    expect(res.body.find((c) => c.id === d2.id)).toBeFalsy();
  });

  test("meme_client et meme_partie peuvent être vrais simultanément", async () => {
    const clientId = await creerClient(`Client connexe E ${Date.now()}-${Math.random()}`);
    const nomPartie = `Débiteur commun ${Date.now()}`;
    const d1 = await creerDossier({ clientId, partiesAdverses: [nomPartie] });
    const d2 = await creerDossier({ clientId, partiesAdverses: [nomPartie] });

    const res = await request(app).get(`/api/dossiers/${d1.id}/connexes`).set("Authorization", `Bearer ${token}`);
    const ligne = res.body.find((c) => c.id === d2.id);
    expect(ligne.meme_client).toBe(true);
    expect(ligne.meme_partie).toBe(true);
  });

  test("détecte aussi via un client additionnel (pas seulement le client principal)", async () => {
    const clientPrincipal1 = await creerClient(`Client connexe F1 ${Date.now()}-${Math.random()}`);
    const clientPrincipal2 = await creerClient(`Client connexe F2 ${Date.now()}-${Math.random()}`);
    const clientPartage = await creerClient(`Client partagé additionnel ${Date.now()}-${Math.random()}`);
    const d1 = await creerDossier({ clientId: clientPrincipal1, clientsAdditionnels: [clientPartage] });
    const d2 = await creerDossier({ clientId: clientPrincipal2, clientsAdditionnels: [clientPartage] });

    const res = await request(app).get(`/api/dossiers/${d1.id}/connexes`).set("Authorization", `Bearer ${token}`);
    const ligne = res.body.find((c) => c.id === d2.id);
    expect(ligne).toBeTruthy();
    expect(ligne.meme_client).toBe(true);
  });

  test("le dossier lui-même n'apparaît jamais dans ses propres connexes", async () => {
    const clientId = await creerClient(`Client connexe G ${Date.now()}-${Math.random()}`);
    const d1 = await creerDossier({ clientId, partiesAdverses: ["Une partie"] });
    const res = await request(app).get(`/api/dossiers/${d1.id}/connexes`).set("Authorization", `Bearer ${token}`);
    expect(res.body.find((c) => c.id === d1.id)).toBeFalsy();
  });
});
