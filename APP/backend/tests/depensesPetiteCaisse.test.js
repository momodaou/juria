// JURIA — petite caisse renforcée (17/10/2026, audit retraité chantier 5) :
// engagement sans validation préalable, plafond par dépense, solde du mois,
// validation après coup par un AUTRE associé, rapprochement mensuel.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let associe2; let adminGeneral; let collab;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const mois = () => new Date().toISOString().slice(0, 8) + "01";

async function creerToken(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestPC123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','PC',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`P${suffixe.slice(0, 7)}`, `test.pc.${suffixe}@jfcavocats-mali.com`, hash, role]);
  return jwt.sign({ sub: rows[0].id, role, nom: "Test PC" }, SECRET, { expiresIn: "1h" });
}

beforeAll(async () => {
  await assurerUtilisateurTest();
  associe = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  associe2 = await creerToken("associe");
  adminGeneral = await creerToken("admin_general");
  collab = await creerToken("collaborateur");
  await request(app).put("/api/parametres/honoraires").set(auth(associe)).send({ petite_caisse_plafond_depense: 50000 });
  await request(app).post("/api/depenses/petite-caisse").set(auth(associe)).send({ mois: mois(), montant_alloue: 10000000 });
});
afterAll(async () => { await pool.end(); });

const engager = (t, extra = {}) =>
  request(app).post("/api/depenses/engager").set(auth(t))
    .send({ libelle: "Eau de bureau", montant: 12000, mode_paiement: "orange_money", ...extra });

describe("Engagement sur la petite caisse", () => {
  test("administrateur général et associé peuvent engager ; un collaborateur non", async () => {
    expect((await engager(adminGeneral)).status).toBe(201);
    expect((await engager(associe)).status).toBe(201);
    expect((await engager(collab)).status).toBe(403);
  });

  test("la dépense est décaissée d'emblée, en petite caisse, à valider après coup", async () => {
    const r = await engager(adminGeneral);
    expect(r.body.statut).toBe("decaissee");
    expect(r.body.apres_coup_statut).toBe("a_valider");
    const ligne = (await request(app).get("/api/depenses").set(auth(associe))).body.find((d) => d.id === r.body.id);
    expect(ligne.petite_caisse).toBe(true);
    expect(ligne.apres_coup_statut).toBe("a_valider");
  });

  test("refus au-dessus du plafond, sans moyen de paiement, ou si le solde du mois est insuffisant", async () => {
    expect((await engager(associe, { montant: 50001 })).status).toBe(409);
    expect((await engager(associe, { mode_paiement: undefined })).status).toBe(400);
    await request(app).post("/api/depenses/petite-caisse").set(auth(associe)).send({ mois: mois(), montant_alloue: 1 });
    expect((await engager(associe)).status).toBe(409);
    await request(app).post("/api/depenses/petite-caisse").set(auth(associe)).send({ mois: mois(), montant_alloue: 10000000 });
  });

  test("tant que le plafond n'est pas défini, l'engagement est refusé", async () => {
    await pool.query("UPDATE parametres_cabinet SET petite_caisse_plafond_depense = NULL WHERE id = 1");
    expect((await engager(associe)).status).toBe(409);
    await request(app).put("/api/parametres/honoraires").set(auth(associe)).send({ petite_caisse_plafond_depense: 50000 });
  });
});

describe("Validation après coup", () => {
  test("l'engageur ne peut pas valider ; un autre associé oui ; pas deux fois", async () => {
    const r = await engager(associe);
    const id = r.body.id;
    expect((await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(associe)).send({ decision: "validee" })).status).toBe(403);
    expect((await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(adminGeneral)).send({ decision: "validee" })).status).toBe(403); // pas de droit de décision
    const ok = await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(associe2)).send({ decision: "validee" });
    expect(ok.status).toBe(200);
    expect(ok.body.apres_coup_statut).toBe("validee");
    expect((await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(associe2)).send({ decision: "validee" })).status).toBe(409);
  });

  test("contester exige un motif", async () => {
    const id = (await engager(adminGeneral)).body.id;
    expect((await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(associe)).send({ decision: "contestee" })).status).toBe(400);
    const c = await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(associe)).send({ decision: "contestee", motif: "Montant inhabituel" });
    expect(c.body.apres_coup_statut).toBe("contestee");
  });
});

describe("Rapprochement mensuel", () => {
  test("calcule l'écart entre le solde réel et le solde JURIA et garde l'historique", async () => {
    const caisse = (await request(app).get("/api/depenses/petite-caisse").set(auth(associe))).body;
    const r = await request(app).post("/api/depenses/petite-caisse/rapprochement").set(auth(associe))
      .send({ solde_reel: caisse.solde - 2500, note: "Relevé Orange Money" });
    expect(r.status).toBe(201);
    expect(Number(r.body.solde_calcule)).toBe(caisse.solde);
    expect(Number(r.body.ecart)).toBe(-2500);
    const hist = (await request(app).get("/api/depenses/petite-caisse/rapprochements").set(auth(associe))).body;
    expect(hist.length).toBeGreaterThan(0);
    expect((await request(app).post("/api/depenses/petite-caisse/rapprochement").set(auth(collab)).send({ solde_reel: 1 })).status).toBe(403);
  });
});

describe("Tuile Tableau de bord « Dépenses à valider après coup »", () => {
  test("visible pour un associé (compte + détail), absente pour l'administrateur général", async () => {
    const id = (await engager(adminGeneral, { libelle: "Tuile test" })).body.id;
    const d = (await request(app).get("/api/dashboard").set(auth(associe))).body;
    expect(d.depenses_apres_coup_n).toBeGreaterThan(0);
    const detail = await request(app).get("/api/dashboard/detail/depenses_apres_coup").set(auth(associe));
    expect(detail.status).toBe(200);
    expect(detail.body.some((l) => l.id === id)).toBe(true);
    const dAdmin = (await request(app).get("/api/dashboard").set(auth(adminGeneral))).body;
    expect(dAdmin.depenses_apres_coup_n).toBeNull();
    expect((await request(app).get("/api/dashboard/detail/depenses_apres_coup").set(auth(adminGeneral))).status).toBe(403);
    // Une fois validée par un autre associé, elle sort de la tuile.
    await request(app).post(`/api/depenses/${id}/valider-apres-coup`).set(auth(associe)).send({ decision: "validee" });
    const apres = (await request(app).get("/api/dashboard/detail/depenses_apres_coup").set(auth(associe))).body;
    expect(apres.some((l) => l.id === id)).toBe(false);
  });
});
