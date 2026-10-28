// JURIA — État des charges (28/10/2026) : catégories étoffées, rattachement à un dossier, bénéficiaire,
// justificatifs par ligne (recopiés sur la dépense), montant du mois précédent, décision groupée,
// justificatif exigé avant décaissement (seuil facultatif).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let userId; let banque;
const auth = () => ({ Authorization: `Bearer ${token}` });
const post = (url, corps = {}) => request(app).post(url).set(auth()).send(corps);
const put = (url, corps = {}) => request(app).put(url).set(auth()).send(corps);
const get = (url) => request(app).get(url).set(auth());
const pdf = (nom) => ({ buffer: Buffer.from("%PDF-1.4 test " + nom), options: { filename: nom, contentType: "application/pdf" } });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token; userId = login.body.utilisateur.id;
  await pool.query("DELETE FROM etats_charges; DELETE FROM charges_modeles;"); // même point de départ que etatCharges.test.js
  banque = (await post("/api/parametres/comptes-bancaires", { intitule: "BDM bloc", type: "fonctionnement", banque: "BDM SA", numero: "820001" })).body.id;
});
afterAll(async () => {
  await pool.query("DELETE FROM etats_charges WHERE mois >= '2032-01-01'; DELETE FROM charges_modeles WHERE libelle LIKE 'Bloc %';");
  await put("/api/parametres/honoraires", { seuil_justificatif_decaissement: 0 });
  await pool.end();
});

async function creerDossier() {
  const client = await post("/api/clients", { type: "morale", denomination: `Client bloc ${Date.now()}-${Math.random()}` });
  const d = await post("/api/dossiers", { client_id: client.body.id, intitule: "Dossier test bloc", pole: "contentieux", matiere: "Droit civil",
    mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId });
  return d.body;
}
const ligne = (etat, libelle) => etat.lignes.find((l) => l.libelle === libelle);

describe("Catégories étoffées", () => {
  test("les nouvelles catégories sont acceptées (charge habituelle et ponctuelle)", async () => {
    for (const c of ["telephonie_fixe", "credit_telephonique", "transport", "papeterie", "frais_consignation", "frais_grosse", "extrait_plumitif", "frais_diligences", "maintenance_informatique"]) {
      const m = await post("/api/charges/modeles", { libelle: `Bloc ${c}`, categorie: c, montant_habituel: 1000 });
      expect(m.status).toBe(201);
      expect(m.body.categorie).toBe(c);
    }
    expect((await post("/api/charges/modeles", { libelle: "Bloc inconnue", categorie: "n_importe_quoi", montant_habituel: 1 })).status).toBe(400);
    await pool.query("DELETE FROM charges_modeles WHERE libelle LIKE 'Bloc %'"); // ne pas polluer les états créés ensuite
  });
});

