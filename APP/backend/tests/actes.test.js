// JURIA — Atelier d'actes : catalogue de modèles dynamique + cycle
// brouillon/édition/validation/PDF (13/09/2026, 1re suite de tests pour ce
// module — jusqu'ici jamais couvert explicitement).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client Actes ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

async function creerDossier(clientId) {
  const res = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `ACT-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test actes",
      pole: "contentieux",
      client_id: clientId,
      responsable_id: associeId,
      mode_honoraires: "forfait",
    });
  return res.body.id;
}

async function creerUtilisateur(role) {
  const jwt = require("jsonwebtoken");
  const { SECRET } = require("../src/auth");
  const bcrypt = require("bcryptjs");
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestActes123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Actes',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`A${suffixe.slice(0, 7)}`, `test.actes.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jeton = jwt.sign({ sub: rows[0].id, role, nom: "Test Actes" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jeton };
}

describe("GET /api/actes/modeles — catalogue actif", () => {
  test("renvoie les modèles seedés (mise en demeure notamment)", async () => {
    const res = await request(app).get("/api/actes/modeles").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.some((m) => m.code === "mise_en_demeure")).toBe(true);
    expect(res.body.some((m) => m.code === "autre")).toBe(true);
  });
});

describe("Gestion du catalogue — réservée à actes.modeles.gerer", () => {
  test("GET /modeles/tous refusé à un collaborateur", async () => {
    const collab = await creerUtilisateur("collaborateur");
    const res = await request(app).get("/api/actes/modeles/tous").set("Authorization", `Bearer ${collab.token}`);
    expect(res.status).toBe(403);
  });

  test("un associé peut créer, modifier, désactiver un modèle", async () => {
    const code = `test_modele_${Date.now()}`;
    const creation = await request(app)
      .post("/api/actes/modeles")
      .set("Authorization", `Bearer ${token}`)
      .send({ code, nom: "Modèle de test", categorie: "correspondance", corps: "Bonjour {{client}}." });
    expect(creation.status).toBe(201);
    const id = creation.body.id;

    const doublon = await request(app)
      .post("/api/actes/modeles")
      .set("Authorization", `Bearer ${token}`)
      .send({ code, nom: "Doublon", corps: "x" });
    expect(doublon.status).toBe(409);

    const maj = await request(app)
      .put(`/api/actes/modeles/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ nom: "Modèle de test (modifié)" });
    expect(maj.status).toBe(200);
    expect(maj.body.nom).toBe("Modèle de test (modifié)");

    const desactivation = await request(app).delete(`/api/actes/modeles/${id}`).set("Authorization", `Bearer ${token}`);
    expect(desactivation.status).toBe(204);

    const listeActifs = await request(app).get("/api/actes/modeles").set("Authorization", `Bearer ${token}`);
    expect(listeActifs.body.some((m) => m.code === code)).toBe(false);

    const listeTous = await request(app).get("/api/actes/modeles/tous").set("Authorization", `Bearer ${token}`);
    const entree = listeTous.body.find((m) => m.code === code);
    expect(entree).toBeDefined();
    expect(entree.actif).toBe(false);
  });
});

describe("Balises enrichies (27/10/2026)", () => {
  test("GET /balises renvoie le catalogue, et chaque balise est fournie par applatirContexte", async () => {
    const res = await request(app).get("/api/actes/balises").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const { applatirContexte } = require("../src/routes/actes");
    const plat = applatirContexte({ date: "01/01/2026", dossier: {}, cabinet: {} });
    const cles = res.body.map((b) => b.cle);
    expect(cles.length).toBeGreaterThan(30);
    for (const cle of cles) expect(plat).toHaveProperty(cle);
    // Aucune balise fournie mais non documentée.
    for (const cle of Object.keys(plat)) expect(cles).toContain(cle);
  });

  test("client complet, instance en cours, parties adverses et prochaine audience sont fusionnés", async () => {
    const cl = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`).send({
      type: "morale", denomination: `Société Balises ${Date.now()}`, forme_juridique: "SARL", rccm: "XX-TEST-2020-B-0001",
      nif: "NIF-777", adresse: "Rue Fictive 3", ville: "Bamako",
    });
    const dossierId = await creerDossier(cl.body.id);
    // Deux instructions distinctes (comme à l'ouverture) : l'ordre des parties suit leur horodatage de création.
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, conseil) VALUES ($1,'adverse','Alpha SA','Me Fictif')", [dossierId]);
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination) VALUES ($1,'adverse','Beta SARL')", [dossierId]);
    await pool.query("INSERT INTO instances (dossier_id, degre, juridiction, numero_role, date_debut, statut_partie) VALUES ($1,'appel','Cour d''appel de Bamako','RG 42/26','2026-09-01','demandeur')", [dossierId]);
    await pool.query("INSERT INTO audiences (dossier_id, juridiction, date_audience) VALUES ($1,'Cour d''appel de Bamako', current_date + 10)", [dossierId]);
    await pool.query(
      "INSERT INTO modeles_actes (code, nom, corps) VALUES ($1,'Test balises',$2) ON CONFLICT (code) DO NOTHING",
      ["test_balises", "{{client_identification}}|{{parties_adverses}}|{{conseil_adverse}}|{{instance_degre}}|{{instance_numero_role}}|{{client_qualite}}|{{audience_prochaine_juridiction}}|{{client_telephone}}"]
    );
    const res = await request(app).post("/api/actes/generer").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "test_balises" });
    expect(res.status).toBe(201);
    expect(res.body.texte).toContain("SARL, immatriculée au RCCM sous le numéro XX-TEST-2020-B-0001, NIF NIF-777, ayant son siège social à Rue Fictive 3, Bamako");
    expect(res.body.texte).toContain("Alpha SA et Beta SARL|Me Fictif|appel|RG 42/26|Appelant|Cour d'appel de Bamako|[à compléter]");
    expect(res.body.texte).not.toContain("{{");
  });
});

