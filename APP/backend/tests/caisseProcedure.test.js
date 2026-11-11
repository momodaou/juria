// JURIA — Caisse « frais de justice & débours », lot D (11/11/2026) : deuxième caisse sur le moteur de la petite caisse
// (dotation et solde propres, plafond 25 000 FCFA, natures propres, dossier obligatoire, refacturable par défaut).
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
  const hash = await bcrypt.hash("TestPr123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Procedure',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`R${sfx.slice(0, 7)}`, `test.pr.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Procedure" }, SECRET, { expiresIn: "1h" }) };
}
const get = (u, url) => request(app).get(url).set(auth(u));
const post = (u, url, body = {}) => request(app).post(url).set(auth(u)).send(body);
const moisCourant = () => new Date().toISOString().slice(0, 8) + "01";
let adminG, assoc, dossierId;
const engager = (extra = {}) => post(adminG, "/api/depenses/engager", {
  caisse: "procedure", libelle: "Frais de greffe", montant: 10000, categorie: "frais_grosse",
  beneficiaire: "Greffe du tribunal " + Math.random().toString(36).slice(2, 6), dossier_id: dossierId, mode_paiement: "especes", ...extra });

beforeAll(async () => {
  await assurerUtilisateurTest();
  adminG = await creer("admin_general");
  assoc = await creer("associe");
  const cl = await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', 'Client caisse procédure') RETURNING id");
  const num = "CPR-" + Math.random().toString(36).slice(2, 7).toUpperCase();
  const d = await pool.query(
    `INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id)
     VALUES ($1,'Dossier caisse procédure',$2,(SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1),$3) RETURNING id`, [num, cl.rows[0].id, assoc.id]);
  dossierId = d.rows[0].id;
  await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_plafond_depense: 50000 });
  await post(assoc, "/api/depenses/petite-caisse", { mois: moisCourant(), montant_alloue: 500000000 });
  await post(assoc, "/api/depenses/petite-caisse", { mois: moisCourant(), montant_alloue: 300000, caisse: "procedure" });
});
afterAll(async () => {
  await pool.query("UPDATE parametres_cabinet SET caisse_procedure_plafond_depense = 25000, caisse_procedure_categories = DEFAULT WHERE id = 1");
  await pool.end();
});

describe("Dotation et solde propres", () => {
  test("chaque caisse a sa dotation et son solde ; le plafond par défaut est 25 000 FCFA", async () => {
    const pr = (await get(adminG, "/api/depenses/petite-caisse?caisse=procedure")).body;
    const pc = (await get(adminG, "/api/depenses/petite-caisse")).body;
    expect(pr.caisse).toBe("procedure");
    expect(pr.dotation).toBe(300000);
    expect(pc.dotation).toBe(500000000);
    expect(Number(pr.plafond_depense)).toBe(25000);
    expect(pr.categories_autorisees).toContain("frais_consignation");
    expect(pr.categories_autorisees).not.toContain("fournitures");
    const histo = (await get(assoc, "/api/depenses/petite-caisse/dotations?caisse=procedure")).body;
    expect(histo.map((x) => Number(x.montant_alloue))).toContain(300000);
    expect(histo.map((x) => Number(x.montant_alloue))).not.toContain(500000000);
  });
});

