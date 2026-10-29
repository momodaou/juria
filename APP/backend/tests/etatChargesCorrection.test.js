// JURIA — « Modifier » une ligne d'état déjà approuvée (29/10/2026) : la ligne et la dépense « à décaisser » sont corrigées
// ensemble, tant que la dépense n'est pas décaissée / annulée / facturée et que l'état n'est pas clos ; tracé au journal d'audit.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let collab; let banque;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });
const post = (u, c = {}, t) => request(app).post(u).set(auth(t)).send(c);
const put = (u, c = {}, t) => request(app).put(u).set(auth(t)).send(c);
const get = (u) => request(app).get(u).set(auth());

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  const s = Math.random().toString(36).slice(2, 8);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Collab','Corr',$2,$3,'collaborateur',TRUE,now()) RETURNING id`,
    [`K${s.toUpperCase()}`, `corr.${s}@jfcavocats-mali.com`, await bcrypt.hash("TestCorr123!", 4)]);
  collab = jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Collab Corr" }, SECRET, { expiresIn: "1h" });
  banque = (await post("/api/parametres/comptes-bancaires", { intitule: "BDM correction", type: "fonctionnement", banque: "BDM SA", numero: "850001" })).body.id;
  await pool.query("DELETE FROM etats_charges; DELETE FROM charges_modeles;");
});
afterAll(async () => { await pool.query("DELETE FROM etats_charges WHERE mois >= '2039-01-01'"); await pool.end(); });

async function ligneApprouvee(mois, libelle = "Petite caisse", montant = 100000) {
  const etat = (await post("/api/charges/etats", { mois })).body;
  const l = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle, categorie: "fournitures", montant })).body;
  await post(`/api/charges/etats/${etat.id}/soumettre`);
  const ok = await post(`/api/charges/etats/${etat.id}/lignes/${l.id}/decision`, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
  return { etat, ligne: l, depenseId: ok.body.depense_id };
}
const depense = async (id) => (await pool.query("SELECT libelle, montant, mode_paiement, statut, references_paiement FROM depenses WHERE id = $1", [id])).rows[0];

describe("Correction d'une ligne approuvée", () => {
  test("période, libellé et montant corrigés sur la ligne ET la dépense ; trace avant / après", async () => {
    const { etat, ligne, depenseId } = await ligneApprouvee("2039-03");
    expect((await depense(depenseId)).libelle).toBe("Petite caisse — mars 2039");
    const r = await put(`/api/charges/etats/${etat.id}/lignes/${ligne.id}/correction`, {
      libelle: "Dotation petite caisse", periode_debut: "2039-04-01", periode_fin: "2039-04-30", montant: 120000 });
    expect(r.status).toBe(200);
    expect(Number(r.body.montant)).toBe(120000);
    const d = await depense(depenseId);
    expect(d).toMatchObject({ libelle: "Dotation petite caisse — avril 2039", montant: "120000", statut: "validee" });
    const lu = (await get(`/api/charges/etats/${etat.id}`)).body.lignes.find((x) => x.id === ligne.id);
    expect(lu.libelle).toBe("Dotation petite caisse");
    expect(lu.periode_debut.slice(0, 10)).toBe("2039-04-01");
    const audit = await pool.query("SELECT details FROM journal_audit WHERE action = 'etat_charges_ligne_corrigee' AND entite_id = $1", [ligne.id]);
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].details.changements.montant).toEqual({ avant: 100000, apres: 120000 });
    // identique : rien à faire, rien de tracé en plus
    expect((await put(`/api/charges/etats/${etat.id}/lignes/${ligne.id}/correction`, { montant: 120000 })).status).toBe(200);
    expect((await pool.query("SELECT 1 FROM journal_audit WHERE action = 'etat_charges_ligne_corrigee' AND entite_id = $1", [ligne.id])).rows.length).toBe(1);
  });

  test("changer de moyen remet les références de la dépense à zéro", async () => {
    const { etat, ligne, depenseId } = await ligneApprouvee("2039-05");
    await pool.query("UPDATE depenses SET references_paiement = '{\"numero_operation\":\"V1\"}'::jsonb WHERE id = $1", [depenseId]);
    expect((await put(`/api/charges/etats/${etat.id}/lignes/${ligne.id}/correction`, { mode_paiement: "especes", compte_id: null })).status).toBe(200);
    const d = await depense(depenseId);
    expect(d.mode_paiement).toBe("especes");
    expect(d.references_paiement).toEqual({});
  });

  test("refusée : sans droit de décision, montant nul, fin avant début, ligne non approuvée", async () => {
    const { etat, ligne } = await ligneApprouvee("2039-06");
    const url = `/api/charges/etats/${etat.id}/lignes/${ligne.id}/correction`;
    expect((await put(url, { libelle: "X" }, collab)).status).toBe(403);
    expect((await put(url, { montant: 0 })).status).toBe(400);
    expect((await put(url, { periode_debut: "2039-06-30", periode_fin: "2039-06-01" })).status).toBe(400);
    expect((await put(url, { periode_debut: "pas une date" })).status).toBe(400);
    const e2 = (await post("/api/charges/etats", { mois: "2039-07" })).body;
    const l2 = (await post(`/api/charges/etats/${e2.id}/lignes`, { libelle: "En attente", categorie: "fournitures", montant: 5 })).body;
    await post(`/api/charges/etats/${e2.id}/soumettre`);
    expect((await put(`/api/charges/etats/${e2.id}/lignes/${l2.id}/correction`, { libelle: "Y" })).status).toBe(409);
  });

  test("verrouillée dès que la dépense est décaissée, annulée, ou l'état clos", async () => {
    const a = await ligneApprouvee("2039-08");
    expect((await post(`/api/depenses/${a.depenseId}/decaisser`, { mode_paiement: "virement", compte_id: banque, references: {} })).status).toBe(200);
    expect((await put(`/api/charges/etats/${a.etat.id}/lignes/${a.ligne.id}/correction`, { libelle: "Z" })).status).toBe(409);

    const b = await ligneApprouvee("2039-09");
    expect((await post(`/api/depenses/${b.depenseId}/annuler`, { motif: "erreur" })).status).toBe(200);
    expect((await put(`/api/charges/etats/${b.etat.id}/lignes/${b.ligne.id}/correction`, { libelle: "Z" })).status).toBe(409);

    const c = await ligneApprouvee("2039-10");
    expect((await post(`/api/charges/etats/${c.etat.id}/cloturer`)).status).toBe(200);
    expect((await put(`/api/charges/etats/${c.etat.id}/lignes/${c.ligne.id}/correction`, { libelle: "Z" })).status).toBe(409);
  });
});
