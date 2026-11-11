// JURIA — Dépenses & caisses, lot E (11/11/2026) : compteurs des onglets (cabinet / petite caisse) et filtres associés.
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
  const hash = await bcrypt.hash("TestSy123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Synthese',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`S${sfx.slice(0, 7)}`, `test.sy.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Synthese" }, SECRET, { expiresIn: "1h" }) };
}
const post = (u, url, body = {}) => request(app).post(url).set(auth(u)).send(body);
const synthese = async (u) => (await request(app).get("/api/depenses/synthese").set(auth(u))).body;
let adminG, assoc;

beforeAll(async () => {
  await assurerUtilisateurTest();
  adminG = await creer("admin_general");
  assoc = await creer("associe");
  await request(app).put("/api/parametres/honoraires").set(auth(assoc)).send({ petite_caisse_plafond_depense: 50000 });
  await post(assoc, "/api/depenses/petite-caisse", { mois: new Date().toISOString().slice(0, 8) + "01", montant_alloue: 500000000 });
});
afterAll(async () => { await pool.end(); });

describe("Synthèse des onglets", () => {
  test("le circuit normal fait bouger les compteurs du cabinet ; la petite caisse a les siens", async () => {
    const av = await synthese(assoc);
    const dep = await post(adminG, "/api/depenses", { type: "ponctuelle", libelle: "Synthèse", montant: 12345 });
    const id = dep.body.id;
    let s = await synthese(assoc);
    expect(s.cabinet.decider.nb - av.cabinet.decider.nb).toBe(1);
    expect(s.cabinet.decider.total - av.cabinet.decider.total).toBe(12345);
    await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee" });
    s = await synthese(assoc);
    expect(s.cabinet.decider.nb).toBe(av.cabinet.decider.nb);
    expect(s.cabinet.ordonner.nb - av.cabinet.ordonner.nb).toBe(1);
    await post(assoc, `/api/depenses/${id}/ordre-paiement`, { mode_paiement: "especes" });
    s = await synthese(assoc);
    expect(s.cabinet.ordonner.nb).toBe(av.cabinet.ordonner.nb);
    expect(s.cabinet.decaisser.nb - av.cabinet.decaisser.nb).toBe(1);
    await post(adminG, `/api/depenses/${id}/decaisser`, {});
    s = await synthese(assoc);
    expect(s.cabinet.decaisser.nb).toBe(av.cabinet.decaisser.nb);
    expect(s.cabinet.decaisse_mois.nb - av.cabinet.decaisse_mois.nb).toBe(1);
    // rien de tout cela ne touche la petite caisse
    expect(s.petite_caisse.decaisse_mois.nb).toBe(av.petite_caisse.decaisse_mois.nb);

    const e = await post(adminG, "/api/depenses/engager", { libelle: "Synthèse caisse", montant: 8000, categorie: "fournitures", beneficiaire: "Synth " + Math.random().toString(36).slice(2, 6), mode_paiement: "especes" });
    expect(e.status).toBe(201);
    s = await synthese(assoc);
    expect(s.petite_caisse.apres_coup.nb - av.petite_caisse.apres_coup.nb).toBe(1);
    expect(s.petite_caisse.decaisse_mois.nb - av.petite_caisse.decaisse_mois.nb).toBe(1);
    expect(s.cabinet.decaisse_mois.nb - av.cabinet.decaisse_mois.nb).toBe(1); // inchangé depuis la dépense du cabinet
  });

  test("les exécutants ne voient pas ce qui est réservé aux associés ; les filtres de la liste fonctionnent", async () => {
    const dep = await post(adminG, "/api/depenses", { type: "ponctuelle", libelle: "Synthèse filtre", montant: 700 });
    const id = dep.body.id;
    const sAdmin = await synthese(adminG);
    expect(sAdmin.cabinet.decider.nb).toBe(0);
    expect(sAdmin.cabinet.ordonner.nb).toBe(0);
    expect(sAdmin.petite_caisse.apres_coup.nb).toBe(0);
    await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee" });
    const sans = (await request(app).get("/api/depenses?statut=validee&ordre=sans_ordre").set(auth(assoc))).body;
    expect(sans.map((d) => d.id)).toContain(id);
    const donne = (await request(app).get("/api/depenses?statut=validee&ordre=donne").set(auth(assoc))).body;
    expect(donne.map((d) => d.id)).not.toContain(id);
    const aCoup = (await request(app).get("/api/depenses?apres_coup=a_valider").set(auth(assoc))).body;
    expect(aCoup.every((d) => d.apres_coup_statut === "a_valider")).toBe(true);
  });
});
