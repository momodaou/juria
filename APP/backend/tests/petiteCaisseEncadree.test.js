// JURIA — Petite caisse encadrée, lot B (11/11/2026) : natures autorisées, bénéficiaire obligatoire, plafond appliqué au
// cumul glissant sur 7 jours (anti-fractionnement), alerte aux associés, dépenses voisines.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { assurerUtilisateurTest, pool } = require("./setup");

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestPc123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Caisse',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`P${sfx.slice(0, 7)}`, `test.pc.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Caisse" }, SECRET, { expiresIn: "1h" }) };
}
let adminG, assoc;
const jour = (delta) => { const d = new Date(Date.now() + delta * 86400000); return d.toISOString().slice(0, 10); };
const moisCourant = () => new Date().toISOString().slice(0, 8) + "01";
const engager = (extra = {}) => request(app).post("/api/depenses/engager").set(auth(adminG))
  .send({ libelle: "Dépense caisse", montant: 20000, categorie: "fournitures", beneficiaire: "Librairie du Niger", mode_paiement: "especes", ...extra });

beforeAll(async () => {
  await assurerUtilisateurTest();
  adminG = await creer("admin_general");
  assoc = await creer("associe");
  await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_plafond_depense: 50000 });
  for (const j of [0, -20, 20]) await request(app).post("/api/depenses/petite-caisse").set(auth(assoc)).send({ mois: jour(j).slice(0, 8) + "01", montant_alloue: 500000000 });
});
afterAll(async () => {
  // Les autres suites partagent cette base : on remet la liste par défaut.
  await pool.query("UPDATE parametres_cabinet SET petite_caisse_categories = DEFAULT WHERE id = 1");
  await pool.end();
});

describe("Natures autorisées", () => {
  test("hors liste (loyer, « autre ») ou sans catégorie : refusé ; dans la liste : accepté", async () => {
    expect((await engager({ categorie: "loyer" })).status).toBe(409);
    expect((await engager({ categorie: undefined })).status).toBe(409);
    expect((await engager({ categorie: "transport", beneficiaire: "Taxi Bamako" })).status).toBe(201);
  });

  test("la case « Sur petite caisse » du circuit normal suit la même liste", async () => {
    const r = await request(app).post("/api/depenses").set(auth(assoc)).send({ type: "ponctuelle", libelle: "Loyer", montant: 100000, categorie: "loyer", petite_caisse: true });
    expect(r.status).toBe(409);
    expect((await request(app).post("/api/depenses").set(auth(assoc)).send({ type: "ponctuelle", libelle: "Loyer", montant: 100000, categorie: "loyer" })).status).toBe(201);
  });

  test("les associés règlent la liste (catégorie inconnue ou liste vide refusées) ; elle est servie avec la caisse", async () => {
    expect((await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_categories: [] })).status).toBe(400);
    expect((await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_categories: ["inconnue"] })).status).toBe(400);
    const ok = await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_categories: ["fournitures", "transport", "boissons"] });
    expect(ok.status).toBe(200);
    expect((await engager({ categorie: "boissons", beneficiaire: "Divers" })).status).toBe(201);
    const caisse = await request(app).get("/api/depenses/petite-caisse").set(auth(adminG));
    expect(caisse.body.categories_autorisees.sort()).toEqual(["boissons", "fournitures", "transport"]);
    await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_categories: ["fournitures", "transport", "papeterie"] });
  });
});

describe("Bénéficiaire obligatoire", () => {
  test("sans bénéficiaire : refusé", async () => {
    const r = await engager({ beneficiaire: "" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/bénéficiaire/i);
  });
});

describe("Anti-fractionnement", () => {
  test("une prestation découpée en deux dépenses sous le plafond est refusée au cumul ; un autre bénéficiaire passe", async () => {
    const b = "Imprimerie Fractionnée " + Math.random().toString(36).slice(2, 6);
    expect((await engager({ montant: 30000, beneficiaire: b, categorie: "papeterie" })).status).toBe(201);
    const r = await engager({ montant: 30000, beneficiaire: b, categorie: "papeterie" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/7 jours/);
    // même casse/espaces différents : toujours le même bénéficiaire
    expect((await engager({ montant: 30000, beneficiaire: "  " + b.toUpperCase() + " ", categorie: "papeterie" })).status).toBe(409);
    // autre bénéficiaire, autre catégorie : accepté
    expect((await engager({ montant: 30000, beneficiaire: "Autre fournisseur " + b, categorie: "papeterie" })).status).toBe(201);
    expect((await engager({ montant: 30000, beneficiaire: b, categorie: "fournitures" })).status).toBe(201);
    // en dehors de la fenêtre de 7 jours : accepté
    expect((await engager({ montant: 30000, beneficiaire: b, categorie: "papeterie", date_depense: jour(-20) })).status).toBe(201);
  });

  test("le cumul reste sous le plafond : accepté", async () => {
    const b = "Papeterie légère " + Math.random().toString(36).slice(2, 6);
    expect((await engager({ montant: 20000, beneficiaire: b })).status).toBe(201);
    expect((await engager({ montant: 20000, beneficiaire: b })).status).toBe(201);
  });
});

describe("Alerte et dépenses voisines", () => {
  test("même engageur, même bénéficiaire : les associés reçoivent l'alerte ; la liste des voisines la montre", async () => {
    const b = "Fournisseur Alerte " + Math.random().toString(36).slice(2, 6);
    const a = await engager({ montant: 10000, beneficiaire: b });
    const c = await engager({ montant: 10000, beneficiaire: b });
    expect(a.status).toBe(201); expect(c.status).toBe(201);
    const liste = (await request(app).get("/api/notifications").set(auth(assoc))).body.filter((n) => n.type === "caisse_fractionnement");
    expect(liste.length).toBeGreaterThan(0);
    expect(liste[0].texte).toMatch(/dépenses rapprochées .* à examiner/); // l'engageur est nommé aux associés
    const v = await request(app).get(`/api/depenses/${c.body.id}/voisines`).set(auth(assoc));
    expect(v.status).toBe(200);
    expect(v.body.voisines.map((x) => x.id)).toContain(a.body.id);
    expect(v.body.cumul_meme_nature_beneficiaire).toBe(20000);
    expect(v.body.plafond).toBe(50000);
    expect((await request(app).get(`/api/depenses/${c.body.id}/voisines`).set(auth(adminG))).status).toBe(403);
  });
});
