// JURIA — « débours et frais de procédure sont des frais de justice » (11/11/2026) : ces catégories ne s'engagent jamais sur la petite
// caisse (elles relèvent de la caisse « frais de justice & débours » ou du circuit normal) ; les vignettes se paient hors des caisses.
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
  const hash = await bcrypt.hash("TestDb123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Debours',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`D${sfx.slice(0, 7)}`, `test.db.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Debours" }, SECRET, { expiresIn: "1h" }) };
}
const get = (u, url) => request(app).get(url).set(auth(u));
const post = (u, url, body = {}) => request(app).post(url).set(auth(u)).send(body);
let adminG, assoc, dossierId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  adminG = await creer("admin_general");
  assoc = await creer("associe");
  const cl = await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', 'Client débours') RETURNING id");
  const num = "DBR-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  const d = await pool.query(
    `INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id)
     VALUES ($1,'Dossier débours',$2,(SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1),$3) RETURNING id`, [num, cl.rows[0].id, assoc.id]);
  dossierId = d.rows[0].id;
  await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_plafond_depense: 50000 });
  const mois = new Date().toISOString().slice(0, 8) + "01";
  await post(assoc, "/api/depenses/petite-caisse", { mois, montant_alloue: 500000000 });
  await post(assoc, "/api/depenses/petite-caisse", { mois, montant_alloue: 500000000, caisse: "procedure" });
});
afterAll(async () => {
  await pool.query("UPDATE parametres_cabinet SET petite_caisse_categories = DEFAULT WHERE id = 1");
  await pool.end();
});

describe("Débours = frais de justice", () => {
  test("un débours ne s'engage pas sur la petite caisse, même coché dans sa liste ; il s'engage sur la caisse de justice", async () => {
    const corps = { libelle: "Frais de greffe", montant: 8000, categorie: "frais_grosse", beneficiaire: "Greffe " + Math.random().toString(36).slice(2, 6), mode_paiement: "especes" };
    const refus = await post(adminG, "/api/depenses/engager", { ...corps });
    expect(refus.status).toBe(409);
    expect(refus.body.error).toMatch(/frais de justice/);
    const ok = await post(adminG, "/api/depenses/engager", { ...corps, caisse: "procedure", dossier_id: dossierId });
    expect(ok.status).toBe(201);
  });

  test("les réglages refusent un débours dans la liste de la petite caisse ; la liste servie n'en contient jamais, même si la base en garde", async () => {
    const r = await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_categories: ["fournitures", "frais_huissier"] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/frais de justice/);
    await pool.query("UPDATE parametres_cabinet SET petite_caisse_categories = ARRAY['fournitures','frais_expedition','transport'] WHERE id = 1");
    const caisse = (await get(adminG, "/api/depenses/petite-caisse")).body;
    expect(caisse.categories_autorisees.sort()).toEqual(["fournitures", "transport"]);
    const e = await post(adminG, "/api/depenses/engager", { libelle: "Courrier", montant: 3000, categorie: "frais_expedition", beneficiaire: "Poste", mode_paiement: "especes" });
    expect(e.status).toBe(409);
    await pool.query("UPDATE parametres_cabinet SET petite_caisse_categories = DEFAULT WHERE id = 1");
  });

  test("la case « Sur petite caisse » du circuit normal refuse aussi un débours", async () => {
    const r = await post(assoc, "/api/depenses", { type: "ponctuelle", libelle: "Huissier", montant: 5000, categorie: "frais_huissier", petite_caisse: true });
    expect(r.status).toBe(409);
    expect((await post(assoc, "/api/depenses", { type: "ponctuelle", libelle: "Huissier", montant: 5000, categorie: "frais_huissier" })).status).toBe(201);
  });

  test("les vignettes se paient hors des caisses : leur dépense reste avec le cabinet et ne débite aucune caisse", async () => {
    const avantProc = Number((await get(assoc, "/api/depenses/petite-caisse?caisse=procedure")).body.depense);
    const avantPc = Number((await get(assoc, "/api/depenses/petite-caisse")).body.depense);
    const { rows: [dep] } = await pool.query(
      `INSERT INTO depenses (type, categorie, libelle, montant, date_depense, statut, dossier_id, refacturable_client, cree_par)
       VALUES ('ponctuelle','vignette_plaidoirie','Vignette de plaidoirie n°9999999',10000,current_date,'decaissee',$1,TRUE,$2) RETURNING id`, [dossierId, assoc.id]);
    const ids = async (c) => (await get(assoc, `/api/depenses?caisse=${c}`)).body.map((d) => d.id);
    expect(await ids("cabinet")).toContain(dep.id);
    expect(await ids("procedure")).not.toContain(dep.id);
    expect(await ids("petite_caisse")).not.toContain(dep.id);
    expect(Number((await get(assoc, "/api/depenses/petite-caisse?caisse=procedure")).body.depense)).toBe(avantProc);
    expect(Number((await get(assoc, "/api/depenses/petite-caisse")).body.depense)).toBe(avantPc);
  });
});
