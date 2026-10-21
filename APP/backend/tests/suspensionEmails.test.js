// JURIA — suspension temporaire des e-mails de conflit et de création de dossier (21/10/2026).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
});
afterAll(async () => {
  await pool.query("UPDATE parametres_cabinet SET emails_dossiers_suspendus_jusqu_a = NULL WHERE id = 1");
  await pool.end();
});

async function creerDossier(numero) {
  const c = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client susp ${Date.now()}-${Math.random()}` });
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero, client_id: c.body.id, intitule: "Dossier suspension", pole: "contentieux", matiere: "x", mode_honoraires: "forfait",
    urgence: "moyenne", responsable_id: login.body.utilisateur.id });
  return d.body;
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const traces = async (numero) => (await pool.query(
  "SELECT count(*)::int AS n FROM journal_audit WHERE action = 'email_suspendu' AND details->>'numero' = $1", [numero])).rows[0].n;

describe("Suspension des e-mails de conflit et de création de dossier", () => {
  test("par défaut : actifs ; durée invalide refusée", async () => {
    expect((await request(app).get("/api/parametres/emails-dossiers").set(auth())).body.suspendu).toBe(false);
    expect((await request(app).put("/api/parametres/emails-dossiers").set(auth()).send({ heures: 0 })).status).toBe(400);
    expect((await request(app).put("/api/parametres/emails-dossiers").set(auth()).send({ heures: 500 })).status).toBe(400);
  });

  test("suspendus 24 h : la création d'un dossier ne notifie plus, et le fait est tracé ; réactivation immédiate possible", async () => {
    const maj = await request(app).put("/api/parametres/emails-dossiers").set(auth()).send({ heures: 24 });
    expect(maj.body.suspendu).toBe(true);
    const fin = new Date(maj.body.jusqu_a).getTime() - Date.now();
    expect(fin).toBeGreaterThan(23.9 * 3600 * 1000);
    expect(fin).toBeLessThan(24.1 * 3600 * 1000);
    const num = `SUSP-${Date.now()}`;
    expect((await creerDossier(num)).numero).toBe(num);
    await attendre(300);
    expect(await traces(num)).toBe(1);
    // le tableau de bord rappelle la suspension
    expect((await request(app).get("/api/dashboard").set(auth())).body.emails_suspendus_jusqu_a).toBeTruthy();
    // réactivation
    const re = await request(app).put("/api/parametres/emails-dossiers").set(auth()).send({ reactiver: true });
    expect(re.body.suspendu).toBe(false);
    const num2 = `ACTIF-${Date.now()}`;
    await creerDossier(num2);
    await attendre(300);
    expect(await traces(num2)).toBe(0);
    expect((await request(app).get("/api/dashboard").set(auth())).body.emails_suspendus_jusqu_a).toBeNull();
  });

  test("une suspension échue s'éteint toute seule", async () => {
    await pool.query("UPDATE parametres_cabinet SET emails_dossiers_suspendus_jusqu_a = now() - interval '1 minute' WHERE id = 1");
    expect((await request(app).get("/api/parametres/emails-dossiers").set(auth())).body.suspendu).toBe(false);
    const num = `ECHU-${Date.now()}`;
    await creerDossier(num);
    await attendre(300);
    expect(await traces(num)).toBe(0);
  });
});