describe("Engagement sur la caisse frais de justice & débours", () => {
  test("dossier obligatoire, nature de la liste, plafond de 25 000 FCFA", async () => {
    expect((await engager({ dossier_id: undefined })).status).toBe(400);
    expect((await engager({ categorie: "fournitures" })).status).toBe(409);
    const gros = await engager({ montant: 30000 });
    expect(gros.status).toBe(409);
    expect(gros.body.error).toMatch(/plafond/);
    const ok = await engager({ montant: 25000 });
    expect(ok.status).toBe(201);
  });

  test("débours non refacturé par défaut (inclus dans les honoraires), refacturable si le cabinet le coche, liée au dossier, jamais en petite caisse ; soldes séparés", async () => {
    const av = (await get(adminG, "/api/depenses/petite-caisse?caisse=procedure")).body;
    const avPc = (await get(adminG, "/api/depenses/petite-caisse")).body;
    const r = await engager({ montant: 12000, libelle: "Consignation test" });
    expect(r.status).toBe(201);
    const ligne = (await get(assoc, "/api/depenses")).body.find((d) => d.id === r.body.id);
    expect(ligne.caisse_procedure).toBe(true);
    expect(ligne.petite_caisse).toBe(false);
    expect(ligne.refacturable_client).toBe(false);
    expect(ligne.dossier_id).toBe(dossierId);
    expect(ligne.apres_coup_statut).toBe("a_valider");
    const ap = (await get(adminG, "/api/depenses/petite-caisse?caisse=procedure")).body;
    const apPc = (await get(adminG, "/api/depenses/petite-caisse")).body;
    expect(ap.depense - av.depense).toBe(12000);
    expect(apPc.depense).toBe(avPc.depense);
    // possibilité de décocher le remboursement par le client
    const nr = await engager({ montant: 5000, refacturable_client: true });
    expect((await get(assoc, "/api/depenses")).body.find((d) => d.id === nr.body.id).refacturable_client).toBe(true);
  });

  test("caisse non dotée pour le mois : refusé", async () => {
    const r = await engager({ date_depense: "2031-03-10" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/dotée/);
  });

  test("cumul sur 7 jours : même bénéficiaire, même nature, même dossier au-delà du plafond", async () => {
    const b = "Huissier cumul " + Math.random().toString(36).slice(2, 6);
    expect((await engager({ montant: 20000, beneficiaire: b, categorie: "frais_huissier" })).status).toBe(201);
    expect((await engager({ montant: 20000, beneficiaire: b, categorie: "frais_huissier" })).status).toBe(409);
  });
});

describe("Séparation dans les listes et la synthèse", () => {
  test("filtre par caisse ; la synthèse a son bloc ; l'alerte parle de la bonne caisse", async () => {
    const avS = (await get(assoc, "/api/depenses/synthese")).body;
    const r = await engager({ montant: 7000, libelle: "Séparation test" });
    expect(r.status).toBe(201);
    const ids = async (c) => (await get(assoc, `/api/depenses?caisse=${c}`)).body.map((d) => d.id);
    expect(await ids("procedure")).toContain(r.body.id);
    expect(await ids("cabinet")).not.toContain(r.body.id);
    expect(await ids("petite_caisse")).not.toContain(r.body.id);
    const s = (await get(assoc, "/api/depenses/synthese")).body;
    expect(s.procedure.apres_coup.nb - avS.procedure.apres_coup.nb).toBe(1);
    expect(s.petite_caisse.apres_coup.nb).toBe(avS.petite_caisse.apres_coup.nb);
    const n = (await get(assoc, "/api/notifications")).body.filter((x) => x.type === "depense_apres_coup");
    expect(n.some((x) => /frais de justice & débours/.test(x.texte))).toBe(true);
  });

  test("rapprochement propre à chaque caisse", async () => {
    const r = await post(assoc, "/api/depenses/petite-caisse/rapprochement", { caisse: "procedure", solde_reel: 1000, mois: moisCourant() });
    expect(r.status).toBe(201);
    const lp = (await get(assoc, "/api/depenses/petite-caisse/rapprochements?caisse=procedure")).body;
    const lc = (await get(assoc, "/api/depenses/petite-caisse/rapprochements")).body;
    expect(lp.map((x) => x.id)).toContain(r.body.id);
    expect(lc.map((x) => x.id)).not.toContain(r.body.id);
  });
});

describe("Réglages", () => {
  test("plafond et natures de la caisse réglables par les associés, avec validation", async () => {
    const put = (corps) => request(app).put("/api/parametres/honoraires").set(auth(assoc)).send(corps);
    expect((await put({ caisse_procedure_categories: [] })).status).toBe(400);
    expect((await put({ caisse_procedure_categories: ["inconnue"] })).status).toBe(400);
    expect((await put({ caisse_procedure_plafond_depense: -5 })).status).toBe(400);
    const ok = await put({ caisse_procedure_plafond_depense: 40000, caisse_procedure_categories: ["frais_grosse", "frais_huissier"] });
    expect(ok.status).toBe(200);
    expect(Number(ok.body.caisse_procedure_plafond_depense)).toBe(40000);
    expect((await engager({ montant: 35000, categorie: "frais_grosse" })).status).toBe(201);
    expect((await engager({ categorie: "frais_consignation" })).status).toBe(409);
    expect((await get(assoc, "/api/parametres/honoraires")).body.caisse_procedure_categories).toEqual(["frais_grosse", "frais_huissier"]);
  });
});
