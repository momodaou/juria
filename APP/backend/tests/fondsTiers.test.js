// JURIA — fonds de tiers (compte CARPA) : réception, reversement, imputation
// d'honoraires, solde, annulation (20/10/2026).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let associeId; let collab; let carpa; let fonct;
const auth = (t = associe) => ({ Authorization: `Bearer ${t}` });
const post = (url, corps, t) => request(app).post(url).set(auth(t)).send(corps);

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  associe = login.body.token; associeId = login.body.utilisateur.id;
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestFT123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','FT',$2,$3,'collaborateur',TRUE,now()) RETURNING id`,
    [`F${suffixe.slice(0, 7)}`, `test.ft.${suffixe}@jfcavocats-mali.com`, hash]);
  collab = jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Test FT" }, SECRET, { expiresIn: "1h" });
  const cree = async (corps) => (await post("/api/parametres/comptes-bancaires", corps)).body.id;
  carpa = await cree({ intitule: "CARPA test", type: "carpa", banque: "BDM SA", numero: "900001" });
  fonct = await cree({ intitule: "Fonctionnement test FT", type: "fonctionnement", banque: "BDM SA", numero: "900002" });
});
afterAll(async () => { await pool.end(); });

async function client() {
  return (await post("/api/clients", { type: "morale", denomination: `Client FT ${Date.now()}-${Math.random()}` })).body.id;
}
const soldeDe = async (clientId) => (await request(app).get("/api/fonds-tiers/soldes").set(auth())).body.filter((l) => l.client_id === clientId).reduce((s, l) => s + l.solde, 0);
const recevoir = (clientId, extra = {}) => post("/api/fonds-tiers/receptions", { client_id: clientId, montant: 1000000, mode: "virement", compte_id: carpa, tiers: "Débiteur SA", ...extra });
const reverser = (clientId, extra = {}) => post("/api/fonds-tiers/reversements", { client_id: clientId, montant: 400000, mode_paiement: "virement", compte_id: carpa, references: {}, tiers: "Client", ...extra });