describe("POST /api/actes/generer — fusion des placeholders", () => {
  test("le texte généré contient bien le client et la référence du dossier", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const res = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "mise_en_demeure" });
    expect(res.status).toBe(201);
    expect(res.body.statut).toBe("brouillon");
    expect(res.body.version).toBe(1);
    expect(res.body.texte).toContain("MISE EN DEMEURE");
    // Le placeholder n'est jamais laissé tel quel une fois fusionné.
    expect(res.body.texte).not.toContain("{{");
  });

  test("modèle inconnu ou désactivé renvoie 400", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const res = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "code_inexistant" });
    expect(res.status).toBe(400);
  });
});

describe("Cycle brouillon → édition → validation → PDF", () => {
  test("PUT /:id incrémente la version et met à jour le texte", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const id = gen.body.id;

    const edition = await request(app)
      .put(`/api/actes/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ texte: "Texte corrigé par l'avocat." });
    expect(edition.status).toBe(200);
    expect(edition.body.version).toBe(2);
    expect(edition.body.texte).toBe("Texte corrigé par l'avocat.");
  });

  test("PUT /:id sans texte renvoie 400", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const res = await request(app).put(`/api/actes/${gen.body.id}`).set("Authorization", `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  test("PUT /:id refusé sur un document qui n'est pas un acte texte", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const { rows } = await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, auteur_id)
       VALUES ($1,'Pièce scannée','piece_client','valide','file:///tmp/x.pdf','application/pdf',
               (SELECT id FROM utilisateurs WHERE email = $2))
       RETURNING id`,
      [dossierId, require("./setup").EMAIL_TEST]
    );
    const res = await request(app)
      .put(`/api/actes/${rows[0].id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ texte: "Tentative" });
    expect(res.status).toBe(400);
  });

  test("POST /:id/statut fait basculer brouillon <-> valide", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const id = gen.body.id;

    const valider = await request(app).post(`/api/actes/${id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "valide" });
    expect(valider.status).toBe(200);
    expect(valider.body.statut).toBe("valide");

    const revenir = await request(app).post(`/api/actes/${id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "brouillon" });
    expect(revenir.status).toBe(200);
    expect(revenir.body.statut).toBe("brouillon");
  });

  test("POST /:id/statut avec une valeur invalide renvoie 400", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const res = await request(app)
      .post(`/api/actes/${gen.body.id}/statut`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statut: "archive" });
    expect(res.status).toBe(400);
  });

  test("GET /:id/pdf renvoie un PDF", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "mise_en_demeure" });
    const res = await request(app).get(`/api/actes/${gen.body.id}/pdf`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });

  test("GET /:id/pdf sur un id inexistant renvoie 404", async () => {
    const res = await request(app)
      .get("/api/actes/00000000-0000-0000-0000-000000000000/pdf")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("Sortie Word (.docx) et pièces à citer (28/10/2026)", () => {
  const JSZip = require("jszip");
  const binaire = (res, cb) => { res.setEncoding("binary"); let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => cb(null, Buffer.from(d, "binary"))); };

  async function lireDocx(id) {
    const res = await request(app).get(`/api/actes/${id}/docx`).set("Authorization", `Bearer ${token}`).buffer(true).parse(binaire);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("wordprocessingml.document");
    expect(res.headers["content-disposition"]).toContain(".docx");
    const zip = await JSZip.loadAsync(res.body);
    const nomHeader = Object.keys(zip.files).find((n) => /^word\/header\d*\.xml$/.test(n));
    return {
      corps: await zip.file("word/document.xml").async("string"),
      entete: nomHeader ? await zip.file(nomHeader).async("string") : "",
      pied: await zip.file(Object.keys(zip.files).find((n) => /^word\/footer\d*\.xml$/.test(n))).async("string"),
    };
  }

  test("le .docx reprend le texte enregistré, avec intitulés centrés, puces, en-tête du cabinet et pied de page", async () => {
    const dossierId = await creerDossier(await creerClient());
    const gen = await request(app).post("/api/actes/generer").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const texte = "REQUETE AUX FINS D'ESSAI\nUn paragraphe ordinaire avec une apostrophe d'usage.\n\n• première demande\n- seconde demande\nPAR CES MOTIFS";
    const maj = await request(app).put(`/api/actes/${gen.body.id}`).set("Authorization", `Bearer ${token}`).send({ texte });
    expect(maj.status).toBe(200);
    const { corps, entete, pied } = await lireDocx(gen.body.id);
    expect(corps).toContain("REQUETE AUX FINS D");
    expect(corps).toContain("Un paragraphe ordinaire");
    expect(corps).toContain("première demande");
    expect(corps).toContain('w:val="center"');       // intitulé centré
    expect(corps).toContain("<w:numPr>");             // puces
    expect(entete).toContain("Barreau du Mali");      // forme du cabinet (paramètres)
    expect(pied).toContain("Réf. dossier");
  });

  test("GET /:id/docx : 404 sur un id inconnu et sur un document qui n'est pas un acte texte", async () => {
    const inconnu = await request(app).get("/api/actes/00000000-0000-0000-0000-000000000000/docx").set("Authorization", `Bearer ${token}`);
    expect(inconnu.status).toBe(404);
    const dossierId = await creerDossier(await creerClient());
    const { rows } = await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, taille_octets, auteur_id)
       VALUES ($1,'piece.pdf','piece_client','brouillon','file:///x','application/pdf',1,(SELECT id FROM utilisateurs WHERE email = $2))
       RETURNING id`,
      [dossierId, require("./setup").EMAIL_TEST]
    );
    const pdf = await request(app).get(`/api/actes/${rows[0].id}/docx`).set("Authorization", `Bearer ${token}`);
    expect(pdf.status).toBe(404);
  });

  test("pièces : liste saisie une fois, reprise dans l'exposé et le bordereau ; absence = [à compléter]", async () => {
    const dossierId = await creerDossier(await creerClient());
    await pool.query(
      "INSERT INTO modeles_actes (code, nom, corps) VALUES ('test_pieces','Test pièces',$1) ON CONFLICT (code) DO UPDATE SET corps = EXCLUDED.corps",
      ["{{pieces_liste}}\n---\n{{bordereau_pieces}}\n---\n{{pieces_nombre}}"]
    );
    const avec = await request(app).post("/api/actes/generer").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "test_pieces", pieces: ["Contrat de vente", "  Mise en demeure  ", ""] });
    expect(avec.status).toBe(201);
    expect(avec.body.texte).toContain("Pièce n° 1 : Contrat de vente\nPièce n° 2 : Mise en demeure");
    expect(avec.body.texte).toContain("BORDEREAU DES PIÈCES\n1. Contrat de vente\n2. Mise en demeure");
    expect(avec.body.texte.trim().endsWith("2")).toBe(true);
    const sans = await request(app).post("/api/actes/generer").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "test_pieces" });
    expect(sans.body.texte).toContain("[à compléter]");
    const trop = await request(app).post("/api/actes/generer").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "test_pieces", pieces: "pas une liste" });
    expect(trop.status).toBe(400);
  });
});

// 03/10/2026 — audit Atelier d'actes : GET /:id/pdf, PUT /:id et POST
// /:id/statut ignoraient documents.confidentialite (mécanisme posé le
// 28/09/2026 pour /api/documents/:id/download) — n'importe quel titulaire
// de actes.consulter/actes.generer (très largement accordés) pouvait donc
// lire/modifier/changer le statut de n'importe quel document texte brut,
// y compris un .txt téléversé en confidentialite='restreint'. Corrigé en
// y branchant le même contrôle (confidentialiteDocuments.js).
describe("Confidentialité des documents appliquée à l'Atelier d'actes (03/10/2026)", () => {
  async function creerActeRestreint() {
    // responsable = l'associé lui-même (token principal) : évite tout souci
    // d'imputation (verifierImputationResponsable), pas l'objet du test ici.
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const gen = await request(app)
      .post("/api/actes/generer")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, mode: "modele", modele_code: "autre" });
    const docId = gen.body.id;
    const maj = await request(app)
      .put(`/api/documents/${docId}/confidentialite`)
      .set("Authorization", `Bearer ${token}`)
      .send({ confidentialite: "restreint" });
    expect(maj.status).toBe(200);
    return docId;
  }

  test("GET /:id/pdf refusé (403) à un tiers non affecté au dossier", async () => {
    const docId = await creerActeRestreint();
    const tiers = await creerUtilisateur("juriste");
    const res = await request(app).get(`/api/actes/${docId}/pdf`).set("Authorization", `Bearer ${tiers.token}`);
    expect(res.status).toBe(403);
  });

  test("GET /:id/pdf reste accessible au responsable (direction)", async () => {
    const docId = await creerActeRestreint();
    const res = await request(app).get(`/api/actes/${docId}/pdf`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  test("GET /:id/docx refusé (403) à un tiers non affecté au dossier, accessible au responsable", async () => {
    const docId = await creerActeRestreint();
    const tiers = await creerUtilisateur("juriste");
    const refus = await request(app).get(`/api/actes/${docId}/docx`).set("Authorization", `Bearer ${tiers.token}`);
    expect(refus.status).toBe(403);
    const ok = await request(app).get(`/api/actes/${docId}/docx`).set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
  });

  test("PUT /:id refusé (403) à un tiers non affecté au dossier", async () => {
    const docId = await creerActeRestreint();
    const tiers = await creerUtilisateur("juriste");
    const res = await request(app)
      .put(`/api/actes/${docId}`)
      .set("Authorization", `Bearer ${tiers.token}`)
      .send({ texte: "Tentative non autorisée" });
    expect(res.status).toBe(403);
  });

  test("POST /:id/statut refusé (403) à un tiers non affecté au dossier", async () => {
    const docId = await creerActeRestreint();
    const tiers = await creerUtilisateur("juriste");
    const res = await request(app)
      .post(`/api/actes/${docId}/statut`)
      .set("Authorization", `Bearer ${tiers.token}`)
      .send({ statut: "valide" });
    expect(res.status).toBe(403);
  });
});
