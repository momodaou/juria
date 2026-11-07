// JURIA — factures émises avant JURIA (07/11/2026) : date d'émission indiquée/corrigible, numéro automatique selon l'année
// de cette date, « N° d'origine » facultatif (liste, PDF, correction tracée).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
let userId;
let clientId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
  const c = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client date emission ${Date.now()}` });
  clientId = c.body.id;
});

afterAll(async () => {
  await pool.end();
});

const auth = (r) => r.set("Authorization", `Bearer ${token}`);
const creer = (extra = {}) => auth(request(app).post("/api/factures")).send({ client_id: clientId, mode: "forfait", montant_ht: 100000, ...extra });
const aujourdhui = () => new Date().toISOString().slice(0, 10);

function extraireTexteVisible(pdfBuffer) {
  return [...pdfBuffer.toString("latin1").matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");
}
function pdf(id) {
  return auth(request(app).get(`/api/factures/${id}/pdf`)).buffer(true).parse((response, cb) => {
    const chunks = [];
    response.on("data", (c) => chunks.push(c));
    response.on("end", () => cb(null, Buffer.concat(chunks)));
  });
}

describe("Création d'une facture antérieure à JURIA", () => {
  test("date passée : numéro de l'année de la date, N° d'origine conservé, date renvoyée", async () => {
    const r = await creer({ date_emission: "2025-03-10", numero_origine: "  FA/2025/012  " });
    expect(r.status).toBe(201);
    expect(r.body.date_emission).toBe("2025-03-10");
    expect(r.body.numero).toMatch(/^F-25-\d{3}$/);
    expect(r.body.numero_origine).toBe("FA/2025/012");
    const { rows: [f] } = await pool.query("SELECT date_taux::text AS date_taux FROM factures WHERE id = $1", [r.body.id]);
    expect(f.date_taux).toBe("2025-03-10");
  });

  test("la suite des numéros est propre à chaque année", async () => {
    const a = await creer({ date_emission: "2025-06-01" });
    const b = await creer({ date_emission: "2025-06-02" });
    expect(Number(b.body.numero.split("-")[2])).toBe(Number(a.body.numero.split("-")[2]) + 1);
    const yy = aujourdhui().slice(2, 4);
    const c = await creer();
    expect(c.body.numero.startsWith(`F-${yy}-`)).toBe(true);
    expect(c.body.date_emission).toBe(aujourdhui());
    expect(c.body.numero_origine).toBeNull();
  });

  test("refus : date future, date invalide, échéance avant l'émission, N° d'origine trop long", async () => {
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect((await creer({ date_emission: demain })).status).toBe(400);
    expect((await creer({ date_emission: "31/12/2025" })).status).toBe(400);
    expect((await creer({ date_emission: "2025-02-30" })).status).toBe(400);
    expect((await creer({ date_emission: "2025-03-10", date_echeance: "2025-03-01" })).status).toBe(400);
    expect((await creer({ numero_origine: "x".repeat(61) })).status).toBe(400);
    // échéance passée mais postérieure à l'émission : acceptée
    expect((await creer({ date_emission: "2025-03-10", date_echeance: "2025-04-10" })).status).toBe(201);
  });

  test("acompte reçu à l'émission : daté de la date d'émission", async () => {
    const r = await creer({ date_emission: "2025-04-15", acompte: { montant: 20000, mode: "especes" } });
    expect(r.status).toBe(201);
    const { rows: [p] } = await pool.query("SELECT date_paiement::text AS d FROM paiements WHERE facture_id = $1", [r.body.id]);
    expect(p.d).toBe("2025-04-15");
  });

  test("liste et PDF : N° d'origine affiché, date d'émission imprimée", async () => {
    const r = await creer({ date_emission: "2025-05-20", numero_origine: "ANC-777" });
    const liste = await auth(request(app).get("/api/factures"));
    const f = liste.body.find((x) => x.id === r.body.id);
    expect(f.numero_origine).toBe("ANC-777");
    expect(String(f.date_emission).slice(0, 10)).toBe("2025-05-20");
    const texte = extraireTexteVisible((await pdf(r.body.id)).body);
    expect(texte).toContain("ANC-777");
    expect(texte).toContain(r.body.numero);
  });
});

describe("Correction d'une facture déjà émise", () => {
  test("changer la date d'émission et le N° d'origine : numéro inchangé, tracé au journal d'audit", async () => {
    const r = await creer();
    const put = await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ date_emission: "2025-01-15", numero_origine: "OLD-1" });
    expect(put.status).toBe(200);
    expect(put.body.date_emission).toBe("2025-01-15");
    expect(put.body.numero_origine).toBe("OLD-1");
    expect(put.body.numero).toBe(r.body.numero);
    const { rows } = await pool.query(
      "SELECT details FROM journal_audit WHERE action = 'modifier_facture' AND entite_id = $1 ORDER BY id DESC LIMIT 1", [r.body.id]);
    expect(JSON.stringify(rows[0].details)).toContain("date_emission");
  });

  test("N° d'origine : vide l'efface ; absent le laisse tel quel", async () => {
    const r = await creer({ numero_origine: "A-1" });
    const sans = await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ objet: "nouvel objet" });
    expect(sans.body.numero_origine).toBe("A-1");
    const vide = await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ numero_origine: "" });
    expect(vide.body.numero_origine).toBeNull();
  });

  test("refus : date future, date postérieure au premier paiement, échéance antérieure", async () => {
    const r = await creer({ date_emission: "2025-02-01", date_echeance: "2025-03-01" });
    const demain = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    expect((await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ date_emission: demain })).status).toBe(400);
    expect((await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ date_emission: "2025-03-05" })).status).toBe(400);
    const pay = await auth(request(app).post(`/api/factures/${r.body.id}/paiements`)).send({ montant: 10000, mode: "especes", date_paiement: "2025-02-10" });
    expect(pay.status).toBe(201);
    expect((await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ date_emission: "2025-02-20" })).status).toBe(409);
    expect((await auth(request(app).put(`/api/factures/${r.body.id}`)).send({ date_emission: "2025-02-05" })).status).toBe(200);
  });
});
