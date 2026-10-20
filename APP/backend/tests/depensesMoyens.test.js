// JURIA — dépenses : moyens de décaissement, compte compatible (jamais la CARPA),
// références exigées au paiement effectif (20/10/2026).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let banque; let carpa; let orange; let moov;
const auth = () => ({ Authorization: `Bearer ${token}` });
const mois = () => new Date().toISOString().slice(0, 8) + "01";

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  const cree = async (corps) => (await request(app).post("/api/parametres/comptes-bancaires").set(auth()).send(corps)).body.id;
  banque = await cree({ intitule: "BDM dépenses", type: "fonctionnement", banque: "BDM SA", numero: "800001" });
  carpa = await cree({ intitule: "CARPA dépenses", type: "carpa", banque: "BDM SA", numero: "800002" });
  orange = await cree({ intitule: "Orange dépenses", type: "mobile_money", operateur: "orange_money", telephone: "70000021" });
  moov = await cree({ intitule: "Moov dépenses", type: "mobile_money", operateur: "moov_money", telephone: "60000022" });
  await request(app).post("/api/depenses/petite-caisse").set(auth()).send({ mois: mois(), montant_alloue: 10000000 });
});
afterAll(async () => { await pool.end(); });

const creer = (extra) => request(app).post("/api/depenses").set(auth()).send({ type: "ponctuelle", libelle: "Dépense moyens", montant: 5000, ...extra });
const valider = async (id) => request(app).post(`/api/depenses/${id}/decision`).set(auth()).send({ statut: "validee" });
const decaisser = (id, corps = {}) => request(app).post(`/api/depenses/${id}/decaisser`).set(auth()).send(corps);
const ligne = async (id) => (await request(app).get("/api/depenses").set(auth())).body.find((d) => d.id === id);

describe("Moyens de décaissement", () => {
  test("catalogue : espèces sans compte, mobile money par opérateur, aucun moyen d'encaissement seul", async () => {
    const cat = (await request(app).get("/api/depenses/moyens-paiement").set(auth())).body;
    expect(cat.map((m) => m.code)).toEqual(expect.arrayContaining(["virement", "cheque", "especes", "orange_money", "moov_money"]));
    expect(cat.some((m) => ["western_union", "moneygram", "virement_etranger", "mobile_money", "autre"].includes(m.code))).toBe(false);
    expect(cat.find((m) => m.code === "orange_money").champs.find((c) => c.cle === "id_transaction").requis).toBe(true);
  });

  test("comptes proposés : fonctionnement et portefeuille du même opérateur, jamais la CARPA", async () => {
    const virement = (await request(app).get("/api/depenses/moyens-paiement/virement/comptes").set(auth())).body.map((c) => c.id);
    expect(virement).toContain(banque);
    expect(virement).not.toContain(carpa);
    const om = (await request(app).get("/api/depenses/moyens-paiement/orange_money/comptes").set(auth())).body.map((c) => c.id);
    expect(om).toContain(orange);
    expect(om).not.toContain(moov);
    expect((await request(app).get("/api/depenses/moyens-paiement/especes/comptes").set(auth())).body).toEqual([]);
    expect((await creer({ mode_paiement: "virement", compte_id: carpa })).status).toBe(400);
    expect((await creer({ mode_paiement: "orange_money", compte_id: banque })).status).toBe(400);
  });

  test("soumission : références facultatives ; moyen d'encaissement refusé", async () => {
    expect((await creer({ mode_paiement: "orange_money", compte_id: orange })).status).toBe(201);
    expect((await creer({ mode_paiement: "western_union" })).status).toBe(400);
    expect((await creer({})).status).toBe(201); // sans moyen : encore permis avant le paiement
  });

  test("décaissement : moyen et références exigés, enregistrés sur la dépense", async () => {
    const id = (await creer({ mode_paiement: "orange_money", compte_id: orange })).body.id;
    await valider(id);
    expect((await decaisser(id)).body.error).toMatch(/Identifiant de la transaction/);
    const ok = await decaisser(id, { references: { id_transaction: "MP260102.7777", beneficiaire: "Fournisseur X" } });
    expect(ok.status).toBe(200);
    const l = await ligne(id);
    expect(l.references_paiement.id_transaction).toBe("MP260102.7777");
    expect(l.compte).toBe("Orange dépenses");
  });

  test("décaissement sans moyen prévu : le moyen est précisé à ce moment-là ; espèces sans compte", async () => {
    const id = (await creer({})).body.id;
    await valider(id);
    expect((await decaisser(id)).status).toBe(400);
    expect((await decaisser(id, { mode_paiement: "cheque", compte_id: banque, references: { numero_cheque: "00099" } })).status).toBe(400); // bénéficiaire requis
    expect((await decaisser(id, { mode_paiement: "cheque", compte_id: banque, references: { numero_cheque: "00099", beneficiaire: "Imprimerie" } })).status).toBe(200);
    const e = (await creer({ mode_paiement: "especes", compte_id: banque })).body.id;
    expect((await ligne(e)).compte).toBeNull(); // espèces : aucun compte retenu
    await valider(e);
    expect((await decaisser(e)).status).toBe(200);
  });

  test("engagement petite caisse : références exigées", async () => {
    const eng = (extra) => request(app).post("/api/depenses/engager").set(auth()).send({ libelle: "Eau", montant: 3000, ...extra });
    expect((await eng({ mode_paiement: "orange_money" })).status).toBe(400);
    expect((await eng({ mode_paiement: "orange_money", references: { id_transaction: "MP1" } })).status).toBeLessThan(500);
  });

  test("modification d'une dépense soumise : changer de moyen remet les références à jour", async () => {
    const id = (await creer({ mode_paiement: "virement", compte_id: banque, references: { numero_operation: "V1" } })).body.id;
    const maj = await request(app).put(`/api/depenses/${id}`).set(auth()).send({ mode_paiement: "especes", references: { numero_piece: "P-5" } });
    expect(maj.status).toBe(200);
    const l = await ligne(id);
    expect(l.mode_paiement).toBe("especes");
    expect(l.references_paiement).toEqual({ numero_piece: "P-5" });
    expect(l.compte).toBeNull();
  });
});

describe("Comptes — la CARPA n'est jamais affichée par défaut sur les factures", () => {
  test("afficher_sur_factures : faux par défaut pour la CARPA, vrai pour le fonctionnement", async () => {
    const liste = (await request(app).get("/api/parametres/comptes-bancaires").set(auth())).body;
    expect(liste.find((c) => c.id === carpa).afficher_sur_factures).toBe(false);
    expect(liste.find((c) => c.id === banque).afficher_sur_factures).toBe(true);
  });
});
