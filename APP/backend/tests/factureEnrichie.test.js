// JURIA — facture PDF enrichie (28/08/2026) : identité du cabinet,
// comptes bancaires (RIB), mode_reglement/compte_reglement_id/mention
// enfin câblés sur POST /api/factures, contenu du PDF (DOIT, dossier suivi
// par, montant en toutes lettres, informations de paiement).
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

// Même patron que finance.test.js : pdfkit encode le texte en runs
// hexadécimaux dans les tableaux TJ — reconstruire dans l'ordre suffit pour
// une assertion sur de l'ASCII pur.
function extraireTexteVisible(pdfBuffer) {
  const brut = pdfBuffer.toString("latin1");
  return [...brut.matchAll(/<([0-9a-fA-F]+)>/g)]
    .map((m) => Buffer.from(m[1], "hex").toString("latin1"))
    .join("");
}

function pdf(id) {
  return request(app)
    .get(`/api/factures/${id}/pdf`)
    .buffer(true)
    .parse((response, cb) => {
      const chunks = [];
      response.on("data", (c) => chunks.push(c));
      response.on("end", () => cb(null, Buffer.concat(chunks)));
    })
    .set("Authorization", `Bearer ${token}`);
}

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
      intitule: "Dossier test facture enrichie",
      client_id: clientId,
      pole: "contentieux",
      responsable_id: userId,
      ...overrides,
    });
  return res.body.id;
}

describe("Paramètres cabinet — identité + comptes bancaires (28/08/2026)", () => {
  test("GET/PUT /api/parametres/cabinet", async () => {
    const put = await request(app)
      .put("/api/parametres/cabinet")
      .set("Authorization", `Bearer ${token}`)
      .send({ adresse: "Immeuble Test, Bamako", nif: "0841357834" });
    expect(put.status).toBe(200);
    expect(put.body.adresse).toBe("Immeuble Test, Bamako");

    const get = await request(app).get("/api/parametres/cabinet").set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.nif).toBe("0841357834");
  });

  test("POST/GET/PUT /api/parametres/comptes-bancaires (RIB structuré)", async () => {
    const creation = await request(app)
      .post("/api/parametres/comptes-bancaires")
      .set("Authorization", `Bearer ${token}`)
      .send({
        intitule: "Compte fonctionnement test",
        type: "fonctionnement",
        banque: "BDM SA",
        numero: "000000000000",
        code_banque: "GA000",
        code_guichet: "00000",
        cle_rib: "00",
        iban: "GA0000000000000000000000000",
        bic: "TESTGAXX",
      });
    expect(creation.status).toBe(201);
    const id = creation.body.id;

    const liste = await request(app).get("/api/parametres/comptes-bancaires").set("Authorization", `Bearer ${token}`);
    expect(liste.status).toBe(200);
    const trouve = liste.body.find((c) => c.id === id);
    expect(trouve.cle_rib).toBe("00");
    expect(trouve.actif).toBe(true);

    const maj = await request(app)
      .put(`/api/parametres/comptes-bancaires/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ actif: false });
    expect(maj.status).toBe(200);
    const liste2 = await request(app).get("/api/parametres/comptes-bancaires").set("Authorization", `Bearer ${token}`);
    expect(liste2.body.find((c) => c.id === id).actif).toBe(false);
  });
});

describe("Facture PDF enrichie — contenu (28/08/2026)", () => {
  test("mode_reglement/compte_reglement_id/mention acceptés et imprimés sur le PDF", async () => {
    const compteRes = await request(app)
      .post("/api/parametres/comptes-bancaires")
      .set("Authorization", `Bearer ${token}`)
      .send({
        intitule: "Compte facture test",
        type: "fonctionnement",
        banque: "ECOBANK",
        numero: "111111111111",
        code_banque: "ML001",
        code_guichet: "00100",
        cle_rib: "42",
      });
    const compteId = compteRes.body.id;

    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);

    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({
        dossier_id: dossierId,
        client_id: clientId,
        mode: "forfait",
        montant_ht: 100000,
        taux_tva: 18,
        mode_reglement: "virement",
        compte_reglement_id: compteId,
        mention: "Frais de virement a la charge du client",
      });
    expect(facture.status).toBe(201);
    // montant_ht 100000 + TVA 18% = 118 000 -> "Cent Dix-Huit Mille Francs CFA"
    expect(Number(facture.body.montant_ttc)).toBe(118000);

    const res = await pdf(facture.body.id);
    expect(res.status).toBe(200);
    const texte = extraireTexteVisible(res.body);
    expect(texte).toContain("DOIT");
    expect(texte).toContain("Dossier suivi par");
    expect(texte).toContain("Cent Dix-Huit Mille Francs CFA");
    expect(texte).toContain("Informations de paiement");
    expect(texte).toContain("Compte facture test");
    expect(texte).toContain("ML001");
    expect(texte).toContain("111111111111"); // numero de compte
    expect(texte).toContain("Frais de virement a la charge du client");
  });

  test("sans dossier ni compte de reglement : le PDF reste genere sans section vide fautive", async () => {
    const clientId = await creerClient();
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, mode: "forfait", montant_ht: 50000 });
    expect(facture.status).toBe(201);

    const res = await pdf(facture.body.id);
    expect(res.status).toBe(200);
    const texte = extraireTexteVisible(res.body);
    expect(texte).toContain("DOIT");
    expect(texte).not.toContain("Dossier suivi par");
  });
});
