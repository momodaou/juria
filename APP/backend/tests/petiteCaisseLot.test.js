// JURIA — petite caisse, audit du 29/10/2026 : dotation normalisée au 1er du mois (et remise à zéro possible),
// trace d'audit, engagement avec catégorie / bénéficiaire, bénéficiaire saisi une seule fois (dépense <-> moyen).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let orange;
const auth = () => ({ Authorization: `Bearer ${token}` });
const put = (u, c = {}) => request(app).put(u).set(auth()).send(c);
const post = (u, c = {}) => request(app).post(u).set(auth()).send(c);
const get = (u) => request(app).get(u).set(auth());
// Mois lointain : n'interfère pas avec les autres campagnes.
const MOIS = "2038-04";

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  orange = (await post("/api/parametres/comptes-bancaires", { intitule: "Orange caisse lot", type: "mobile_money", operateur: "orange_money", telephone: "70000099" })).body.id;
  await put("/api/parametres/honoraires", { petite_caisse_plafond_depense: 80000 });
});
afterAll(async () => {
  await pool.query("DELETE FROM dotations_petite_caisse WHERE mois >= '2038-01-01'");
  await pool.end();
});

describe("Dotation de la petite caisse", () => {
  test("une date en milieu de mois est ramenée au 1er ; le solde du mois la retrouve", async () => {
    const r = await post("/api/depenses/petite-caisse", { mois: `${MOIS}-15`, montant_alloue: 200000 });
    expect(r.status).toBe(201);
    expect(r.body.mois).toBe(`${MOIS}-01`);
    const s = (await get(`/api/depenses/petite-caisse?mois=${MOIS}-20`)).body;
    expect(s.dotation).toBe(200000);
    expect(s.solde).toBe(200000);
  });

  test("« AAAA-MM » accepté ; montant négatif / décimal / mois invalide refusés ; 0 remet la caisse à zéro", async () => {
    expect((await post("/api/depenses/petite-caisse", { mois: MOIS, montant_alloue: 150000 })).status).toBe(201);
    expect((await get(`/api/depenses/petite-caisse?mois=${MOIS}-01`)).body.dotation).toBe(150000);
    expect((await post("/api/depenses/petite-caisse", { mois: MOIS, montant_alloue: -5 })).status).toBe(400);
    expect((await post("/api/depenses/petite-caisse", { mois: MOIS, montant_alloue: 10.5 })).status).toBe(400);
    expect((await post("/api/depenses/petite-caisse", { mois: "n'importe quoi", montant_alloue: 5 })).status).toBe(400);
    expect((await post("/api/depenses/petite-caisse", { mois: MOIS, montant_alloue: 0 })).status).toBe(201);
    const s = (await get(`/api/depenses/petite-caisse?mois=${MOIS}-01`)).body;
    expect(s.dotation).toBe(0);
    expect(s.solde).toBe(0);
  });

  test("création et correction sont tracées dans le journal d'audit (avant / après)", async () => {
    const a = await pool.query(
      "SELECT action, details FROM journal_audit WHERE action IN ('doter_petite_caisse','corriger_dotation_petite_caisse') AND details->>'mois' = $1 ORDER BY id", [`${MOIS}-01`]);
    expect(a.rows.length).toBeGreaterThanOrEqual(3);
    expect(a.rows[0].action).toBe("doter_petite_caisse");
    expect(a.rows[1].action).toBe("corriger_dotation_petite_caisse");
    expect(a.rows[a.rows.length - 1].details.apres).toBe(0);
  });
});

describe("Engagement d'une petite dépense", () => {
  test("catégorie, bénéficiaire, justificatif et dossier sont enregistrés ; bénéficiaire reporté dans les références", async () => {
    const jour = `${MOIS}-10`;
    await post("/api/depenses/petite-caisse", { mois: MOIS, montant_alloue: 100000 });
    const e = await post("/api/depenses/engager", { libelle: "Crédit téléphonique", montant: 5000, categorie: "credit_telephonique", beneficiaire: "Orange Mali",
      justificatif: true, mode_paiement: "orange_money", compte_id: orange, date_depense: jour, references: { id_transaction: "MP-LOT-1" } });
    expect(e.status).toBe(201);
    const l = (await get("/api/depenses")).body.find((d) => d.id === e.body.id);
    expect(l).toMatchObject({ categorie: "credit_telephonique", beneficiaire: "Orange Mali", justificatif: true, petite_caisse: true });
    expect(l.references_paiement).toMatchObject({ id_transaction: "MP-LOT-1", beneficiaire: "Orange Mali" });
  });

  test("le bénéficiaire saisi dans le moyen de paiement alimente le champ de la dépense (une seule saisie)", async () => {
    const e = await post("/api/depenses/engager", { libelle: "Taxi", montant: 3000, categorie: "transport", mode_paiement: "orange_money", compte_id: orange,
      date_depense: `${MOIS}-11`, references: { id_transaction: "MP-LOT-2", beneficiaire: "Chauffeur X" } });
    expect(e.status).toBe(201);
    expect((await get("/api/depenses")).body.find((d) => d.id === e.body.id).beneficiaire).toBe("Chauffeur X");
  });
});

describe("Décaissement : bénéficiaire pré-rempli depuis la dépense", () => {
  test("un chèque (bénéficiaire obligatoire) se décaisse sans ressaisir le bénéficiaire déjà connu", async () => {
    const banque = (await post("/api/parametres/comptes-bancaires", { intitule: "BDM lot", type: "fonctionnement", banque: "BDM SA", numero: "830001" })).body.id;
    const d = await post("/api/depenses", { type: "ponctuelle", categorie: "papeterie", libelle: "Papier", montant: 40000, beneficiaire: "Librairie Lot", mode_paiement: "cheque", compte_id: banque });
    expect(d.status).toBe(201);
    expect((await post(`/api/depenses/${d.body.id}/decision`, { statut: "validee" })).status).toBe(200);
    const ok = await post(`/api/depenses/${d.body.id}/decaisser`, { mode_paiement: "cheque", compte_id: banque, references: { numero_cheque: "0042" } });
    expect(ok.status).toBe(200);
    const l = (await get("/api/depenses")).body.find((x) => x.id === d.body.id);
    expect(l.references_paiement).toMatchObject({ numero_cheque: "0042", beneficiaire: "Librairie Lot" });
  });
});
