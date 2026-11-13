// JURIA — Générateur de courriers, lot 3 (05/11/2026) : API de rédaction — référence, registre, versions, états.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId;
const VALEURS = { destinataire: "Monsieur le Directeur\nde la BDM SA", objet: "Constitution aux fins de recouvrement", paragraphes: "Premier paragraphe.\n\nSecond paragraphe." };

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

const auth = (r, t = token) => r.set("Authorization", "Bearer " + t);
const rediger = (corps = {}, t = token) => auth(request(app).post("/api/courriers/rediger"), t)
  .send({ gabarit: "standard", valeurs: VALEURS, signataire_id: associeId, ...corps });

async function utilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const { rows } = await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) VALUES ($1,'Test','Lot3',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id",
    ["L3" + suffixe.slice(0, 6), "test.lot3." + suffixe + "@jfcavocats-mali.com", await bcrypt.hash("x-Lot3-123!", 4), role]);
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Lot3" }, SECRET, { expiresIn: "1h" }) };
}

describe("Création : référence, registre, version 1", () => {
  test("gabarits disponibles", async () => {
    const r = await auth(request(app).get("/api/courriers/gabarits"));
    expect(r.status).toBe(200);
    expect(r.body.map((g) => g.code)).toEqual(expect.arrayContaining(["constitution", "standard", "constitution_appel", "constitution_renvoi", "declaration_appel", "reponse_sommation"]));
  });

  test("courrier général sans dossier : référence DEP, inscrit au registre en brouillon, version 1", async () => {
    const r = await rediger();
    expect(r.status).toBe(201);
    expect(r.body.courrier.reference).toMatch(/^DEP-\d{4}-\d{6}$/);
    expect(r.body.courrier.etat_redaction).toBe("brouillon");
    expect(r.body.courrier.dossier_id).toBeNull();
    expect(r.body.courrier.correspondant).toBe("Monsieur le Directeur, de la BDM SA");
    expect(r.body.version.numero).toBe(1);
    const liste = (await auth(request(app).get("/api/courriers?sens=depart"))).body;
    const ligne = liste.find((c) => c.id === r.body.courrier.id);
    expect(ligne.etat_redaction).toBe("brouillon");
    expect(ligne.gabarit_code).toBe("standard");
  });

  test("avec dossier : rattaché ; dossier inconnu refusé", async () => {
    const client = await auth(request(app).post("/api/clients")).send({ type: "morale", denomination: "Client lot3 " + Date.now() });
    const dossier = await auth(request(app).post("/api/dossiers")).send({
      client_id: client.body.id, intitule: "Dossier lot3", pole: "contentieux", matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: associeId });
    const r = await rediger({ dossier_id: dossier.body.id });
    expect(r.status).toBe(201);
    expect(r.body.courrier.dossier_id).toBe(dossier.body.id);
    expect((await rediger({ dossier_id: "00000000-0000-4000-8000-000000000000" })).status).toBe(400);
  });

  test("lecture : contenu, options par défaut, version téléchargeable en PDF et en Word", async () => {
    const c = (await rediger()).body.courrier;
    const l = await auth(request(app).get("/api/courriers/" + c.id + "/redaction"));
    expect(l.status).toBe(200);
    expect(l.body.etat_redaction).toBe("brouillon");
    expect(l.body.options_redaction.sortie).toBe("A");
    expect(l.body.contenu.paragraphes).toHaveLength(2);
    expect(l.body.versions).toHaveLength(1);
    const pdf = await auth(request(app).get("/api/courriers/" + c.id + "/versions/1/pdf")).buffer(true).parse((res, cb) => { const d = []; res.on("data", (x) => d.push(x)); res.on("end", () => cb(null, Buffer.concat(d))); });
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");
    const docx = await auth(request(app).get("/api/courriers/" + c.id + "/versions/1/docx")).buffer(true).parse((res, cb) => { const d = []; res.on("data", (x) => d.push(x)); res.on("end", () => cb(null, Buffer.concat(d))); });
    expect(docx.body.slice(0, 2).toString()).toBe("PK");
    expect((await auth(request(app).get("/api/courriers/" + c.id + "/versions/9/pdf"))).status).toBe(404);
  });

  test("contenu invalide, gabarit inconnu, signataire non habilité : 400 détaillé, aucun numéro consommé", async () => {
    const avant = (await rediger()).body.courrier.reference;
    const vide = await rediger({ valeurs: {} });
    expect(vide.status).toBe(400);
    expect(vide.body.erreurs.map((e) => e.cle).sort()).toEqual(["destinataire", "objet", "paragraphes"]);
    expect((await rediger({ gabarit: "inconnu" })).status).toBe(400);
    const collab = await utilisateurRole("collaborateur");
    const non = await rediger({ signataire_id: collab.id });
    expect(non.status).toBe(400);
    expect(non.body.error).toMatch(/habilité/);
    const apres = (await rediger()).body.courrier.reference;
    expect(Number(apres.slice(-6))).toBe(Number(avant.slice(-6)) + 1);
  });

  test("créations simultanées : des références toutes différentes", async () => {
    const reps = await Promise.all([1, 2, 3, 4, 5].map(() => rediger()));
    reps.forEach((r) => expect(r.status).toBe(201));
    expect(new Set(reps.map((r) => r.body.courrier.reference)).size).toBe(5);
  });
});

