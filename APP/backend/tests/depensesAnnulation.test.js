// JURIA — annulation d'une dépense validée/décaissée (motif, associés),
// historique des dotations, achats de vignettes supprimables (17/10/2026).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let collab;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const mois = () => new Date().toISOString().slice(0, 8) + "01";

beforeAll(async () => {
  await assurerUtilisateurTest();
  associe = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestAnn123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Ann',$2,$3,'collaborateur',TRUE,now()) RETURNING id`,
    [`A${suffixe.slice(0, 7)}`, `test.ann.${suffixe}@jfcavocats-mali.com`, hash]);
  collab = jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Test Ann" }, SECRET, { expiresIn: "1h" });
  await request(app).post("/api/depenses/petite-caisse").set(auth(associe)).send({ mois: mois(), montant_alloue: 10000000 });
});
afterAll(async () => { await pool.end(); });

async function depenseDecaissee(extra = {}) {
  const dep = (await request(app).post("/api/depenses").set(auth(associe))
    .send({ type: "ponctuelle", libelle: "À annuler", montant: 30000, petite_caisse: true, ...extra })).body;
  await request(app).post(`/api/depenses/${dep.id}/decision`).set(auth(associe)).send({ statut: "validee" });
  return dep.id;
}
const annuler = (t, id, motif) => request(app).post(`/api/depenses/${id}/annuler`).set(auth(t)).send({ motif });

describe("Annulation d'une dépense", () => {
  test("validée : annulée avec motif, tracée, exclue du solde de la petite caisse", async () => {
    const avant = (await request(app).get("/api/depenses/petite-caisse").set(auth(associe))).body.depense;
    const id = await depenseDecaissee();
    const milieu = (await request(app).get("/api/depenses/petite-caisse").set(auth(associe))).body.depense;
    expect(milieu).toBe(avant + 30000);
    const r = await annuler(associe, id, "Doublon de saisie");
    expect(r.status).toBe(200);
    expect(r.body.statut_avant_annulation).toBe("validee");
    const apres = (await request(app).get("/api/depenses/petite-caisse").set(auth(associe))).body.depense;
    expect(apres).toBe(avant);
    const ligne = (await request(app).get("/api/depenses").set(auth(associe))).body.find((d) => d.id === id);
    expect(ligne.annulee_le).toBeTruthy();
    expect(ligne.annulation_motif).toBe("Doublon de saisie");
  });

  test("décaissée aussi ; sans motif, par un non-associé ou une dépense soumise : refusé", async () => {
    const id = await depenseDecaissee();
    await request(app).post(`/api/depenses/${id}/decaisser`).set(auth(associe)).send({ mode_paiement: "virement" });
    expect((await annuler(associe, id, "")).status).toBe(400);
    expect((await annuler(collab, id, "x")).status).toBe(403);
    expect((await annuler(associe, id, "Montant erroné")).body.statut_avant_annulation).toBe("decaissee");
    expect((await annuler(associe, id, "encore")).status).toBe(409); // déjà annulée
    const soumise = (await request(app).post("/api/depenses").set(auth(associe)).send({ type: "ponctuelle", libelle: "S", montant: 1 })).body.id;
    expect((await annuler(associe, soumise, "x")).status).toBe(409);
  });

  test("refusée si la dépense est déjà refacturée sur une facture", async () => {
    const id = await depenseDecaissee();
    const { rows: [c] } = await pool.query(
      `INSERT INTO clients (type, denomination, pays) VALUES ('morale','Client Ann','Mali') RETURNING id`);
    const { rows: [f] } = await pool.query(
      `INSERT INTO factures (numero, client_id, mode, montant_ht, taux_tva, montant_tva, montant_ttc, devise, taux_applique, montant_ttc_xof, statut, date_emission)
       VALUES ($1,$2,'forfait',1000,0,0,1000,'XOF',1,1000,'emise',current_date) RETURNING id`, [`F-ANN-${Date.now()}`, c.id]);
    await pool.query("UPDATE depenses SET facture_id = $1 WHERE id = $2", [f.id, id]);
    expect((await annuler(associe, id, "x")).status).toBe(409);
  });
});

describe("Historique des dotations et achats de vignettes", () => {
  test("liste des dotations du mois", async () => {
    const r = await request(app).get("/api/depenses/petite-caisse/dotations").set(auth(associe));
    expect(r.status).toBe(200);
    expect(r.body.length).toBeGreaterThan(0);
  });

  test("un achat de vignettes non utilisé peut être supprimé ; un achat utilisé non", async () => {
    const base = 6000000 + Math.floor(Math.random() * 300000);
    const p = (n) => String(n).padStart(7, "0");
    const a1 = (await request(app).post("/api/depenses/vignettes").set(auth(associe)).send({ numeros: `${p(base)}-${p(base + 1)}` })).body;
    let liste = (await request(app).get("/api/depenses/vignettes/achats").set(auth(associe))).body;
    expect(liste.some((a) => a.id === a1.id && a.nb_numeros === 2)).toBe(true);
    expect((await request(app).delete(`/api/depenses/vignettes/achats/${a1.id}`).set(auth(associe))).status).toBe(204);
    liste = (await request(app).get("/api/depenses/vignettes/achats").set(auth(associe))).body;
    expect(liste.some((a) => a.id === a1.id)).toBe(false);
    // Numéro marqué utilisé : suppression refusée.
    const a2 = (await request(app).post("/api/depenses/vignettes").set(auth(associe)).send({ numeros: p(base + 10) })).body;
    await pool.query("UPDATE vignettes_numeros_stock SET disponible = FALSE WHERE achat_id = $1", [a2.id]);
    expect((await request(app).delete(`/api/depenses/vignettes/achats/${a2.id}`).set(auth(associe))).status).toBe(409);
  });
});
