// JURIA — tests ciblés sur la logique financière : rétrocessions
// d'honoraires et facturation (TVA par localisation, multi-devises).
//
// Contexte (17/08/2026) : l'audit des routes s'était arrêté au typage
// SQL. Un second passage sur factures.js a révélé que la règle transverse
// « multi-devises + TVA selon localisation client » (cf. CLAUDE.md) n'était
// pas câblée du tout, alors que le schéma la prévoyait déjà (tables
// devises/taux_change, colonnes factures.taux_applique/montant_ttc_xof —
// héritées du kit de démarrage mais jamais utilisées). Ce fichier fige le
// comportement correct une fois câblé, pour que la régression inverse
// (un futur changement qui recasse la conversion ou la TVA) soit détectée
// automatiquement plutôt que découverte à la main comme cette fois-ci.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

async function creerClient(overrides = {}) {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client test ${Date.now()}-${Math.random()}`, ...overrides });
  return res.body.id;
}

describe("Rétrocessions — calcul par qualité et règle tout ou rien", () => {
  let beneficiaireId;

  beforeAll(async () => {
    const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
    beneficiaireId = login.body.utilisateur.id;
  });

  test.each([
    ["associe", 30],
    ["collaborateur", 25],
    ["non_avocat", 10],
  ])("taux par défaut pour qualite=%s (%i%%)", async (qualite, tauxAttendu) => {
    const res = await request(app)
      .post("/api/retrocessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ beneficiaire_id: beneficiaireId, qualite, base_ht: 1000000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.taux)).toBe(tauxAttendu);
    expect(Number(res.body.montant)).toBe(Math.round((1000000 * tauxAttendu) / 100));
  });

  test("refuse une qualité inconnue", async () => {
    const res = await request(app)
      .post("/api/retrocessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ beneficiaire_id: beneficiaireId, qualite: "stagiaire_fantome", base_ht: 100000 });
    expect(res.status).toBe(400);
  });

  test("tout ou rien : refuse le décaissement tant que la facture liée n'est pas intégralement encaissée", async () => {
    const clientId = await creerClient();
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 1000000 });
    const factureId = facture.body.id;

    const retro = await request(app)
      .post("/api/retrocessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ beneficiaire_id: beneficiaireId, qualite: "associe", base_ht: 1000000, facture_id: factureId });
    const retroId = retro.body.id;

    // Encaissement partiel seulement.
    await request(app)
      .post(`/api/factures/${factureId}/paiements`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant: 500000, mode: "virement" });

    const refus = await request(app)
      .post(`/api/retrocessions/${retroId}/decaisser`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(refus.status).toBe(400);

    // Solde le reste : la facture est maintenant intégralement encaissée.
    await request(app)
      .post(`/api/factures/${factureId}/paiements`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant: 680000, mode: "virement" }); // 500 000 + 680 000 = TTC exact (1 180 000, TVA 18%)

    const ok = await request(app)
      .post(`/api/retrocessions/${retroId}/decaisser`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(ok.status).toBe(200);
    expect(ok.body.statut).toBe("decaissee");
  });
});

describe("Facturation — TVA selon localisation, calcul TTC", () => {
  test("client localisé au Mali (défaut) : TVA 18% appliquée", async () => {
    const clientId = await creerClient(); // pays par défaut = Mali (schéma)
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ttc)).toBe(118000);
  });

  test("client hors Mali : TVA 0% par défaut (territorialité)", async () => {
    const clientId = await creerClient({ pays: "France" });
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ttc)).toBe(100000);
  });

  test("taux_tva explicite écrase toujours le défaut par localisation", async () => {
    const clientId = await creerClient({ pays: "France" });
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000, taux_tva: 5 });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ttc)).toBe(105000);
  });
});

describe("Facturation — multi-devises, taux verrouillé à l'émission", () => {
  test("XOF (défaut) : taux_applique = 1, pas de conversion", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.taux_applique)).toBe(1);
    expect(Number(res.body.montant_ttc_xof)).toBe(Number(res.body.montant_ttc));
  });

  test("EUR : taux fixe 655,957 (parité BCEAO), un taux fourni par erreur est ignoré", async () => {
    const clientId = await creerClient({ pays: "France" });
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 1000, devise: "EUR", taux_applique: 700 });
    expect(res.status).toBe(201);
    expect(Number(res.body.taux_applique)).toBe(655.957);
    expect(Number(res.body.montant_ttc_xof)).toBe(Math.round(Number(res.body.montant_ttc) * 655.957));
  });

  test("devise flottante (USD) sans aucun taux connu : refusée plutôt que d'inventer un taux", async () => {
    const clientId = await creerClient({ pays: "USA" });
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 1000, devise: "USD" });
    expect(res.status).toBe(400);
  });

  test("devise flottante (GBP) avec taux fourni : verrouillé sur la facture, réutilisé à l'appel suivant sans le refournir", async () => {
    const clientId = await creerClient({ pays: "Royaume-Uni" });
    const f1 = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 1000, devise: "GBP", taux_applique: 800 });
    expect(f1.status).toBe(201);
    expect(Number(f1.body.taux_applique)).toBe(800);

    const f2 = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 500, devise: "GBP" });
    expect(f2.status).toBe(201);
    expect(Number(f2.body.taux_applique)).toBe(800);
  });

  test("un paiement hérite de la devise et du taux figé de sa facture", async () => {
    const clientId = await creerClient({ pays: "France" });
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 1000, devise: "EUR" });
    const factureId = facture.body.id;

    const paiement = await request(app)
      .post(`/api/factures/${factureId}/paiements`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant: 400, mode: "virement" });
    expect(paiement.status).toBe(201);

    const { rows } = await pool.query(
      "SELECT devise, taux_applique, montant_xof FROM paiements WHERE facture_id = $1",
      [factureId]
    );
    expect(rows[0].devise).toBe("EUR");
    expect(Number(rows[0].taux_applique)).toBe(655.957);
    expect(Number(rows[0].montant_xof)).toBe(Math.round(400 * 655.957));
  });
});

describe("Facturation — nom du client affiché (bug dénomination vide, 22/08/2026)", () => {
  // Contexte : un client "personne physique" créé avec denomination:'' (au
  // lieu de NULL — cas réel trouvé en production, cf. HISTORY.md) faisait
  // échouer COALESCE(c.denomination, c.prenom||' '||c.nom) : COALESCE ne
  // saute que les valeurs NULL, pas les chaînes vides, donc le nom affiché
  // sur la facture restait vide au lieu de retomber sur "Prénom Nom".
  test("POST /api/clients normalise une dénomination vide ('') en NULL, pas en ''", async () => {
    const res = await request(app)
      .post("/api/clients")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "physique", denomination: "", prenom: "Aminata", nom: "Traoré" });
    expect(res.status).toBe(201);
    const { rows } = await pool.query("SELECT denomination FROM clients WHERE id = $1", [res.body.id]);
    expect(rows[0].denomination).toBeNull();
  });

  test("une facture affiche prénom+nom même si la dénomination du client est restée '' en base (donnée historique)", async () => {
    const clientId = await creerClient({ type: "physique", denomination: "Ignoré", prenom: "Kamafily", nom: "Sissoko" });
    // Simule la donnée corrompue trouvée en production (créée avant le
    // correctif ci-dessus) : impossible à obtenir via l'API depuis ce
    // correctif, d'où l'écriture directe pour reproduire l'état constaté.
    await pool.query("UPDATE clients SET denomination = '' WHERE id = $1", [clientId]);

    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    expect(facture.status).toBe(201);

    const liste = await request(app)
      .get("/api/factures")
      .set("Authorization", `Bearer ${token}`);
    const ligne = liste.body.find((f) => f.id === facture.body.id);
    expect(ligne).toBeDefined();
    expect(ligne.client).toBe("Kamafily Sissoko");
  });
});