describe("Versions, états et verrouillage", () => {
  test("modification = nouvelle version ; l'ancienne reste ; la référence ne change pas", async () => {
    const c = (await rediger()).body.courrier;
    const m = await auth(request(app).put("/api/courriers/" + c.id + "/contenu")).send({ valeurs: { ...VALEURS, objet: "Objet corrigé" }, sortie: "B" });
    expect(m.status).toBe(200);
    expect(m.body.version.numero).toBe(2);
    const l = (await auth(request(app).get("/api/courriers/" + c.id + "/redaction"))).body;
    expect(l.versions.map((v) => v.numero)).toEqual([1, 2]);
    expect(l.contenu.objet).toBe("Objet corrigé");
    expect(l.options_redaction.sortie).toBe("B");
    expect(l.reference).toBe(c.reference);
    expect((await auth(request(app).get("/api/courriers/" + c.id + "/versions/1/pdf"))).status).toBe(200);
    const liste = (await auth(request(app).get("/api/courriers?sens=depart"))).body;
    expect(liste.find((x) => x.id === c.id).objet).toBe("Objet corrigé");
  });

  test("à signer : plus de modification ; retour en brouillon puis modification possible", async () => {
    const c = (await rediger()).body.courrier;
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/soumettre-signature"))).body.etat_redaction).toBe("a_signer");
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/soumettre-signature"))).status).toBe(409);
    expect((await auth(request(app).put("/api/courriers/" + c.id + "/contenu")).send({ valeurs: VALEURS })).status).toBe(409);
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/retour-brouillon"))).body.etat_redaction).toBe("brouillon");
    expect((await auth(request(app).put("/api/courriers/" + c.id + "/contenu")).send({ valeurs: VALEURS })).status).toBe(200);
  });

  test("lettre signée : modification, soumission et annulation refusées", async () => {
    const c = (await rediger()).body.courrier;
    await pool.query("UPDATE courriers SET etat_redaction = 'signee', signee_le = now() WHERE id = $1::uuid", [c.id]);
    expect((await auth(request(app).put("/api/courriers/" + c.id + "/contenu")).send({ valeurs: VALEURS })).status).toBe(409);
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/soumettre-signature"))).status).toBe(409);
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/annuler-numero")).send({ motif: "x" })).status).toBe(409);
  });

  test("brouillon annulé : la référence reste au registre, plus de modification", async () => {
    const c = (await rediger()).body.courrier;
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/annuler-numero")).send({ motif: "Lettre abandonnée" })).status).toBe(200);
    const m = await auth(request(app).put("/api/courriers/" + c.id + "/contenu")).send({ valeurs: VALEURS });
    expect(m.status).toBe(409);
    expect(m.body.error).toMatch(/annulé/);
    const ligne = (await auth(request(app).get("/api/courriers?sens=depart"))).body.find((x) => x.id === c.id);
    expect(ligne.annule_le).toBeTruthy();
  });

  test("un courrier ordinaire (non rédigé dans JURIA) n'a pas de rédaction", async () => {
    const o = await auth(request(app).post("/api/courriers")).send({ sens: "depart", type: "lettre", correspondant: "Tribunal" });
    expect((await auth(request(app).get("/api/courriers/" + o.body.id + "/redaction"))).status).toBe(404);
    expect((await auth(request(app).put("/api/courriers/" + o.body.id + "/contenu")).send({ valeurs: VALEURS })).status).toBe(409);
  });

  test("un autre utilisateur autorisé à écrire peut préparer (assistante) ; le signataire peut renvoyer en brouillon", async () => {
    const assistante = await utilisateurRole("assistante");
    const c = await rediger({}, assistante.token);
    expect(c.status).toBe(201);
    const id = c.body.courrier.id;
    expect((await auth(request(app).post("/api/courriers/" + id + "/soumettre-signature"), assistante.token)).status).toBe(200);
    // l'associé désigné (signataire) renvoie la lettre en brouillon
    expect((await auth(request(app).post("/api/courriers/" + id + "/retour-brouillon"))).body.etat_redaction).toBe("brouillon");
  });
});
