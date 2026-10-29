// JURIA — « Annuler la décision » sur une ligne d'état (29/10/2026) : approuvée (dépense annulée), rejetée, reportée.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let collab; let banque;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const post = (u, c = {}, t) => request(app).post(u).set(auth(t)).send(c);
const get = (u) => request(app).get(u).set(auth());

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  const s = Math.random().toString(36).slice(2, 8);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Collab','Ad',$2,$3,'collaborateur',TRUE,now()) RETURNING id`,
    [`A${s.toUpperCase()}`, `ad.${s}@jfcavocats-mali.com`, await bcrypt.hash("TestAd123!", 4)]);
  collab = jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Collab Ad" }, SECRET, { expiresIn: "1h" });
  banque = (await post("/api/parametres/comptes-bancaires", { intitule: "BDM annulation", type: "fonctionnement", banque: "BDM SA", numero: "860001" })).body.id;
  await pool.query("DELETE FROM etats_charges; DELETE FROM charges_modeles;");
});
afterAll(async () => { await pool.query("DELETE FROM etats_charges WHERE mois >= '2040-01-01'"); await pool.end(); });

async function etatAvecLigne(mois, libelle = "À décider", montant = 50000) {
  const etat = (await post("/api/charges/etats", { mois })).body;
  const l = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle, categorie: "fournitures", montant })).body;
  await post(`/api/charges/etats/${etat.id}/soumettre`);
  return { etat, ligne: l, url: `/api/charges/etats/${etat.id}/lignes/${l.id}` };
}
const decider = (url, corps) => post(`${url}/decision`, corps);
const lire = async (etatId, ligneId) => (await get(`/api/charges/etats/${etatId}`)).body.lignes.find((x) => x.id === ligneId);

describe("Annuler la décision", () => {
  test("approuvée : la dépense créée est annulée, la ligne repasse en attente et peut être redécidée (nouvelle dépense)", async () => {
    const { etat, ligne, url } = await etatAvecLigne("2040-01");
    const ok = await decider(url, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    const ancienne = ok.body.depense_id;
    expect((await post(`${url}/annuler-decision`, {})).status).toBe(400); // motif obligatoire
    const r = await post(`${url}/annuler-decision`, { motif: "Approuvée par erreur" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ decision: "en_attente", depense_id: null });
    const dep = (await pool.query("SELECT statut, annulee_le, annulation_motif FROM depenses WHERE id = $1", [ancienne])).rows[0];
    expect(dep.statut).toBe("rejetee");
    expect(dep.annulee_le).toBeTruthy();
    expect(dep.annulation_motif).toContain("Approuvée par erreur");
    expect((await lire(etat.id, ligne.id)).decision).toBe("en_attente");
    const audit = await pool.query("SELECT details FROM journal_audit WHERE action = 'etat_charges_decision_annulee' AND entite_id = $1", [ligne.id]);
    expect(audit.rows[0].details).toMatchObject({ ancienne_decision: "approuvee", motif: "Approuvée par erreur" });
    const re = await decider(url, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    expect(re.status).toBe(200);
    expect(re.body.depense_id).not.toBe(ancienne);
  });

  test("rejetée et reportée : retour en attente ; report déjà repris dans le mois suivant : refusé", async () => {
    const a = await etatAvecLigne("2040-02", "Rejetée");
    await decider(a.url, { decision: "rejetee", motif: "Trop cher" });
    expect((await post(`${a.url}/annuler-decision`, { motif: "Réexamen" })).status).toBe(200);
    const apresRejet = await lire(a.etat.id, a.ligne.id);
    expect(apresRejet).toMatchObject({ decision: "en_attente", motif: null });

    const b = await etatAvecLigne("2040-03", "Reportée");
    await decider(b.url, { decision: "reportee" });
    expect((await post(`${b.url}/annuler-decision`, { motif: "Finalement ce mois" })).status).toBe(200);
    await decider(b.url, { decision: "reportee" });
    await post("/api/charges/etats", { mois: "2040-04" }); // le report est repris dans l'état suivant
    const refus = await post(`${b.url}/annuler-decision`, { motif: "Trop tard" });
    expect(refus.status).toBe(409);
    expect(refus.body.error).toMatch(/déjà été repris/);
  });

  test("refusée : sans droit de décision, ligne sans décision, dépense décaissée, état clos", async () => {
    const a = await etatAvecLigne("2040-05", "Sans décision");
    expect((await post(`${a.url}/annuler-decision`, { motif: "x" }, collab)).status).toBe(403);
    expect((await post(`${a.url}/annuler-decision`, { motif: "x" })).status).toBe(409); // rien à annuler

    const b = await etatAvecLigne("2040-06", "Décaissée");
    const ok = await decider(b.url, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    expect((await post(`/api/depenses/${ok.body.depense_id}/decaisser`, { mode_paiement: "virement", compte_id: banque, references: {} })).status).toBe(200);
    expect((await post(`${b.url}/annuler-decision`, { motif: "x" })).status).toBe(409);

    const c = await etatAvecLigne("2040-07", "Clos");
    await decider(c.url, { decision: "rejetee", motif: "non" });
    expect((await post(`/api/charges/etats/${c.etat.id}/cloturer`)).status).toBe(200);
    expect((await post(`${c.url}/annuler-decision`, { motif: "x" })).status).toBe(409);
  });
});
