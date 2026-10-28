// JURIA — État mensuel des charges (24/10/2026) : pré-remplissage par le catalogue,
// approbation → dépense validée, rejet motivé, report chaîné avec retard, clôture.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let banque;
const auth = () => ({ Authorization: `Bearer ${token}` });
const post = (url, corps = {}) => request(app).post(url).set(auth()).send(corps);
const get = (url) => request(app).get(url).set(auth());

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  banque = (await post("/api/parametres/comptes-bancaires", { intitule: "BDM charges", type: "fonctionnement", banque: "BDM SA", numero: "810001" })).body.id;
  await pool.query("DELETE FROM etats_charges; DELETE FROM charges_modeles;");
});
afterAll(async () => { await pool.end(); });

describe("Catalogue des charges habituelles", () => {
  test("création, périodicité exigeant un mois d'échéance, moyen/compte compatibles", async () => {
    expect((await post("/api/charges/modeles", { libelle: "Loyer", categorie: "loyer", montant_habituel: 450000, mode_paiement: "virement", compte_id: banque })).status).toBe(201);
    expect((await post("/api/charges/modeles", { libelle: "Café", categorie: "consommables", type: "ponctuelle", montant_habituel: 30000, montant_variable: true })).status).toBe(201);
    expect((await post("/api/charges/modeles", { libelle: "RC pro", categorie: "autre", montant_habituel: 900000, periodicite: "annuelle", mois_echeance: 11 })).status).toBe(201);
    expect((await post("/api/charges/modeles", { libelle: "Trimestrielle", montant_habituel: 1, periodicite: "trimestrielle" })).status).toBe(400);
    expect((await post("/api/charges/modeles", { libelle: "X", mode_paiement: "orange_money", compte_id: banque })).status).toBe(400);
    expect((await post("/api/charges/modeles", { libelle: "", montant_habituel: 1 })).status).toBe(400);
  });
});

