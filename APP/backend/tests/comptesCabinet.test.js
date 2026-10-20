// JURIA — comptes du cabinet : deux familles (Banque / Mobile money), champs
// propres à chacune, validation, modification, affichage sur les factures (20/10/2026).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
const auth = () => ({ Authorization: `Bearer ${token}` });
const creer = (corps) => request(app).post("/api/parametres/comptes-bancaires").set(auth()).send(corps);
const liste = async () => (await request(app).get("/api/parametres/comptes-bancaires").set(auth())).body;

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
});
afterAll(async () => { await pool.end(); });

describe("Comptes du cabinet", () => {
  test("banque : banque et numéro obligatoires, CARPA acceptée comme usage", async () => {
    expect((await creer({ intitule: "Sans banque", type: "fonctionnement", numero: "123" })).status).toBe(400);
    expect((await creer({ intitule: "Sans numéro", type: "fonctionnement", banque: "BDM SA" })).status).toBe(400);
    const ok = await creer({ intitule: "CARPA du cabinet", type: "carpa", banque: "BDM SA", numero: "001122334455" });
    expect(ok.status).toBe(201);
    expect((await liste()).find((c) => c.id === ok.body.id).type).toBe("carpa");
  });

  test("formats : IBAN, BIC et clé RIB contrôlés", async () => {
    const base = { intitule: "Format", type: "fonctionnement", banque: "BDM SA", numero: "1" };
    expect((await creer({ ...base, iban: "n'importe quoi" })).body.error).toMatch(/IBAN/);
    expect((await creer({ ...base, bic: "XY" })).body.error).toMatch(/BIC/);
    expect((await creer({ ...base, cle_rib: "12345" })).body.error).toMatch(/Clé RIB/);
    expect((await creer({ ...base, iban: "ml03 d008 0101 2402 0019 0100 0252" })).status).toBe(201);
  });

  test("mobile money : opérateur et numéro (8 chiffres) obligatoires, numéro normalisé", async () => {
    expect((await creer({ intitule: "Sans opérateur", type: "mobile_money", telephone: "70000000" })).status).toBe(400);
    expect((await creer({ intitule: "Numéro faux", type: "mobile_money", operateur: "orange_money", telephone: "123" })).status).toBe(400);
    const ok = await creer({ intitule: "Orange Money cabinet", type: "mobile_money", operateur: "orange_money", telephone: "+223 70 00 00 01" });
    expect(ok.status).toBe(201);
    const c = (await liste()).find((x) => x.id === ok.body.id);
    expect(c.telephone).toBe("70 00 00 01");
    expect(c.afficher_sur_factures).toBe(true);
    expect(c.banque).toBeNull();
    expect(c.numero).toBeNull();
  });

  test("anciens types (espèces, virement étranger) refusés à la création", async () => {
    expect((await creer({ intitule: "Caisse", type: "especes" })).status).toBe(400);
    expect((await creer({ intitule: "Étranger", type: "virement_etranger", banque: "X", numero: "1" })).status).toBe(400);
  });

  test("modification d'un compte, bascule actif, et ancien type non modifiable", async () => {
    const id = (await creer({ intitule: "À modifier", type: "fonctionnement", banque: "BDM SA", numero: "111" })).body.id;
    const maj = await request(app).put(`/api/parametres/comptes-bancaires/${id}`).set(auth()).send({ numero: "222", intitule: "Modifié" });
    expect(maj.status).toBe(200);
    const c = (await liste()).find((x) => x.id === id);
    expect(c.numero).toBe("222");
    expect(c.intitule).toBe("Modifié");
    expect((await request(app).put(`/api/parametres/comptes-bancaires/${id}`).set(auth()).send({ numero: "" })).status).toBe(400);
    await request(app).put(`/api/parametres/comptes-bancaires/${id}`).set(auth()).send({ actif: false });
    expect((await liste()).find((x) => x.id === id).actif).toBe(false);
    // Changement de famille : banque → mobile money
    const vers = await request(app).put(`/api/parametres/comptes-bancaires/${id}`).set(auth()).send({ type: "mobile_money", operateur: "moov_money", telephone: "60 00 00 02" });
    expect(vers.status).toBe(200);
    const m = (await liste()).find((x) => x.id === id);
    expect(m.type).toBe("mobile_money");
    expect(m.banque).toBeNull();
    // Ancien type en base : modification refusée
    const { rows: [vieux] } = await pool.query("INSERT INTO comptes_bancaires (intitule, type) VALUES ('Ancienne caisse','especes') RETURNING id");
    expect((await request(app).put(`/api/parametres/comptes-bancaires/${vieux.id}`).set(auth()).send({ intitule: "x" })).status).toBe(400);
    expect((await request(app).put(`/api/parametres/comptes-bancaires/${vieux.id}`).set(auth()).send({ actif: false })).status).toBe(200);
  });

  test("le numéro mobile money sert aussi à la détection de doublon", async () => {
    const tel = "75 00 00 03";
    await creer({ intitule: "Wave cabinet", type: "mobile_money", operateur: "wave", telephone: tel });
    const d = await request(app).get(`/api/parametres/comptes-bancaires/verifier-doublon?numero=${encodeURIComponent(tel)}`).set(auth());
    expect(d.body.length).toBeGreaterThan(0);
  });
});
