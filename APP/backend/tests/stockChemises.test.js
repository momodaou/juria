// JURIA — stock de chemises à rabat : initialisation, déduction à la création
// d'un dossier, régularisation des dossiers existants, seuils (20/10/2026).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let associeId; let collab;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  associe = login.body.token; associeId = login.body.utilisateur.id;
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestChem123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Chem',$2,$3,'collaborateur',TRUE,now()) RETURNING id`,
    [`C${suffixe.slice(0, 7)}`, `test.chem.${suffixe}@jfcavocats-mali.com`, hash]);
  collab = jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Test Chem" }, SECRET, { expiresIn: "1h" });
});
afterAll(async () => { await pool.end(); });

const stock = async () => Object.fromEntries((await request(app).get("/api/stock-chemises").set(auth(associe))).body.stock.map((s) => [s.couleur, s.quantite]));
async function dossier(codeMatiere) {
  const c = await request(app).post("/api/clients").set(auth(associe)).send({ type: "morale", denomination: `Client chem ${Date.now()}-${Math.random()}` });
  const d = await request(app).post("/api/dossiers").set(auth(associe)).send({
    client_id: c.body.id, intitule: "Dossier chemise", pole: "contentieux", matiere: "Droit civil", code_matiere: codeMatiere,
    mode_honoraires: "forfait", urgence: "moyenne", responsable_id: associeId });
  return d.body;
}