describe("Cycle d'un état mensuel", () => {
  let octobre; let loyer; let cafe;

  test("création : pré-remplie par les charges mensuelles ; l'annuelle n'apparaît qu'à son mois ; doublon refusé", async () => {
    const r = await post("/api/charges/etats", { mois: "2026-10" });
    expect(r.status).toBe(201);
    octobre = r.body;
    expect(octobre.mois).toBe("2026-10-01");
    expect(octobre.lignes.map((l) => l.libelle)).toEqual(["Café", "Loyer"]); // ordre alphabétique stable
    expect(octobre.lignes.find((l) => l.libelle === "Loyer").periode_fin).toBe("2026-10-31");
    expect((await post("/api/charges/etats", { mois: "2026-10" })).status).toBe(409);
    expect((await post("/api/charges/etats", { mois: "n'importe quoi" })).status).toBe(400);
    loyer = octobre.lignes.find((l) => l.libelle === "Loyer");
    cafe = octobre.lignes.find((l) => l.libelle === "Café");
  });

  test("ligne ponctuelle ajoutée ; décision impossible avant la soumission", async () => {
    const ajout = await post(`/api/charges/etats/${octobre.id}/lignes`, { libelle: "Peinture bureaux", categorie: "entretien", montant: 800000 });
    expect(ajout.status).toBe(201);
    expect((await post(`/api/charges/etats/${octobre.id}/lignes/${loyer.id}/decision`, { decision: "approuvee" })).status).toBe(409);
    expect((await post(`/api/charges/etats/${octobre.id}/soumettre`)).status).toBe(200);
    expect((await post(`/api/charges/etats/${octobre.id}/lignes`, { libelle: "Trop tard", montant: 1 })).status).toBe(409);
  });

  test("approbation : dépense validée créée, moyen orienté par les associés ; rejet exige un motif", async () => {
    const ok = await post(`/api/charges/etats/${octobre.id}/lignes/${loyer.id}/decision`, { decision: "approuvee", mode_paiement: "cheque", compte_id: banque });
    expect(ok.status).toBe(200);
    expect(ok.body.depense_id).toBeTruthy();
    const dep = (await pool.query("SELECT statut, montant, nature, mode_paiement, libelle FROM depenses WHERE id = $1", [ok.body.depense_id])).rows[0];
    expect(dep).toMatchObject({ statut: "validee", montant: "450000", nature: "cabinet", mode_paiement: "cheque", libelle: "Loyer — octobre 2026" });
    expect((await post(`/api/charges/etats/${octobre.id}/lignes/${loyer.id}/decision`, { decision: "rejetee", motif: "x" })).status).toBe(409);
    const peinture = (await get(`/api/charges/etats/${octobre.id}`)).body.lignes.find((l) => l.libelle === "Peinture bureaux");
    expect((await post(`/api/charges/etats/${octobre.id}/lignes/${peinture.id}/decision`, { decision: "rejetee" })).status).toBe(400);
    expect((await post(`/api/charges/etats/${octobre.id}/lignes/${peinture.id}/decision`, { decision: "rejetee", motif: "Reporter après les congés" })).status).toBe(200);
  });

  test("clôture refusée tant qu'une ligne attend ; report puis clôture", async () => {
    expect((await post(`/api/charges/etats/${octobre.id}/cloturer`)).status).toBe(409);
    expect((await post(`/api/charges/etats/${octobre.id}/lignes/${cafe.id}/decision`, { decision: "reportee", montant: 28000 })).status).toBe(200);
    const clos = await post(`/api/charges/etats/${octobre.id}/cloturer`);
    expect(clos.status).toBe(200);
    expect(clos.body.statut).toBe("clos");
    expect(clos.body.totaux).toMatchObject({ approuve: 450000, reporte: 28000, rejete: 800000 });
  });

  test("le report revient chaque mois avec son retard (alerte à 2 mois) et sans doublon", async () => {
    const nov = (await post("/api/charges/etats", { mois: "2026-11" })).body;
    const cafeNov = nov.lignes.filter((l) => l.libelle === "Café");
    expect(nov.lignes.some((l) => l.libelle === "RC pro")).toBe(true); // annuelle : seulement en novembre
    expect(octobre.lignes.some((l) => l.libelle === "RC pro")).toBe(false);
    expect(cafeNov).toHaveLength(2); // le café du mois + celui reporté d'octobre
    const reporte = cafeNov.find((l) => l.report_de);
    expect(reporte).toMatchObject({ retard_mois: 1, montant: "28000", periode_debut: "2026-10-01" });
    expect((await post(`/api/charges/etats/${nov.id}/lignes/${reporte.id}/decision`, { decision: "reportee" })).status).toBe(409); // état non soumis
    await post(`/api/charges/etats/${nov.id}/soumettre`);
    for (const l of nov.lignes) await post(`/api/charges/etats/${nov.id}/lignes/${l.id}/decision`, { decision: l.id === reporte.id ? "reportee" : "approuvee" });
    await post(`/api/charges/etats/${nov.id}/cloturer`);
    const dec = (await post("/api/charges/etats", { mois: "2026-12" })).body;
    const encore = dec.lignes.find((l) => l.report_de && l.libelle === "Café");
    expect(encore.retard_mois).toBe(2);
    expect(dec.en_retard).toBe(1);
    expect(dec.lignes.filter((l) => l.libelle === "Café" && l.report_de)).toHaveLength(1); // pas de doublon de report
    expect((await request(app).delete(`/api/charges/etats/${dec.id}/lignes/${encore.id}`).set(auth())).status).toBe(409); // un report ne se supprime pas
  });

  test("liste des états et PDF paysage", async () => {
    const liste = (await get("/api/charges/etats")).body;
    expect(liste.map((e) => e.mois)).toEqual(["2026-12-01", "2026-11-01", "2026-10-01"]);
    const pdf = await get(`/api/charges/etats/${octobre.id}/pdf`).buffer(true).parse((res, cb) => {
      const morceaux = []; res.on("data", (c) => morceaux.push(c)); res.on("end", () => cb(null, Buffer.concat(morceaux)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");
  });
});

// 28/10/2026 — « value too long for type character varying » : charges_modeles.periodicite était en VARCHAR(12)
// alors que « trimestrielle » compte 13 caractères (aucune charge trimestrielle ne pouvait être créée ; l'ancien
// test ne créait qu'un cas refusé). Libellés trop longs : message clair, et dépense d'approbation bornée à 240.
describe("Charge trimestrielle et libellés longs (28/10/2026)", () => {
  afterAll(async () => { await pool.query("DELETE FROM etats_charges WHERE mois >= '2031-01-01'; DELETE FROM charges_modeles WHERE libelle LIKE 'Essai 28/10%';"); });

  test("une charge habituelle trimestrielle se crée et réapparaît dans l'état du mois de son cycle", async () => {
    const cree = await post("/api/charges/modeles", { libelle: "Essai 28/10 assurance", categorie: "autre", montant_habituel: 150000, periodicite: "trimestrielle", mois_echeance: 3 });
    expect(cree.status).toBe(201);
    expect(cree.body.periodicite).toBe("trimestrielle");
    const mars = (await post("/api/charges/etats", { mois: "2031-03" })).body;           // mois du cycle (3, 6, 9, 12)
    expect(mars.lignes.some((l) => l.libelle === "Essai 28/10 assurance")).toBe(true);
    const avril = (await post("/api/charges/etats", { mois: "2031-04" })).body;           // hors cycle
    expect(avril.lignes.some((l) => l.libelle === "Essai 28/10 assurance")).toBe(false);
    const juin = (await post("/api/charges/etats", { mois: "2031-06" })).body;
    expect(juin.lignes.some((l) => l.libelle === "Essai 28/10 assurance")).toBe(true);
  });

  test("libellé de 241 caractères : message clair (catalogue, ligne ponctuelle, modification) ; 240 accepté", async () => {
    const etat = (await post("/api/charges/etats", { mois: "2031-05" })).body;
    const trop = "x".repeat(241);
    const modele = await post("/api/charges/modeles", { libelle: trop, montant_habituel: 1 });
    expect(modele.status).toBe(400);
    expect(modele.body.error).toMatch(/Libellé trop long/);
    const ligne = await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: trop, montant: 1000 });
    expect(ligne.status).toBe(400);
    expect(ligne.body.error).toMatch(/Observation/);
    const ok = await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: "y".repeat(240), montant: 1000 });
    expect(ok.status).toBe(201);
    const maj = await request(app).put(`/api/charges/etats/${etat.id}/lignes/${ok.body.id}`).set(auth()).send({ libelle: trop });
    expect(maj.status).toBe(400);
  });

  test("approuver une charge au libellé de 240 caractères ne déborde pas la dépense créée", async () => {
    const etat = (await post("/api/charges/etats", { mois: "2031-07" })).body;
    const ligne = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: "z".repeat(240), montant: 2000 })).body;
    await post(`/api/charges/etats/${etat.id}/soumettre`);
    const dec = await post(`/api/charges/etats/${etat.id}/lignes/${ligne.id}/decision`, { decision: "approuvee" });
    expect(dec.status).toBe(200);
    const { rows } = await pool.query("SELECT libelle FROM depenses WHERE id = $1", [dec.body.depense_id]);
    expect(rows[0].libelle.length).toBeLessThanOrEqual(240);
    expect(rows[0].libelle).toMatch(/juillet 2031$/);       // la période est conservée, c'est le libellé qui est rogné
  });
});
