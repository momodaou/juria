// JURIA — Dépenses : « Nature » (dossier / cabinet) et pièces multiples avec
// choix du devis par le valideur seul (16/10/2026, audit retraité chantier 4).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // associe (valideur)
let collab; // collaborateur (déposant, pas valideur)

const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestDepPieces123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','DepPieces',$2,$3,'collaborateur',TRUE,now()) RETURNING id`,
    [`D${suffixe.slice(0, 7)}`, `test.deppieces.${suffixe}@jfcavocats-mali.com`, hash]);
  collab = jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Test DepPieces" }, SECRET, { expiresIn: "1h" });
});

afterAll(async () => { await pool.end(); });

async function creerDepense(t, extra = {}) {
  return request(app).post("/api/depenses").set(auth(t))
    .send({ type: "ponctuelle", libelle: "Climatisation", montant: 250000, ...extra });
}
const joindre = (t, id, type, nom = "devis.pdf") =>
  request(app).post(`/api/depenses/${id}/pieces`).set(auth(t))
    .field("type", type).attach("fichier", Buffer.from("%PDF-1.4 test " + nom), { filename: nom, contentType: "application/pdf" });

describe("Nature d'une dépense", () => {
  test("sans dossier = cabinet ; un dossier précisé = dossier ; cabinet + dossier ignore le dossier", async () => {
    const a = await creerDepense(token);
    expect(a.status).toBe(201);
    expect(a.body.nature).toBe("cabinet");
    const b = await creerDepense(token, { nature: "dossier" });
    expect(b.status).toBe(400); // dossier obligatoire pour une charge liée à un dossier
    const c = await creerDepense(token, { nature: "cabinet", refacturable_client: true });
    expect(c.status).toBe(201);
    const liste = await request(app).get("/api/depenses?nature=cabinet").set(auth(token));
    const ligne = liste.body.find((d) => d.id === c.body.id);
    expect(ligne.refacturable_client).toBe(false); // jamais refacturable sans dossier
    expect((await request(app).post("/api/depenses").set(auth(token)).send({ type: "ponctuelle", libelle: "x", montant: 1, nature: "autre" })).status).toBe(400);
  });
});

describe("Pièces d'une dépense — plusieurs devis, un seul retenu, par le valideur seul", () => {
  test("le déposant joint 2 devis ; lui ne peut pas retenir ; le valideur retient, un seul à la fois", async () => {
    const dep = await creerDepense(collab);
    const id = dep.body.id;
    const d1 = await joindre(collab, id, "devis", "devis1.pdf");
    const d2 = await joindre(collab, id, "devis", "devis2.pdf");
    expect(d1.status).toBe(201);
    expect(d2.status).toBe(201);

    expect((await request(app).post(`/api/depenses/${id}/pieces/${d1.body.id}/retenir`).set(auth(collab))).status).toBe(403);
    expect((await request(app).post(`/api/depenses/${id}/pieces/${d1.body.id}/retenir`).set(auth(token))).status).toBe(200);
    expect((await request(app).post(`/api/depenses/${id}/pieces/${d2.body.id}/retenir`).set(auth(token))).status).toBe(200);

    const pieces = (await request(app).get(`/api/depenses/${id}/pieces`).set(auth(token))).body;
    expect(pieces.filter((p) => p.retenu).map((p) => p.id)).toEqual([d2.body.id]);
    const liste = (await request(app).get("/api/depenses").set(auth(token))).body.find((d) => d.id === id);
    expect(liste.nb_devis).toBe(2);
    expect(liste.devis_retenu).toBe(true);
  });

  test("devis facultatif ; facture déposable après décaissement, devis refusé après décision", async () => {
    const dep = await creerDepense(token);
    const id = dep.body.id;
    expect((await request(app).post(`/api/depenses/${id}/decision`).set(auth(token)).send({ statut: "validee" })).status).toBe(200);
    expect((await request(app).post(`/api/depenses/${id}/decaisser`).set(auth(token)).send({ mode_paiement: "virement" })).status).toBe(200);
    expect((await joindre(token, id, "devis")).status).toBe(409);
    const fac = await joindre(token, id, "facture", "facture.pdf");
    expect(fac.status).toBe(201);
    const dl = await request(app).get(`/api/depenses/${id}/pieces/${fac.body.id}/fichier`).set(auth(token));
    expect(dl.status).toBe(200);
    expect(dl.body.toString()).toContain("facture.pdf");
    expect((await request(app).delete(`/api/depenses/${id}/pieces/${fac.body.id}`).set(auth(token))).status).toBe(204);
  });

  test("un tiers non déposant et sans droit de décision ne peut pas joindre de pièce", async () => {
    const dep = await creerDepense(token);
    expect((await joindre(collab, dep.body.id, "devis")).status).toBe(403);
  });
});
