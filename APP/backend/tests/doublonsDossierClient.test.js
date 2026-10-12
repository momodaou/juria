// JURIA — 12/10/2026, suite de l'audit doublons : élargissement du filet
// de sécurité (DOUBLONS_CTE, voir ../src/doublons.js) aux dossiers/clients,
// élargissement de GET /api/dossiers/verifier-doublon au recoupement par
// nom de client (pas seulement client_id exact — cas réel "Cabinet CADET"),
// et traçabilité (journal_audit) d'une création malgré avertissement.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
let userId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerClient(payload = {}) {
  const res = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client test ${Date.now()}-${Math.random()}`, ...payload });
  return res;
}

async function creerDossier(clientId, payload = {}) {
  const res = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: clientId, intitule: "Dossier test", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne",
      responsable_id: userId, ...payload,
    });
  return res;
}

describe("GET /api/dossiers/verifier-doublon — élargi au recoupement par nom (12/10/2026)", () => {
  test("même client_id exact → meme_client:true", async () => {
    const client = await creerClient();
    const d1 = await creerDossier(client.body.id);
    const res = await request(app).get("/api/dossiers/verifier-doublon")
      .query({ client_id: client.body.id }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const trouve = res.body.find((d) => d.id === d1.body.id);
    expect(trouve).toBeDefined();
    expect(trouve.meme_client).toBe(true);
  });

  test("client DIFFÉRENT mais nom quasi identique (espace/tiret) → signalé avec meme_client:false", async () => {
    const suffixe = `${Date.now()}`;
    const clientA = await creerClient({ denomination: `Cabinet CADET ${suffixe}` });
    const dossierA = await creerDossier(clientA.body.id);
    // Doublon de fiche client (même nom, tiret à la place de l'espace) —
    // reproduit l'incident réel du 01/10/2026.
    const clientB = await creerClient({ denomination: `Cabinet-CADET-${suffixe}` });

    const res = await request(app).get("/api/dossiers/verifier-doublon")
      .query({ client_id: clientB.body.id }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const trouve = res.body.find((d) => d.id === dossierA.body.id);
    expect(trouve).toBeDefined();
    expect(trouve.meme_client).toBe(false);
    expect(trouve.client_nom).toContain("Cabinet CADET");
  });

  test("resserré par code_matiere quand fourni", async () => {
    const client = await creerClient();
    const d1 = await creerDossier(client.body.id, { code_matiere: "CIV" });
    const res = await request(app).get("/api/dossiers/verifier-doublon")
      .query({ client_id: client.body.id, code_matiere: "COM" }).set("Authorization", `Bearer ${token}`);
    expect(res.body.find((d) => d.id === d1.body.id)).toBeUndefined();
  });

  test("sans client_id → tableau vide (jamais d'erreur)", async () => {
    const res = await request(app).get("/api/dossiers/verifier-doublon").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("GET /api/dashboard/detail/doublons — catégories Client/Dossier (12/10/2026)", () => {
  test("2 clients au nom identique sont signalés (catégorie 'Client')", async () => {
    const denomination = `Doublon Client Tuile ${Date.now()}`;
    await creerClient({ denomination });
    await creerClient({ denomination });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    const trouve = detail.body.find((d) => d.categorie === "Client" && d.description === denomination);
    expect(trouve).toBeDefined();
    expect(Number(trouve.nb)).toBe(2);
  });

  test("2 dossiers même client + même matière sont signalés (catégorie 'Dossier')", async () => {
    const client = await creerClient();
    const d1 = await creerDossier(client.body.id, { code_matiere: "SOC" });
    const d2 = await creerDossier(client.body.id, { code_matiere: "SOC" });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    const trouve = detail.body.find((d) => d.categorie === "Dossier" && d.description.includes(d1.body.numero) && d.description.includes(d2.body.numero));
    expect(trouve).toBeDefined();
    expect(Number(trouve.nb)).toBe(2);
  });

  test("2 dossiers même client mais matière différente ne sont PAS signalés", async () => {
    const client = await creerClient();
    const d1 = await creerDossier(client.body.id, { code_matiere: "SOC" });
    const d2 = await creerDossier(client.body.id, { code_matiere: "IMM" });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    const trouve = detail.body.find((d) => d.categorie === "Dossier" && d.description.includes(d1.body.numero) && d.description.includes(d2.body.numero));
    expect(trouve).toBeUndefined();
  });
});

describe("Traçabilité d'une création malgré doublon signalé (12/10/2026)", () => {
  test("ignorer_doublon:true sur POST /api/clients journalise 'ignorer_doublon_client'", async () => {
    const res = await creerClient({ ignorer_doublon: true });
    expect(res.status).toBe(201);
    const audit = await request(app).get("/api/acces/audit")
      .query({ action: "ignorer_doublon_client" }).set("Authorization", `Bearer ${token}`);
    expect(audit.status).toBe(200);
    expect(audit.body.find((a) => a.entite_id === res.body.id)).toBeDefined();
  });

  test("sans ignorer_doublon (création normale) → rien journalisé pour cette fiche", async () => {
    const res = await creerClient();
    const audit = await request(app).get("/api/acces/audit")
      .query({ action: "ignorer_doublon_client" }).set("Authorization", `Bearer ${token}`);
    expect(audit.body.find((a) => a.entite_id === res.body.id)).toBeUndefined();
  });

  test("ignorer_doublon:true sur POST /api/dossiers journalise 'ignorer_doublon_dossier'", async () => {
    const client = await creerClient();
    const res = await creerDossier(client.body.id, { ignorer_doublon: true });
    expect(res.status).toBe(201);
    const audit = await request(app).get("/api/acces/audit")
      .query({ action: "ignorer_doublon_dossier" }).set("Authorization", `Bearer ${token}`);
    expect(audit.body.find((a) => a.entite_id === res.body.id)).toBeDefined();
  });
});
