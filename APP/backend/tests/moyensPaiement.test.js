// JURIA — moyens d'encaissement : références propres à chaque moyen, compte
// crédité compatible, frais retenus, espèces en attente de dépôt (20/10/2026).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let banque; let orange; let moov;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  const cree = async (corps) => (await request(app).post("/api/parametres/comptes-bancaires").set(auth()).send(corps)).body.id;
  banque = await cree({ intitule: "BDM test moyens", type: "fonctionnement", banque: "BDM SA", numero: "700001" });
  orange = await cree({ intitule: "Orange test moyens", type: "mobile_money", operateur: "orange_money", telephone: "70000011" });
  moov = await cree({ intitule: "Moov test moyens", type: "mobile_money", operateur: "moov_money", telephone: "60000012" });
});
afterAll(async () => { await pool.end(); });

async function facture(montant = 100000) {
  const c = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client moyens ${Date.now()}-${Math.random()}` });
  const f = (await request(app).post("/api/factures").set(auth()).send({ client_id: c.body.id, mode: "forfait", montant_ht: montant, taux_tva: 0 })).body;
  return { ...f, client_id: c.body.id };
}
const payer = (id, corps) => request(app).post(`/api/factures/${id}/paiements`).set(auth()).send(corps);
const historique = async (id) => (await request(app).get(`/api/factures/${id}/paiements`).set(auth())).body;

describe("Moyens d'encaissement", () => {
  test("catalogue : une seule liste, avec les champs requis de chaque moyen", async () => {
    const cat = (await request(app).get("/api/factures/moyens-paiement").set(auth())).body;
    expect(cat.map((m) => m.code)).toEqual(expect.arrayContaining(
      ["virement", "virement_etranger", "cheque", "especes", "orange_money", "moov_money", "western_union", "moneygram"]));
    expect(cat.some((m) => m.code === "autre" || m.code === "mobile_money")).toBe(false);
    const cheque = cat.find((m) => m.code === "cheque");
    expect(cheque.champs.filter((c) => c.requis).map((c) => c.cle)).toEqual(["numero_cheque", "banque_emettrice"]);
    expect(cat.find((m) => m.code === "virement_etranger").frais).toBe(true);
    expect(cat.find((m) => m.code === "virement").frais).toBe(false);
  });

  test("références requises selon le moyen", async () => {
    const f = await facture();
    expect((await payer(f.id, { montant: 1000, mode: "cheque", compte_id: banque })).status).toBe(400);
    expect((await payer(f.id, { montant: 1000, mode: "orange_money", compte_id: orange })).body.error).toMatch(/Identifiant de la transaction/);
    expect((await payer(f.id, { montant: 1000, mode: "western_union", compte_id: banque })).status).toBe(400);
    expect((await payer(f.id, { montant: 1000, mode: "virement_etranger", compte_id: banque, references: { pays_emetteur: "France" } })).status).toBe(400);
    expect((await payer(f.id, { montant: 1000, mode: "mobile_money" })).status).toBe(400); // ancien moyen non accepté
    const ok = await payer(f.id, { montant: 1000, mode: "cheque", compte_id: banque, references: { numero_cheque: "0001234", banque_emettrice: "Ecobank", tireur: "Client SA" } });
    expect(ok.status).toBe(201);
    const p = (await historique(f.id))[0];
    expect(p.references_paiement.numero_cheque).toBe("0001234");
    expect(p.reference).toBe("0001234");
    expect(p.compte_intitule).toBe("BDM test moyens");
  });

  test("compte compatible avec le moyen : mobile money = portefeuille du même opérateur", async () => {
    const f = await facture();
    const mm = { id_transaction: "MP260101.1234" };
    expect((await payer(f.id, { montant: 1000, mode: "orange_money", compte_id: banque, references: mm })).body.error).toMatch(/ne peut pas recevoir/);
    expect((await payer(f.id, { montant: 1000, mode: "orange_money", compte_id: moov, references: mm })).status).toBe(400);
    expect((await payer(f.id, { montant: 1000, mode: "orange_money", compte_id: orange, references: mm })).status).toBe(201);
    expect((await payer(f.id, { montant: 1000, mode: "virement", compte_id: orange })).status).toBe(400);
    const comptes = (await request(app).get("/api/factures/moyens-paiement/orange_money/comptes").set(auth())).body;
    expect(comptes.map((c) => c.id)).toContain(orange);
    expect(comptes.map((c) => c.id)).not.toContain(moov);
    expect(comptes.map((c) => c.id)).not.toContain(banque);
  });

  test("frais retenus : montant reçu net ; refusés sur un moyen sans frais, plafonnés au montant", async () => {
    const f = await facture();
    const ref = { pays_emetteur: "France", banque_emettrice: "BNP" };
    expect((await payer(f.id, { montant: 50000, mode: "virement_etranger", compte_id: banque, references: ref, frais_retenus: 60000 })).status).toBe(400);
    expect((await payer(f.id, { montant: 50000, mode: "virement_etranger", compte_id: banque, references: ref, frais_retenus: 4500 })).status).toBe(201);
    const p = (await historique(f.id))[0];
    expect(Number(p.frais_retenus)).toBe(4500);
    expect(Number(p.montant_recu_net)).toBe(45500);
    // virement local : le champ frais est ignoré
    await payer(f.id, { montant: 1000, mode: "virement", compte_id: banque, frais_retenus: 999 });
    const v = (await historique(f.id)).find((x) => x.mode === "virement");
    expect(Number(v.frais_retenus)).toBe(0);
    // la facture est imputée du montant payé, pas du net
    const liste = (await request(app).get(`/api/factures/encaissements?client_id=${f.client_id}`).set(auth())).body;
    expect(liste.lignes.length).toBe(2);
    expect(liste.lignes.every((l) => l.compte_intitule === "BDM test moyens")).toBe(true);
  });

  test("frais à la charge du client : seule la somme nette est imputée, la facture reste due des frais", async () => {
    const f = await facture();
    const ref = { pays_emetteur: "France", banque_emettrice: "BNP" };
    const r = await payer(f.id, { montant: 50000, mode: "virement_etranger", compte_id: banque, references: ref, frais_retenus: 4500, frais_a_charge: "client" });
    expect(r.status).toBe(201);
    expect(r.body.reliquat).toBe(100000 - 45500);
    const p = (await historique(f.id))[0];
    expect(Number(p.montant)).toBe(45500);
    expect(Number(p.montant_verse)).toBe(50000);
    expect(Number(p.montant_recu_net)).toBe(45500);
    expect(p.frais_a_charge).toBe("client");
    // à la charge du cabinet : le montant payé est imputé en entier
    const g = await facture();
    await payer(g.id, { montant: 50000, mode: "virement_etranger", compte_id: banque, references: ref, frais_retenus: 4500, frais_a_charge: "cabinet" });
    const q = (await historique(g.id))[0];
    expect(Number(q.montant)).toBe(50000);
    expect(Number(q.montant_recu_net)).toBe(45500);
    // des frais qui absorbent tout le paiement sont refusés
    expect((await payer(g.id, { montant: 4000, mode: "virement_etranger", compte_id: banque, references: ref, frais_retenus: 4000, frais_a_charge: "client" })).status).toBe(400);
  });

  test("frais : par défaut à la charge du client si la facture le mentionne", async () => {
    const c = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client mention ${Date.now()}` });
    const f = (await request(app).post("/api/factures").set(auth()).send({ client_id: c.body.id, mode: "forfait", montant_ht: 100000, taux_tva: 0, mention: "Frais de virement à la charge du client" })).body;
    await payer(f.id, { montant: 30000, mode: "orange_money", compte_id: orange, references: { id_transaction: "MP9" }, frais_retenus: 500 });
    expect((await historique(f.id))[0].frais_a_charge).toBe("client");
  });

  test("espèces : en attente de dépôt, puis déposées en banque", async () => {
    const f = await facture();
    expect((await payer(f.id, { montant: 20000, mode: "especes", references: { numero_recu: "R-77" } })).status).toBe(201);
    const p = (await historique(f.id))[0];
    expect(p.depot_statut).toBe("en_attente");
    expect(p.compte_id).toBeNull();
    const attente = (await request(app).get("/api/factures/especes-a-deposer").set(auth())).body;
    expect(attente.some((x) => x.id === p.id && x.numero_recu === "R-77")).toBe(true);
    expect((await request(app).post(`/api/factures/paiements/${p.id}/depot`).set(auth()).send({ compte_id: orange })).status).toBe(400);
    expect((await request(app).post(`/api/factures/paiements/${p.id}/depot`).set(auth()).send({})).status).toBe(400);
    expect((await request(app).post(`/api/factures/paiements/${p.id}/depot`).set(auth()).send({ compte_id: banque, date_depot: "2999-01-01" })).status).toBe(400);
    expect((await request(app).post(`/api/factures/paiements/${p.id}/depot`).set(auth()).send({ compte_id: banque })).status).toBe(200);
    const apres = (await historique(f.id))[0];
    expect(apres.depot_statut).toBe("depose");
    expect(apres.compte_intitule).toBe("BDM test moyens");
    expect((await request(app).get("/api/factures/especes-a-deposer").set(auth())).body.some((x) => x.id === p.id)).toBe(false);
    expect((await request(app).post(`/api/factures/paiements/${p.id}/depot`).set(auth()).send({ compte_id: banque })).status).toBe(409);
  });

  test("espèces avec un compte de dépôt indiqué d'emblée : déposées", async () => {
    const f = await facture();
    await payer(f.id, { montant: 5000, mode: "especes", compte_id: banque });
    expect((await historique(f.id))[0].depot_statut).toBe("depose");
  });

  test("acompte à l'émission : mêmes règles (références requises, compte par défaut de la facture)", async () => {
    const c = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client acompte ${Date.now()}` });
    const base = { client_id: c.body.id, mode: "forfait", montant_ht: 100000, taux_tva: 0 };
    const sans = await request(app).post("/api/factures").set(auth()).send({ ...base, acompte: { montant: 10000, mode: "cheque" } });
    expect(sans.status).toBe(400);
    const ok = await request(app).post("/api/factures").set(auth()).send({ ...base, compte_reglement_id: banque, mode_reglement: "virement",
      acompte: { montant: 10000, mode: "virement" } });
    expect(ok.status).toBe(201);
    expect((await historique(ok.body.id))[0].compte_id).toBe(banque);
  });
});

describe("Correction du moyen d'un paiement enregistré et du moyen de règlement d'une facture (29/10/2026)", () => {
  test("moyen, références et compte d'un paiement corrigés sans toucher au montant ni au statut ; trace avant / après", async () => {
    const f = await facture(50000);
    expect((await payer(f.id, { montant: 20000, mode: "virement", compte_id: banque, references: { numero_operation: "V-ERREUR" } })).status).toBe(201);
    const p = (await historique(f.id))[0];
    const url = `/api/factures/${f.id}/paiements/${p.id}`;
    const ok = await request(app).put(url).set(auth()).send({ mode: "cheque", compte_id: banque, references: { numero_cheque: "0004321", banque_emettrice: "Ecobank" } });
    expect(ok.status).toBe(200);
    const apres = (await historique(f.id))[0];
    expect(apres.mode).toBe("cheque");
    expect(apres.references_paiement.numero_cheque).toBe("0004321");
    expect(Number(apres.montant)).toBe(20000);
    expect((await request(app).get("/api/factures").set(auth())).body.find((x) => x.id === f.id).statut).toBe("partielle");
    const audit = await pool.query("SELECT details FROM journal_audit WHERE action = 'corriger_paiement' AND entite_id = $1", [f.id]);
    expect(audit.rows[0].details.avant.mode).toBe("virement");
    expect(audit.rows[0].details.apres.mode).toBe("cheque");
  });

  test("refus : références manquantes, compte incompatible, date future, paiement inconnu, facture annulée", async () => {
    const f = await facture(30000);
    await payer(f.id, { montant: 10000, mode: "virement", compte_id: banque });
    const p = (await historique(f.id))[0];
    const url = `/api/factures/${f.id}/paiements/${p.id}`;
    const put = (corps) => request(app).put(url).set(auth()).send(corps);
    expect((await put({ mode: "cheque", compte_id: banque })).status).toBe(400); // n° de chèque requis
    expect((await put({ mode: "orange_money", compte_id: banque, references: { id_transaction: "X1" } })).status).toBe(400); // compte incompatible
    expect((await put({ date_paiement: "2999-01-01" })).status).toBe(400);
    expect((await request(app).put(`/api/factures/${f.id}/paiements/00000000-0000-0000-0000-000000000000`).set(auth()).send({ mode: "virement" })).status).toBe(404);
    await request(app).delete(url).set(auth());
    const g = await facture(30000);
    expect((await request(app).post(`/api/factures/${g.id}/annuler`).set(auth()).send({})).status).toBe(200);
  });

  test("moyen de règlement de la facture : corrigeable sur une facture payée, valeur inconnue refusée", async () => {
    const f = await facture(40000);
    await payer(f.id, { montant: 40000, mode: "virement", compte_id: banque });
    const maj = await request(app).put(`/api/factures/${f.id}`).set(auth()).send({ mode_reglement: "cheque", compte_reglement_id: banque, mention: "Règlement par chèque" });
    expect(maj.status).toBe(200);
    const ligne = (await request(app).get("/api/factures").set(auth())).body.find((x) => x.id === f.id);
    expect(ligne.mode_reglement).toBe("cheque");
    expect(ligne.statut).toBe("payee");
    expect((await request(app).put(`/api/factures/${f.id}`).set(auth()).send({ mode_reglement: "troc" })).status).toBe(400);
  });
});
