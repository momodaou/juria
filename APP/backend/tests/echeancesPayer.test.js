// JURIA — rubrique « Charges fiscales et sociales à payer » (12/11/2026) : paiement d'une échéance par le circuit normal des dépenses,
// clôture au décaissement, « Marquer traité » sans dépense décaissée, catégorie absente de l'état mensuel.
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
  const hash = await bcrypt.hash("TestEch123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Ech',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`E${sfx.slice(0, 7)}`, `test.ec.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Ech" }, SECRET, { expiresIn: "1h" }) };
}
const jourPlus = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let assoc1, assoc2;
beforeAll(async () => {
  await assurerUtilisateurTest();
  assoc1 = await creer("associe");
  assoc2 = await creer("associe");
});
afterAll(async () => { await pool.end(); });

async function nouvelleEcheance(extra = {}) {
  const r = await request(app).post("/api/echeances-administratives").set(auth(assoc1)).send({
    categorie: "fiscale", libelle: "TVA test " + Math.random().toString(36).slice(2, 6), periodicite: "mensuelle", prochaine_date: jourPlus(5), ...extra });
  expect(r.status).toBe(201);
  return r.body.id;
}
const ligne = async (id) => (await request(app).get("/api/echeances-administratives").set(auth(assoc1))).body.find((e) => e.id === id);

describe("Payer une échéance fiscale ou sociale", () => {
  test("dépense liée à l'échéance, circuit normal, clôture au décaissement (la période suivante réapparaît)", async () => {
    const id = await nouvelleEcheance();
    expect((await ligne(id)).paiement_en_cours).toBeFalsy();
    const dep = await request(app).post("/api/depenses").set(auth(assoc1)).send({ type: "fixe", libelle: "TVA — échéance test", montant: 85000, categorie: "autre", echeance_id: id });
    expect(dep.status).toBe(201);
    expect(dep.body.categorie).toBe("charges_fiscales_sociales"); // la catégorie est imposée
    expect(dep.body.statut).toBe("soumise");
    expect((await ligne(id)).paiement_en_cours).toBe("soumise");
    // un seul paiement en cours par échéance
    const doublon = await request(app).post("/api/depenses").set(auth(assoc2)).send({ type: "fixe", libelle: "TVA bis", montant: 1000, echeance_id: id });
    expect(doublon.status).toBe(409);
    // les associés ordonnent, l'échéance affiche « validée » ; le décaissement la clôt
    expect((await request(app).post(`/api/depenses/${dep.body.id}/decision`).set(auth(assoc2)).send({ statut: "validee", mode_paiement: "especes" })).status).toBe(200);
    expect((await ligne(id)).paiement_en_cours).toBe("validee");
    const avant = (await ligne(id)).prochaine_date;
    expect((await request(app).post(`/api/depenses/${dep.body.id}/decaisser`).set(auth(assoc2)).send({ mode_paiement: "especes" })).status).toBe(200);
    const apres = await ligne(id);
    expect(apres.paiement_en_cours).toBeFalsy();
    expect(apres.dernier_traite_le).toBeTruthy();
    expect(apres.prochaine_date > avant).toBe(true); // récurrente : la prochaine occurrence apparaît
    expect(Number(apres.depense_montant)).toBe(85000); // repère : dernier montant payé
  });

  test("sans le droit de consulter les échéances : 403 ; échéance non fiscale/sociale ou inconnue : 404", async () => {
    const id = await nouvelleEcheance();
    const collab = await creer("collaborateur");
    expect((await request(app).post("/api/depenses").set(auth(collab)).send({ type: "fixe", libelle: "Tentative", montant: 1000, echeance_id: id })).status).toBe(403);
    const assurance = await nouvelleEcheance({ categorie: "assurance", libelle: "RC pro test " + Date.now() });
    expect((await request(app).post("/api/depenses").set(auth(assoc1)).send({ type: "fixe", libelle: "Assurance", montant: 1000, echeance_id: assurance })).status).toBe(404);
    expect((await request(app).post("/api/depenses").set(auth(assoc1)).send({ type: "fixe", libelle: "Inconnue", montant: 1000, echeance_id: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
  });

  test("dépense rejetée : l'échéance redevient payable ; « Marquer traité » ne crée plus de dépense décaissée pour une charge fiscale", async () => {
    const id = await nouvelleEcheance();
    const dep = await request(app).post("/api/depenses").set(auth(assoc1)).send({ type: "fixe", libelle: "TVA rejet", montant: 5000, echeance_id: id });
    await request(app).post(`/api/depenses/${dep.body.id}/decision`).set(auth(assoc2)).send({ statut: "rejetee", motif_rejet: "Montant à revoir" });
    expect((await ligne(id)).paiement_en_cours).toBeFalsy();
    expect((await request(app).post("/api/depenses").set(auth(assoc1)).send({ type: "fixe", libelle: "TVA nouvelle demande", montant: 6000, echeance_id: id })).status).toBe(201);
    expect((await request(app).post(`/api/echeances-administratives/${id}/traiter`).set(auth(assoc1)).send({ montant_decaisse: 5000 })).status).toBe(409);
    expect((await request(app).post(`/api/echeances-administratives/${id}/traiter`).set(auth(assoc1)).send({})).status).toBe(200); // clôture simple (déjà payé ailleurs)
  });
});

describe("État mensuel des charges : catégorie fiscale et sociale refusée", () => {
  test("catalogue des charges habituelles et ajout de ligne : 409 ; une autre catégorie passe", async () => {
    const refus = await request(app).post("/api/charges/modeles").set(auth(assoc1)).send({ libelle: "TVA mensuelle", categorie: "charges_fiscales_sociales", montant_habituel: 1000, periodicite: "mensuelle" });
    expect(refus.status).toBe(409);
    expect(refus.body.error).toMatch(/Charges fiscales et sociales à payer/);
    const ok = await request(app).post("/api/charges/modeles").set(auth(assoc1)).send({ libelle: "Nettoyage " + Date.now(), categorie: "nettoyage", montant_habituel: 1000, periodicite: "mensuelle" });
    expect(ok.status).toBe(201);
    const annee = 2100 + Math.floor(Math.random() * 800);
    const etat = await request(app).post("/api/charges/etats").set(auth(assoc1)).send({ mois: `${annee}-03` });
    expect(etat.status).toBe(201);
    expect((await request(app).post(`/api/charges/etats/${etat.body.id}/lignes`).set(auth(assoc1)).send({ libelle: "INPS", categorie: "charges_fiscales_sociales", montant: 1000 })).status).toBe(409);
  });
});
