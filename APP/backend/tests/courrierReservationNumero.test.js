// JURIA — 04/11/2026 : réservation d'un numéro de courrier départ avant la rédaction de la lettre (Word).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});
afterAll(async () => { await pool.end(); });

const auth = (r) => r.set("Authorization", `Bearer ${token}`);

describe("Réservation de numéro (courrier départ)", () => {
  test("réserve un numéro DEP sans aucune information (courrier général)", async () => {
    const r = await auth(request(app).post("/api/courriers/reserver-numero")).send({});
    expect(r.status).toBe(201);
    expect(r.body.reference).toMatch(/^DEP-\d{4}-\d{6}$/);
    const l = await auth(request(app).get("/api/courriers?numeros_reserves=true"));
    const c = l.body.find((x) => x.id === r.body.id);
    expect(c).toBeTruthy();
    expect(c.numero_reserve).toBe(true);
    expect(c.sens).toBe("depart");
  });

  test("deux réservations successives donnent deux références différentes", async () => {
    const a = await auth(request(app).post("/api/courriers/reserver-numero")).send({ correspondant: "Banque X" });
    const b = await auth(request(app).post("/api/courriers/reserver-numero")).send({ correspondant: "Banque Y", objet: "Mise en demeure" });
    expect(a.body.reference).not.toBe(b.body.reference);
    expect(b.body.objet).toBe("Mise en demeure");
  });

  test("l'annulation exige un motif, laisse la référence au registre et sort le numéro de la file « en attente »", async () => {
    const r = await auth(request(app).post("/api/courriers/reserver-numero")).send({});
    const sans = await auth(request(app).post(`/api/courriers/${r.body.id}/annuler-numero`)).send({});
    expect(sans.status).toBe(400);
    const ok = await auth(request(app).post(`/api/courriers/${r.body.id}/annuler-numero`)).send({ motif: "Lettre abandonnée" });
    expect(ok.status).toBe(200);
    const encore = await auth(request(app).post(`/api/courriers/${r.body.id}/annuler-numero`)).send({ motif: "Encore" });
    expect(encore.status).toBe(409);
    const attente = await auth(request(app).get("/api/courriers?numeros_reserves=true"));
    expect(attente.body.find((x) => x.id === r.body.id)).toBeUndefined();
    const tous = await auth(request(app).get("/api/courriers?sens=depart"));
    const c = tous.body.find((x) => x.id === r.body.id);
    expect(c.annule_le).toBeTruthy();
    expect(c.annule_motif).toBe("Lettre abandonnée");
  });

  test("on ne peut plus joindre de lettre ni changer le statut d'un numéro annulé", async () => {
    const r = await auth(request(app).post("/api/courriers/reserver-numero")).send({});
    await auth(request(app).post(`/api/courriers/${r.body.id}/annuler-numero`)).send({ motif: "Test" });
    const doc = await auth(request(app).post(`/api/courriers/${r.body.id}/document`))
      .attach("fichier", Buffer.from("%PDF-1.4 test"), { filename: "lettre.pdf", contentType: "application/pdf" });
    expect(doc.status).toBe(409);
    const st = await auth(request(app).put(`/api/courriers/${r.body.id}/statut`)).send({ statut: "expedie" });
    expect(st.status).toBe(404);
  });

  test("un courrier ordinaire n'est pas annulable comme un numéro réservé", async () => {
    const c = await auth(request(app).post("/api/courriers")).send({ sens: "depart", type: "lettre", correspondant: "Tribunal" });
    const r = await auth(request(app).post(`/api/courriers/${c.body.id}/annuler-numero`)).send({ motif: "x" });
    expect(r.status).toBe(409);
  });
});