describe("Stock de chemises", () => {
  test("accès : un collaborateur ne consulte ni ne gère", async () => {
    expect((await request(app).get("/api/stock-chemises").set(auth(collab))).status).toBe(403);
    expect((await request(app).post("/api/stock-chemises/mouvement").set(auth(collab)).send({ couleur: "bleu", type: "entree", quantite: 1 })).status).toBe(403);
  });

  test("initialisation : valeurs invalides refusées, une seule fois", async () => {
    const mauvais = await request(app).post("/api/stock-chemises/initialiser").set(auth(associe)).send({ quantites: { bleu: -1, dore: 0, rouge: 0, vert: 0, violet: 0 } });
    expect(mauvais.status).toBe(400);
    const zero = await request(app).post("/api/stock-chemises/initialiser").set(auth(associe)).send({ quantites: { bleu: 0, dore: 0, rouge: 0, vert: 0, violet: 0 } });
    expect(zero.status).toBe(400);
    const ok = await request(app).post("/api/stock-chemises/initialiser").set(auth(associe)).send({ quantites: { bleu: 398, dore: 649, rouge: 550, vert: 400, violet: 400 } });
    expect(ok.status).toBe(201);
    const apres = await stock();
    expect(apres).toEqual({ bleu: 398, dore: 649, rouge: 550, vert: 400, violet: 400 });
    expect((await request(app).post("/api/stock-chemises/initialiser").set(auth(associe)).send({ quantites: { bleu: 1, dore: 1, rouge: 1, vert: 1, violet: 1 } })).status).toBe(409);
  });

  test("création d'un dossier : une chemise sort ; le gris (IND) ne déduit rien", async () => {
    const avant = await stock();
    const civ = await dossier("CIV");
    expect(civ.couleur_chemise).toBe("dore");
    expect((await stock()).dore).toBe(avant.dore - 1);
    await dossier("IND");
    const apres = await stock();
    expect(apres).toEqual({ ...avant, dore: avant.dore - 1 });
    const mv = (await request(app).get("/api/stock-chemises/mouvements").set(auth(associe))).body.find((m) => m.dossier_id === civ.id);
    expect(mv.quantite).toBe(-1);
    expect(mv.type).toBe("dossier");
  });

  test("requalification IND → matière : la chemise sort une seule fois", async () => {
    const d = await dossier("IND");
    const avant = await stock();
    const r = await request(app).put(`/api/dossiers/${d.id}`).set(auth(associe)).send({ code_matiere: "CIV" });
    expect(r.status).toBe(200);
    expect((await stock()).dore).toBe(avant.dore - 1);
    await request(app).put(`/api/dossiers/${d.id}`).set(auth(associe)).send({ code_matiere: "CIV", objet: "maj" });
    expect((await stock()).dore).toBe(avant.dore - 1);
  });

  test("matière rectifiée : l'ancienne chemise est restituée, la nouvelle décomptée ; vers le gris, simple restitution", async () => {
    const d = await dossier("CIV");
    const avant = await stock();
    const r = await request(app).put(`/api/dossiers/${d.id}`).set(auth(associe)).send({ code_matiere: "COM" });
    expect(r.status).toBe(200);
    const milieu = await stock();
    expect(milieu.dore).toBe(avant.dore + 1);
    expect(milieu.bleu).toBe(avant.bleu - 1);
    await request(app).put(`/api/dossiers/${d.id}`).set(auth(associe)).send({ code_matiere: "IND" });
    const fin = await stock();
    expect(fin.bleu).toBe(avant.bleu);
    expect(fin.dore).toBe(avant.dore + 1);
  });

  test("régularisation : aperçu, exclusion, application unique", async () => {
    // Dossier « ancien » : on retire sa sortie pour simuler un dossier créé avant le stock.
    const ancien = await dossier("COM");
    await pool.query("DELETE FROM stock_chemises_mouvements WHERE dossier_id = $1", [ancien.id]);
    const apercu = (await request(app).get("/api/stock-chemises/regularisation").set(auth(associe))).body;
    expect(apercu.resume).toHaveLength(5);
    expect(apercu.dossiers.find((d) => d.id === ancien.id).couleur).toBe("bleu");
    const exclusSaufAncien = apercu.dossiers.filter((d) => d.id !== ancien.id).map((d) => d.id);
    const avant = await stock();
    const r = await request(app).post("/api/stock-chemises/regularisation").set(auth(associe)).send({ exclure: exclusSaufAncien });
    expect(r.status).toBe(200);
    expect(r.body.appliques).toBe(1);
    expect((await stock()).bleu).toBe(avant.bleu - 1);
    const rejeu = await request(app).post("/api/stock-chemises/regularisation").set(auth(associe)).send({ exclure: exclusSaufAncien });
    expect(rejeu.body.appliques).toBe(0);
  });

  test("entrée, ajustement (motif obligatoire), seuil et alerte stock bas", async () => {
    const avant = await stock();
    expect((await request(app).post("/api/stock-chemises/mouvement").set(auth(associe)).send({ couleur: "vert", type: "entree", quantite: 10 })).status).toBe(201);
    expect((await stock()).vert).toBe(avant.vert + 10);
    expect((await request(app).post("/api/stock-chemises/mouvement").set(auth(associe)).send({ couleur: "vert", type: "ajustement", quantite: -3 })).status).toBe(400);
    expect((await request(app).post("/api/stock-chemises/mouvement").set(auth(associe)).send({ couleur: "vert", type: "ajustement", quantite: -3, motif: "Inventaire" })).status).toBe(201);
    expect((await stock()).vert).toBe(avant.vert + 7);
    expect((await request(app).post("/api/stock-chemises/mouvement").set(auth(associe)).send({ couleur: "vert", type: "entree", quantite: -2 })).status).toBe(400);
    expect((await request(app).post("/api/stock-chemises/mouvement").set(auth(associe)).send({ couleur: "gris", type: "entree", quantite: 2 })).status).toBe(400);
    await request(app).put("/api/stock-chemises/seuils").set(auth(associe)).send({ violet: 100000 });
    const dash = (await request(app).get("/api/dashboard").set(auth(associe))).body;
    expect(dash.chemises_stock_bas.map((c) => c.couleur)).toContain("violet");
    await request(app).put("/api/stock-chemises/seuils").set(auth(associe)).send({ violet: 50 });
  });
});