describe("Fonds de tiers (CARPA)", () => {
  test("accès : un collaborateur ne consulte ni n'enregistre", async () => {
    expect((await request(app).get("/api/fonds-tiers/soldes").set(auth(collab))).status).toBe(403);
    expect((await post("/api/fonds-tiers/receptions", {}, collab)).status).toBe(403);
  });

  test("réception : sur la CARPA uniquement, solde calculé, moyens admis", async () => {
    const c = await client();
    expect((await recevoir(c, { compte_id: fonct })).status).toBe(400); // pas la CARPA
    expect((await recevoir(c, { mode: "orange_money" })).status).toBe(400); // pas de mobile money
    expect((await recevoir(c, { montant: 0 })).status).toBe(400);
    expect((await recevoir(c, { date_mouvement: "2999-01-01" })).status).toBe(400);
    expect((await recevoir(c, { mode: "cheque", references: { numero_cheque: "1" } })).status).toBe(400); // banque émettrice requise
    const ok = await recevoir(c);
    expect(ok.status).toBe(201);
    expect(ok.body.solde).toBe(1000000);
    expect(await soldeDe(c)).toBe(1000000);
    // une réception n'est jamais un paiement de facture
    const enc = (await request(app).get(`/api/factures/encaissements?client_id=${c}`).set(auth())).body;
    expect(enc.lignes).toHaveLength(0);
  });

  test("dossier : doit appartenir au client ; solde distinct par dossier", async () => {
    const c = await client(); const autre = await client();
    const d = (await post("/api/dossiers", { client_id: c, intitule: "Dossier FT", pole: "contentieux", matiere: "x", code_matiere: "CIV", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: associeId })).body.id;
    expect((await recevoir(autre, { dossier_id: d })).status).toBe(400);
    await recevoir(c, { dossier_id: d, montant: 300000 });
    await recevoir(c, { montant: 200000 });
    const lignes = (await request(app).get("/api/fonds-tiers/soldes").set(auth())).body.filter((l) => l.client_id === c);
    expect(lignes).toHaveLength(2);
    expect(lignes.find((l) => l.dossier_id === d).solde).toBe(300000);
    expect(await soldeDe(c)).toBe(500000);
    // reverser plus que le solde du dossier : refusé
    expect((await reverser(c, { dossier_id: d, montant: 300001 })).status).toBe(409);
    expect((await reverser(c, { dossier_id: d, montant: 300000 })).status).toBe(201);
  });

  test("reversement : solde suffisant, CARPA débitée, chèque ou virement seulement", async () => {
    const c = await client();
    await recevoir(c);
    expect((await reverser(c, { mode_paiement: "especes" })).status).toBe(400);
    expect((await reverser(c, { mode_paiement: "orange_money" })).status).toBe(400);
    expect((await reverser(c, { compte_id: fonct })).status).toBe(400);
    expect((await reverser(c, { mode_paiement: "cheque", references: { numero_cheque: "55" } })).status).toBe(400); // bénéficiaire requis
    const ok = await reverser(c);
    expect(ok.status).toBe(201);
    expect(ok.body.solde).toBe(600000);
    expect((await reverser(c, { montant: 600001 })).body.error).toMatch(/Solde insuffisant/);
    expect(await soldeDe(c)).toBe(600000);
  });

  test("imputation d'honoraires : crée un paiement, solde et facture à jour, annulation réversible", async () => {
    const c = await client();
    await recevoir(c);
    const f = (await post("/api/factures", { client_id: c, mode: "forfait", montant_ht: 300000, taux_tva: 0 })).body;
    expect((await post("/api/fonds-tiers/imputations", { client_id: c, facture_id: f.id, montant: 100000, compte_id: carpa })).status).toBe(400); // pas la CARPA
    expect((await post("/api/fonds-tiers/imputations", { client_id: c, facture_id: f.id, montant: 400000, compte_id: fonct })).body.error).toMatch(/reliquat/);
    const imp = await post("/api/fonds-tiers/imputations", { client_id: c, facture_id: f.id, montant: 100000, compte_id: fonct, numero_operation: "VIR-CARPA-1" });
    expect(imp.status).toBe(201);
    expect(imp.body.statut_facture).toBe("partielle");
    expect(await soldeDe(c)).toBe(900000);
    const pmts = (await request(app).get(`/api/factures/${f.id}/paiements`).set(auth())).body;
    expect(pmts).toHaveLength(1);
    expect(pmts[0].compte_intitule).toBe("Fonctionnement test FT");
    expect(pmts[0].references_paiement.origine).toBe("fonds_tiers");
    // le paiement ne se supprime pas depuis la facture
    expect((await request(app).delete(`/api/factures/${f.id}/paiements/${pmts[0].id}`).set(auth())).status).toBe(409);
    // annulation de l'imputation : paiement retiré, solde et statut rétablis
    expect((await post(`/api/fonds-tiers/${imp.body.id}/annuler`, {})).status).toBe(400); // motif requis
    expect((await post(`/api/fonds-tiers/${imp.body.id}/annuler`, { motif: "Erreur de facture" })).status).toBe(200);
    expect(await soldeDe(c)).toBe(1000000);
    expect((await request(app).get(`/api/factures/${f.id}/paiements`).set(auth())).body).toHaveLength(0);
    const apres = (await request(app).get(`/api/factures?client_id=${c}`).set(auth())).body[0];
    expect(apres.statut).toBe("emise");
    expect((await post(`/api/fonds-tiers/${imp.body.id}/annuler`, { motif: "encore" })).status).toBe(409);
  });

  test("annulation d'une réception : seulement si les fonds n'ont pas été utilisés", async () => {
    const c = await client();
    const r1 = await recevoir(c, { montant: 500000 });
    await recevoir(c, { montant: 500000 });
    await reverser(c, { montant: 900000 });
    expect((await post(`/api/fonds-tiers/${r1.body.id}/annuler`, { motif: "Doublon" })).status).toBe(409);
    const c2 = await client();
    const r2 = await recevoir(c2);
    expect((await post(`/api/fonds-tiers/${r2.body.id}/annuler`, { motif: "Doublon de saisie" })).status).toBe(200);
    expect(await soldeDe(c2)).toBe(0);
    const liste = (await request(app).get(`/api/fonds-tiers/mouvements?client_id=${c2}`).set(auth())).body;
    expect(liste[0].statut).toBe("annule");
    expect(liste[0].annule_motif).toBe("Doublon de saisie");
  });

  test("catalogues : moyens de réception et de reversement, comptes CARPA", async () => {
    const rec = (await request(app).get("/api/fonds-tiers/moyens/reception").set(auth())).body.map((m) => m.code);
    expect(rec).toEqual(expect.arrayContaining(["virement", "virement_etranger", "cheque", "especes"]));
    expect(rec).not.toContain("orange_money");
    const rev = (await request(app).get("/api/fonds-tiers/moyens/reversement").set(auth())).body.map((m) => m.code);
    expect(rev.sort()).toEqual(["cheque", "virement"]);
    const comptes = (await request(app).get("/api/fonds-tiers/comptes").set(auth())).body.map((c) => c.id);
    expect(comptes).toContain(carpa);
    expect(comptes).not.toContain(fonct);
  });
});