describe("Ligne liée à un dossier, bénéficiaire, montant du mois précédent", () => {
  test("dossier exigé, dossier inconnu refusé, rattachement propagé à la dépense approuvée", async () => {
    const dossier = await creerDossier();
    const etat = (await post("/api/charges/etats", { mois: "2032-03" })).body;
    const base = { categorie: "frais_consignation", montant: 80000 };
    expect((await post(`/api/charges/etats/${etat.id}/lignes`, { ...base, libelle: "Bloc sans dossier", nature: "dossier" })).status).toBe(400);
    expect((await post(`/api/charges/etats/${etat.id}/lignes`, { ...base, libelle: "Bloc dossier fantôme", nature: "dossier", dossier_id: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
    expect((await post(`/api/charges/etats/${etat.id}/lignes`, { ...base, libelle: "Bloc trop", beneficiaire: "x".repeat(161) })).status).toBe(400);
    const l = await post(`/api/charges/etats/${etat.id}/lignes`, { ...base, libelle: "Bloc consignation", nature: "dossier", dossier_id: dossier.id, refacturable_client: true, beneficiaire: "Greffe du tribunal" });
    expect(l.status).toBe(201);
    expect(l.body).toMatchObject({ nature: "dossier", dossier_id: dossier.id, refacturable_client: true, beneficiaire: "Greffe du tribunal" });
    const lu = ligne((await get(`/api/charges/etats/${etat.id}`)).body, "Bloc consignation");
    expect(lu.dossier_numero).toBe(dossier.numero);

    expect((await post(`/api/charges/etats/${etat.id}/soumettre`)).status).toBe(200);
    const ok = await post(`/api/charges/etats/${etat.id}/lignes/${l.body.id}/decision`, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    expect(ok.status).toBe(200);
    const dep = (await pool.query("SELECT nature, dossier_id, refacturable_client, beneficiaire FROM depenses WHERE id = $1", [ok.body.depense_id])).rows[0];
    expect(dep).toMatchObject({ nature: "dossier", dossier_id: dossier.id, refacturable_client: true, beneficiaire: "Greffe du tribunal" });
  });

  test("une ligne passée en « cabinet » perd son dossier ; montant du mois précédent renvoyé", async () => {
    const m = await post("/api/charges/modeles", { libelle: "Bloc eau variable", categorie: "eau", montant_habituel: 10000, montant_variable: true, beneficiaire: "SOMAGEP" });
    const e1 = (await post("/api/charges/etats", { mois: "2032-05" })).body;
    const l1 = ligne(e1, "Bloc eau variable");
    expect(l1.beneficiaire).toBe("SOMAGEP");
    expect(l1.montant_precedent).toBeNull();
    const e2 = (await post("/api/charges/etats", { mois: "2032-06" })).body;
    const l2 = ligne(e2, "Bloc eau variable");
    expect(Number(l2.montant_precedent)).toBe(10000);
    await request(app).delete(`/api/charges/modeles/${m.body.id}`).set(auth());
  });
});

describe("Justificatifs d'une ligne", () => {
  test("ajout avant soumission, lecture, recopie sur la dépense à l'approbation, refus après décision", async () => {
    const etat = (await post("/api/charges/etats", { mois: "2032-08" })).body;
    const l = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: "Bloc réparation", categorie: "reparation", montant: 45000 })).body;
    const f = pdf("devis-climatiseur.pdf");
    const ajout = await request(app).post(`/api/charges/etats/${etat.id}/lignes/${l.id}/pieces`).set(auth())
      .field("type", "devis").attach("fichier", f.buffer, f.options);
    expect(ajout.status).toBe(201);
    expect((await request(app).post(`/api/charges/etats/${etat.id}/lignes/${l.id}/pieces`).set(auth()).field("type", "bizarre").attach("fichier", f.buffer, f.options)).status).toBe(400);
    expect((await get(`/api/charges/etats/${etat.id}/lignes/${l.id}/pieces`)).body.length).toBe(1);
    const dl = await get(`/api/charges/etats/${etat.id}/lignes/${l.id}/pieces/${ajout.body.id}/fichier`);
    expect(dl.status).toBe(200);
    expect(ligne((await get(`/api/charges/etats/${etat.id}`)).body, "Bloc réparation").nb_pieces).toBe(1);

    // pièce ajoutée APRÈS soumission, tant que la ligne attend sa décision
    expect((await post(`/api/charges/etats/${etat.id}/soumettre`)).status).toBe(200);
    const f2 = pdf("facture-climatiseur.pdf");
    expect((await request(app).post(`/api/charges/etats/${etat.id}/lignes/${l.id}/pieces`).set(auth()).field("type", "facture").attach("fichier", f2.buffer, f2.options)).status).toBe(201);

    const ok = await post(`/api/charges/etats/${etat.id}/lignes/${l.id}/decision`, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    const sur = (await pool.query("SELECT type, nom, chemin_storage FROM depense_pieces WHERE depense_id = $1 ORDER BY nom", [ok.body.depense_id])).rows;
    expect(sur.map((p) => p.nom)).toEqual(["devis-climatiseur.pdf", "facture-climatiseur.pdf"]);
    const origines = (await pool.query("SELECT chemin_storage FROM etats_charges_pieces WHERE ligne_id = $1", [l.id])).rows.map((r) => r.chemin_storage);
    for (const p of sur) expect(origines).not.toContain(p.chemin_storage); // fichiers dupliqués, pas partagés

    const apres = await request(app).post(`/api/charges/etats/${etat.id}/lignes/${l.id}/pieces`).set(auth()).field("type", "facture").attach("fichier", f2.buffer, f2.options);
    expect(apres.status).toBe(409);
  });
});

describe("Décision groupée (facultative)", () => {
  test("approuve les lignes en attente à montant positif, garde le moyen existant, laisse la ligne à zéro", async () => {
    const etat = (await post("/api/charges/etats", { mois: "2032-10" })).body;
    const mk = (libelle, montant, extra = {}) => post(`/api/charges/etats/${etat.id}/lignes`, { libelle, categorie: "entretien", montant, ...extra });
    const a = (await mk("Bloc groupe A", 10000)).body;
    const b = (await mk("Bloc groupe B", 20000, { mode_paiement: "virement", compte_id: banque })).body;
    const z = (await mk("Bloc groupe zéro", 0)).body;
    expect((await post(`/api/charges/etats/${etat.id}/approuver-tout`, {})).status).toBe(409); // état pas encore soumis
    expect((await post(`/api/charges/etats/${etat.id}/soumettre`)).status).toBe(200);

    const r = await post(`/api/charges/etats/${etat.id}/approuver-tout`, { mode_paiement: "virement", compte_id: banque });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ approuvees: 2, ignorees: 1, total_approuve: 30000 });
    const apres = r.body.lignes;
    expect(apres.find((l) => l.id === a.id)).toMatchObject({ decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    expect(apres.find((l) => l.id === b.id).decision).toBe("approuvee");
    expect(apres.find((l) => l.id === z.id).decision).toBe("en_attente");
    const deps = await pool.query("SELECT statut FROM depenses WHERE id = ANY($1::uuid[])", [[a.id, b.id].map((id) => apres.find((l) => l.id === id).depense_id)]);
    expect(deps.rows.every((d) => d.statut === "validee")).toBe(true);
    expect((await post(`/api/charges/etats/${etat.id}/approuver-tout`, { mode_paiement: "virement", compte_id: banque })).status).toBe(409); // plus rien d'approuvable
    const audit = await pool.query("SELECT 1 FROM journal_audit WHERE action = 'etat_charges_approuver_tout' AND entite_id = $1", [etat.id]);
    expect(audit.rows.length).toBe(1);
  });

  test("tout ou rien : une ligne sans moyen ni moyen par défaut valide n'empêche pas, un moyen incompatible annule tout", async () => {
    const etat = (await post("/api/charges/etats", { mois: "2032-11" })).body;
    const x = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: "Bloc tout ou rien", categorie: "entretien", montant: 5000 })).body;
    await post(`/api/charges/etats/${etat.id}/soumettre`);
    const ko = await post(`/api/charges/etats/${etat.id}/approuver-tout`, { mode_paiement: "orange_money", compte_id: banque });
    expect(ko.status).toBe(400);
    const lu = ligne((await get(`/api/charges/etats/${etat.id}`)).body, "Bloc tout ou rien");
    expect(lu.decision).toBe("en_attente");
    expect(x.id).toBe(lu.id);
  });
});

