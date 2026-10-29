// JURIA — liste des dépenses, audit du 30/10/2026 : annulées distinctes des rejetées (motif, auteur), filtres
// (catégorie, nature, petite caisse, période, recherche), origine « état des charges ».
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let banque;
const auth = () => ({ Authorization: `Bearer ${token}` });
const post = (u, c = {}) => request(app).post(u).set(auth()).send(c);
const liste = async (q = "") => (await request(app).get(`/api/depenses${q}`).set(auth())).body;
const MARQUE = `Liste-${Date.now()}`;

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  banque = (await post("/api/parametres/comptes-bancaires", { intitule: "BDM liste", type: "fonctionnement", banque: "BDM SA", numero: "840001" })).body.id;
});
afterAll(async () => { await pool.end(); });

const creer = (extra) => post("/api/depenses", { type: "ponctuelle", montant: 10000, ...extra });

describe("Liste des dépenses", () => {
  test("annulée ≠ rejetée : filtres distincts, motif et auteur d'annulation, motif de rejet", async () => {
    const rej = (await creer({ libelle: `${MARQUE} rejetée`, categorie: "papeterie" })).body.id;
    await post(`/api/depenses/${rej}/decision`, { statut: "rejetee", motif_rejet: "Hors budget" });
    const ann = (await creer({ libelle: `${MARQUE} annulée`, categorie: "papeterie" })).body.id;
    await post(`/api/depenses/${ann}/decision`, { statut: "validee" });
    expect((await post(`/api/depenses/${ann}/annuler`, { motif: "Doublon" })).status).toBe(200);

    const rejetees = (await liste(`?statut=rejetee&q=${MARQUE}`)).map((d) => d.id);
    expect(rejetees).toContain(rej);
    expect(rejetees).not.toContain(ann);
    const annulees = (await liste(`?statut=annulee&q=${MARQUE}`)).map((d) => d.id);
    expect(annulees).toEqual([ann]);
    const l = (await liste(`?q=${MARQUE}`));
    const lr = l.find((d) => d.id === rej); const la = l.find((d) => d.id === ann);
    expect(lr.motif_rejet).toBe("Hors budget");
    expect(la.annulation_motif).toBe("Doublon");
    expect(la.annulee_par_nom).toBeTruthy();
    expect((await liste(`?q=${MARQUE}&masquer_annulees=true`)).map((d) => d.id)).not.toContain(ann);
  });

  test("filtres catégorie, nature, petite caisse, période et recherche (libellé ou bénéficiaire)", async () => {
    const a = (await creer({ libelle: `${MARQUE} A`, categorie: "transport", date_depense: "2037-05-10", beneficiaire: "Taxi Sékou" })).body.id;
    const b = (await creer({ libelle: `${MARQUE} B`, categorie: "encres", date_depense: "2037-06-20", petite_caisse: true })).body.id;
    const ids = async (q) => (await liste(`?q=${MARQUE}${q}`)).map((d) => d.id);
    expect(await ids("&categorie=transport")).toEqual([a]);
    expect(await ids("&du=2037-06-01&au=2037-06-30")).toEqual([b]);
    expect(await ids("&petite_caisse=true")).toEqual([b]);
    expect((await ids("&petite_caisse=false")).includes(b)).toBe(false);
    expect(await ids("&nature=cabinet")).toEqual(expect.arrayContaining([a, b]));
    expect(await ids("&nature=dossier")).toEqual([]);
    expect((await liste("?q=Taxi%20S%C3%A9kou")).map((d) => d.id)).toContain(a);
  });

  test("une dépense créée par l'approbation d'une ligne d'état porte son mois d'origine", async () => {
    await pool.query("DELETE FROM etats_charges; DELETE FROM charges_modeles;");
    const etat = (await post("/api/charges/etats", { mois: "2037-09" })).body;
    const l = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: `${MARQUE} état`, categorie: "reparation", montant: 25000 })).body;
    await post(`/api/charges/etats/${etat.id}/soumettre`);
    const ok = await post(`/api/charges/etats/${etat.id}/lignes/${l.id}/decision`, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    const ligne = (await liste(`?q=${MARQUE}%20%C3%A9tat`)).find((d) => d.id === ok.body.depense_id);
    expect(ligne.etat_mois.slice(0, 7)).toBe("2037-09");
    const manuelle = (await creer({ libelle: `${MARQUE} manuelle`, categorie: "autre" })).body.id;
    expect((await liste(`?q=${MARQUE}%20manuelle`)).find((d) => d.id === manuelle).etat_mois).toBeNull();
    await pool.query("DELETE FROM etats_charges WHERE mois >= '2037-01-01'");
  });
});
