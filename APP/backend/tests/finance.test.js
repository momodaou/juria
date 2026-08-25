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
let userId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
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

async function creerDossier(clientId, overrides = {}) {
  const res = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `FIN-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test facturation",
      client_id: clientId,
      pole: "contentieux",
      responsable_id: userId,
      ...overrides,
    });
  return res.body.id;
}

async function creerTemps(dossierId, overrides = {}) {
  const res = await request(app)
    .post("/api/temps")
    .set("Authorization", `Bearer ${token}`)
    .send({ dossier_id: dossierId, duree_minutes: 60, taux_horaire: 25000, ...overrides });
  return res.body.id;
}

// Crée une dépense refacturable et la fait passer par le circuit complet
// (soumise -> validée -> décaissée) : seule une dépense décaissée est
// éligible à la refacturation (voir factures.js).
// pdfkit encode le texte des polices standard (Helvetica) en runs
// hexadécimaux <...> entrecoupés d'ajustements numériques de crénage dans
// les tableaux TJ (ex. "[<54> 80 <6f74616c...> 0] TJ") plutôt qu'en chaînes
// littérales lisibles — même sans compression du flux. Pour un test ciblé
// sur de l'ASCII pur (WinAnsiEncoding = ASCII sur cette plage), reconstruire
// le texte en concaténant les runs hex dans l'ordre suffit à retrouver les
// mots entiers malgré le découpage par le crénage.
function extraireTexteVisible(pdfBuffer) {
  const brut = pdfBuffer.toString("latin1");
  return [...brut.matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((m) => Buffer.from(m[1], "hex").toString("latin1"))
    .join("");
}

async function creerDeboursDecaisse(dossierId, overrides = {}) {
  const creation = await request(app)
    .post("/api/depenses")
    .set("Authorization", `Bearer ${token}`)
    .send({
      type: "ponctuelle",
      categorie: "frais_procedure",
      libelle: "Frais de greffe test",
      montant: 15000,
      refacturable_client: true,
      dossier_id: dossierId,
      ...overrides,
    });
  const id = creation.body.id;
  await request(app).post(`/api/depenses/${id}/decision`).set("Authorization", `Bearer ${token}`).send({ statut: "validee" });
  await request(app).post(`/api/depenses/${id}/decaisser`).set("Authorization", `Bearer ${token}`);
  return id;
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

describe("Facturation — validation montant_ht (diagnostic 22/08/2026)", () => {
  test("montant_ht = 0 refusé", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 0 });
    expect(res.status).toBe(400);
  });

  test("montant_ht négatif refusé", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: -1000 });
    expect(res.status).toBe(400);
  });

  test("montant_ht non numérique refusé", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: "abc" });
    expect(res.status).toBe(400);
  });
});

describe("Facturation — TVA par localisation insensible à la casse/espaces (diagnostic 22/08/2026)", () => {
  test("pays = 'MALI' (majuscules) applique bien 18 %, pas 0 %", async () => {
    const clientId = await creerClient({ pays: "MALI" });
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ttc)).toBe(118000);
  });

  test("pays = ' Mali ' (espaces superflus) applique bien 18 %", async () => {
    const clientId = await creerClient({ pays: " Mali " });
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ttc)).toBe(118000);
  });
});

describe("Facturation depuis des temps saisis (diagnostic 22/08/2026)", () => {
  test("crée une facture depuis 2 temps sélectionnés, montant_ht = somme, temps marqués facturés", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const t1 = await creerTemps(dossierId, { duree_minutes: 60, taux_horaire: 25000 }); // 25 000
    const t2 = await creerTemps(dossierId, { duree_minutes: 30, taux_horaire: 25000 }); // 12 500
    const t3 = await creerTemps(dossierId, { duree_minutes: 60, taux_horaire: 10000 }); // pas sélectionné

    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [t1, t2] });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ht)).toBe(37500);
    expect(res.body.devise).toBe("XOF");

    const { rows } = await pool.query("SELECT id, facture_id FROM temps WHERE id = ANY($1::uuid[])", [[t1, t2, t3]]);
    const parId = Object.fromEntries(rows.map((r) => [r.id, r.facture_id]));
    expect(parId[t1]).toBe(res.body.id);
    expect(parId[t2]).toBe(res.body.id);
    expect(parId[t3]).toBeNull();
  });

  test("un temps déjà facturé ne peut pas être resélectionné (409)", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const t1 = await creerTemps(dossierId);
    const premiere = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [t1] });
    expect(premiere.status).toBe(201);

    const seconde = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [t1] });
    expect(seconde.status).toBe(409);
  });

  test("une devise non-XOF avec temps_ids est refusée (taux horaire toujours en FCFA)", async () => {
    const clientId = await creerClient({ pays: "France" });
    const dossierId = await creerDossier(clientId);
    const t1 = await creerTemps(dossierId);
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", devise: "EUR", temps_ids: [t1] });
    expect(res.status).toBe(400);
  });

  test("GET /api/temps?non_factures=true n'expose que les temps facturables non encore facturés", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const facturable = await creerTemps(dossierId, { facturable: true });
    const nonFacturable = await creerTemps(dossierId, { facturable: false });
    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [facturable] });

    const liste = await request(app)
      .get(`/api/temps?dossier_id=${dossierId}&non_factures=true`)
      .set("Authorization", `Bearer ${token}`);
    expect(liste.status).toBe(200);
    const ids = liste.body.map((t) => t.id);
    expect(ids).not.toContain(facturable); // déjà facturé
    expect(ids).not.toContain(nonFacturable); // pas facturable
  });
});

describe("POST /api/factures/:id/annuler (diagnostic 22/08/2026)", () => {
  test("annule une facture émise sans paiement", async () => {
    const clientId = await creerClient();
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    const res = await request(app)
      .post(`/api/factures/${facture.body.id}/annuler`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe("annulee");
  });

  test("refuse d'annuler une facture déjà (même partiellement) réglée", async () => {
    const clientId = await creerClient();
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    await request(app)
      .post(`/api/factures/${facture.body.id}/paiements`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant: 10000, mode: "virement" });

    const res = await request(app)
      .post(`/api/factures/${facture.body.id}/annuler`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  test("refuse d'annuler deux fois la même facture", async () => {
    const clientId = await creerClient();
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });
    await request(app).post(`/api/factures/${facture.body.id}/annuler`).set("Authorization", `Bearer ${token}`);
    const res = await request(app)
      .post(`/api/factures/${facture.body.id}/annuler`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });

  test("libère les temps rattachés (facture_id remis à NULL) en cas d'annulation", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const t1 = await creerTemps(dossierId);
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [t1] });

    await request(app).post(`/api/factures/${facture.body.id}/annuler`).set("Authorization", `Bearer ${token}`);

    const { rows } = await pool.query("SELECT facture_id FROM temps WHERE id = $1", [t1]);
    expect(rows[0].facture_id).toBeNull();
  });
});

describe("Facturation — débours refacturables au client (25/08/2026)", () => {
  test("crée une facture depuis 1 débours décaissé, montant_debours = montant de la dépense, TTC = HT+TVA+débours", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const depenseId = await creerDeboursDecaisse(dossierId);

    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "forfait", montant_ht: 100000, depense_ids: [depenseId] });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_debours)).toBe(15000);
    // 100000 HT + 18% TVA (118000) + 15000 débours hors TVA = 133000
    expect(Number(res.body.montant_ttc)).toBe(133000);

    const { rows } = await pool.query("SELECT facture_id FROM depenses WHERE id = $1", [depenseId]);
    expect(rows[0].facture_id).toBe(res.body.id);
  });

  test("une dépense pas encore décaissée (juste validée) n'est pas éligible", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const creation = await request(app)
      .post("/api/depenses")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ponctuelle", categorie: "frais_procedure", libelle: "Non décaissée", montant: 5000, refacturable_client: true, dossier_id: dossierId });
    await request(app).post(`/api/depenses/${creation.body.id}/decision`).set("Authorization", `Bearer ${token}`).send({ statut: "validee" });

    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "forfait", montant_ht: 10000, depense_ids: [creation.body.id] });
    expect(res.status).toBe(409);
  });

  test("une dépense déjà refacturée ne peut pas être resélectionnée (409)", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const depenseId = await creerDeboursDecaisse(dossierId);
    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "forfait", montant_ht: 10000, depense_ids: [depenseId] });

    const seconde = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "forfait", montant_ht: 10000, depense_ids: [depenseId] });
    expect(seconde.status).toBe(409);
  });

  test("une facture composée uniquement de débours (sans montant_ht) est acceptée", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const depenseId = await creerDeboursDecaisse(dossierId);
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "forfait", depense_ids: [depenseId] });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_ht)).toBe(0);
    expect(Number(res.body.montant_debours)).toBe(15000);
    expect(Number(res.body.montant_ttc)).toBe(15000);
  });

  test("l'annulation libère les dépenses rattachées (facture_id remis à NULL)", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const depenseId = await creerDeboursDecaisse(dossierId);
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "forfait", depense_ids: [depenseId] });

    await request(app).post(`/api/factures/${facture.body.id}/annuler`).set("Authorization", `Bearer ${token}`);

    const { rows } = await pool.query("SELECT facture_id FROM depenses WHERE id = $1", [depenseId]);
    expect(rows[0].facture_id).toBeNull();
  });

  test("GET /api/depenses?a_refacturer=true n'expose que les dépenses décaissées, refacturables, non encore facturées", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const eligible = await creerDeboursDecaisse(dossierId);
    const nonRefacturable = await creerDeboursDecaisse(dossierId, { libelle: "Non refacturable", refacturable_client: false });

    const liste = await request(app)
      .get(`/api/depenses?dossier_id=${dossierId}&a_refacturer=true`)
      .set("Authorization", `Bearer ${token}`);
    expect(liste.status).toBe(200);
    const ids = liste.body.map((d) => d.id);
    expect(ids).toContain(eligible);
    expect(ids).not.toContain(nonRefacturable);
  });
});

describe("Facturation — montant_frais (25/08/2026)", () => {
  test("montant_frais s'ajoute au TTC, hors TVA", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000, montant_frais: 3000 });
    expect(res.status).toBe(201);
    expect(Number(res.body.montant_frais)).toBe(3000);
    expect(Number(res.body.montant_ttc)).toBe(121000); // 100000 + 18000 TVA + 3000 frais
  });

  test("montant_frais négatif refusé", async () => {
    const clientId = await creerClient();
    const res = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000, montant_frais: -500 });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/factures/:id/pdf — support « papier numérique » (25/08/2026)", () => {
  test("renvoie un vrai PDF (en-tête %PDF) pour une facture existante", async () => {
    const clientId = await creerClient();
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000 });

    const res = await request(app)
      .get(`/api/factures/${facture.body.id}/pdf`)
      .buffer(true)
      .parse((response, cb) => {
        const chunks = [];
        response.on("data", (c) => chunks.push(c));
        response.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.length).toBeGreaterThan(500); // vrai contenu, pas une réponse vide
    expect(res.body.slice(0, 4).toString("ascii")).toBe("%PDF");
  });

  test("404 propre pour une facture inexistante", async () => {
    const res = await request(app)
      .get("/api/factures/00000000-0000-0000-0000-000000000000/pdf")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test("le PDF liste nommément les temps et débours rattachés à la facture (plus volumineux qu'une facture sans détail)", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const t1 = await creerTemps(dossierId, { description: "Redaction assignation" });
    const depenseId = await creerDeboursDecaisse(dossierId, { libelle: "Frais de greffe unique" });

    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [t1], depense_ids: [depenseId] });
    expect(facture.status).toBe(201);

    const pdf = (id) =>
      request(app)
        .get(`/api/factures/${id}/pdf`)
        .buffer(true)
        .parse((response, cb) => {
          const chunks = [];
          response.on("data", (c) => chunks.push(c));
          response.on("end", () => cb(null, Buffer.concat(chunks)));
        })
        .set("Authorization", `Bearer ${token}`);

    const res = await pdf(facture.body.id);
    expect(res.status).toBe(200);
    const texte = extraireTexteVisible(res.body);
    expect(texte).toContain("Redaction assignation");
    expect(texte).toContain("Frais de greffe unique");
  });
});