describe("Justificatif exigé avant décaissement (seuil facultatif)", () => {
  test("désactivé par défaut ; au-delà du seuil, une facture est exigée", async () => {
    const etat = (await post("/api/charges/etats", { mois: "2032-12" })).body;
    const l = (await post(`/api/charges/etats/${etat.id}/lignes`, { libelle: "Bloc seuil", categorie: "reparation", montant: 200000 })).body;
    await post(`/api/charges/etats/${etat.id}/soumettre`);
    const ok = await post(`/api/charges/etats/${etat.id}/lignes/${l.id}/decision`, { decision: "approuvee", mode_paiement: "virement", compte_id: banque });
    const dep = ok.body.depense_id;

    expect((await put("/api/parametres/honoraires", { seuil_justificatif_decaissement: 100000 })).status).toBe(200);
    const sans = await post(`/api/depenses/${dep}/decaisser`, { mode_paiement: "virement", compte_id: banque, references: {} });
    expect(sans.status).toBe(409);
    expect(sans.body.error).toMatch(/justificatif/i);

    const f = pdf("facture.pdf");
    expect((await request(app).post(`/api/depenses/${dep}/pieces`).set(auth()).field("type", "facture").attach("fichier", f.buffer, f.options)).status).toBe(201);
    const avec = await post(`/api/depenses/${dep}/decaisser`, { mode_paiement: "virement", compte_id: banque, references: {} });
    expect(avec.status).not.toBe(409);

    expect((await put("/api/parametres/honoraires", { seuil_justificatif_decaissement: 0 })).status).toBe(200);
  });
});
