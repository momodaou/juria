// JURIA — catalogues de natures par caisse, frais de greffe précisés, vignette sans refacturation par défaut (11/11/2026).
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
  const hash = await bcrypt.hash("TestCat123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Catalogue',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`K${sfx.slice(0, 7)}`, `test.cat.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Catalogue" }, SECRET, { expiresIn: "1h" }) };
}
const get = (u, url) => request(app).get(url).set(auth(u));
const post = (u, url, body = {}) => request(app).post(url).set(auth(u)).send(body);
const put = (u, url, body = {}) => request(app).put(url).set(auth(u)).send(body);
let adminG, assoc, dossierId;
const engagerProc = (extra = {}) => post(adminG, "/api/depenses/engager", {
  caisse: "procedure", libelle: "Frais de greffe", montant: 5000, categorie: "frais_greffe", precision_nature: "copies",
  beneficiaire: "Greffe " + Math.random().toString(36).slice(2, 6), dossier_id: dossierId, mode_paiement: "especes", ...extra });

beforeAll(async () => {
  await assurerUtilisateurTest();
  adminG = await creer("admin_general");
  assoc = await creer("associe");
  const cl = await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', 'Client catalogues') RETURNING id");
  const num = "CAT-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  const d = await pool.query(
    `INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id)
     VALUES ($1,'Dossier catalogues',$2,(SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1),$3) RETURNING id`, [num, cl.rows[0].id, assoc.id]);
  dossierId = d.rows[0].id;
  await put(assoc, "/api/parametres/honoraires", { petite_caisse_plafond_depense: 25000, caisse_procedure_plafond_depense: 25000 });
  const mois = new Date().toISOString().slice(0, 8) + "01";
  await post(assoc, "/api/depenses/petite-caisse", { mois, montant_alloue: 500000000 });
  await post(assoc, "/api/depenses/petite-caisse", { mois, montant_alloue: 500000000, caisse: "procedure" });
});
afterAll(async () => {
  await pool.query("UPDATE parametres_cabinet SET petite_caisse_categories = DEFAULT, caisse_procedure_categories = DEFAULT, caisse_procedure_plafond_depense = 25000 WHERE id = 1");
  await pool.end();
});

describe("Un catalogue par caisse", () => {
  test("les listes par défaut reprennent exactement le catalogue de chaque caisse, sans la vignette", async () => {
    const pc = (await get(adminG, "/api/depenses/petite-caisse")).body.categories_autorisees;
    const pr = (await get(adminG, "/api/depenses/petite-caisse?caisse=procedure")).body.categories_autorisees;
    expect(pc).toEqual(expect.arrayContaining(["transport", "frais_reception", "boissons", "produits_entretien", "desodorisants", "entretien_vehicule"]));
    expect(pc).not.toContain("loyer");
    expect(pc).not.toContain("frais_greffe");
    expect(pr).toEqual(expect.arrayContaining(["frais_greffe", "timbres_enregistrement", "extraits_pieces", "traduction", "annonces_legales", "frais_grosse"]));
    expect(pr).not.toContain("vignette_plaidoirie");
    expect(pr).not.toContain("transport");
  });

  test("les réglages refusent une charge du cabinet sur la caisse de justice, un frais de justice ou une charge hors catalogue sur la petite caisse", async () => {
    const r1 = await put(assoc, "/api/parametres/honoraires", { caisse_procedure_categories: ["frais_greffe", "transport"] });
    expect(r1.status).toBe(400);
    expect(r1.body.error).toMatch(/frais de procédure/);
    const r2 = await put(assoc, "/api/parametres/honoraires", { petite_caisse_categories: ["transport", "loyer"] });
    expect(r2.status).toBe(400);
    const r3 = await put(assoc, "/api/parametres/honoraires", { caisse_procedure_categories: ["vignette_plaidoirie"] });
    expect(r3.status).toBe(400);
    expect((await put(assoc, "/api/parametres/honoraires", { caisse_procedure_categories: ["frais_greffe", "traduction"] })).status).toBe(200);
    await pool.query("UPDATE parametres_cabinet SET caisse_procedure_categories = DEFAULT WHERE id = 1");
  });

  test("une charge du cabinet ne s'engage pas sur la caisse de justice, même si la base la contient", async () => {
    await pool.query("UPDATE parametres_cabinet SET caisse_procedure_categories = ARRAY['frais_greffe','transport'] WHERE id = 1");
    const refus = await engagerProc({ categorie: "transport", precision_nature: undefined });
    expect(refus.status).toBe(409);
    await pool.query("UPDATE parametres_cabinet SET caisse_procedure_categories = DEFAULT WHERE id = 1");
  });

  test("les nouvelles natures de la petite caisse s'engagent ; le dossier reste obligatoire sur la caisse de justice", async () => {
    const ok = await post(adminG, "/api/depenses/engager", { libelle: "Jus et sucre", montant: 4000, categorie: "boissons", beneficiaire: "Supérette", mode_paiement: "especes" });
    expect(ok.status).toBe(201);
    expect((await engagerProc({ dossier_id: undefined })).status).toBe(400);
  });
});

describe("Frais de greffe : on précise lequel", () => {
  test("la précision est obligatoire, validée, mémorisée et affichée en liste", async () => {
    expect((await engagerProc({ precision_nature: undefined })).status).toBe(400);
    expect((await engagerProc({ precision_nature: "inconnue" })).status).toBe(400);
    const ok = await engagerProc({ precision_nature: "acte_appel" });
    expect(ok.status).toBe(201);
    const ligne = (await get(assoc, "/api/depenses")).body.find((d) => d.id === ok.body.id);
    expect(ligne.categorie).toBe("frais_greffe");
    expect(ligne.precision_nature).toBe("acte_appel");
    expect(ligne.refacturable_client).toBe(false); // décoché par défaut
  });

  test("correction : la précision se modifie ; changer de nature l'efface", async () => {
    const e = await engagerProc({ precision_nature: "copies" });
    const maj = await put(adminG, `/api/depenses/${e.body.id}/engagee`, { precision_nature: "certificats" });
    expect(maj.status).toBe(200);
    expect((await get(assoc, "/api/depenses")).body.find((d) => d.id === e.body.id).precision_nature).toBe("certificats");
    const autre = await put(adminG, `/api/depenses/${e.body.id}/engagee`, { categorie: "frais_huissier" });
    expect(autre.status).toBe(200);
    expect((await get(assoc, "/api/depenses")).body.find((d) => d.id === e.body.id).precision_nature).toBeNull();
  });

  test("circuit normal : la précision est aussi exigée", async () => {
    const sans = await post(assoc, "/api/depenses", { type: "ponctuelle", libelle: "Greffe", montant: 8000, categorie: "frais_greffe" });
    expect(sans.status).toBe(400);
    const avec = await post(assoc, "/api/depenses", { type: "ponctuelle", libelle: "Greffe", montant: 8000, categorie: "frais_greffe", precision_nature: "certificats" });
    expect(avec.status).toBe(201);
  });
});

describe("Plafond de la petite caisse", () => {
  test("le plafond par défaut de la petite caisse est 25 000 FCFA", async () => {
    await pool.query("UPDATE parametres_cabinet SET petite_caisse_plafond_depense = DEFAULT WHERE id = 1");
    const { rows: [p] } = await pool.query("SELECT petite_caisse_plafond_depense AS p FROM parametres_cabinet WHERE id = 1");
    expect(Number(p.p)).toBe(25000);
  });
});
