// JURIA — Générateur de courriers, lot 5 (05/11/2026) : signature — apposition du cachet et de la signature, PDF figé, traçabilité.
const zlib = require("zlib");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const R = require("../src/courrier/reglages");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let tokenAuteur, auteurId, signataire;
const VALEURS = { destinataire: "Monsieur le Directeur\nde la BDM SA", objet: "Constitution", paragraphes: "Premier paragraphe.\n\nSecond paragraphe." };

function png(largeur, hauteur) {
  const brut = Buffer.alloc((largeur * 4 + 1) * hauteur);
  for (let y = 0; y < hauteur; y += 1) for (let x = 0; x < largeur; x += 1) { const i = y * (largeur * 4 + 1) + 1 + x * 4; brut[i] = 30; brut[i + 1] = 40; brut[i + 2] = 155; brut[i + 3] = 255; }
  const bloc = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "latin1");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc("IHDR", ihdr), bloc("IDAT", zlib.deflateSync(brut)), bloc("IEND", Buffer.alloc(0))]);
}

async function creerUtilisateur(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const { rows } = await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) VALUES ($1,'Test','Lot5',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id",
    ["L5" + suffixe.slice(0, 6), "test.lot5." + suffixe + "@jfcavocats-mali.com", await bcrypt.hash("x-Lot5-123!", 4), role]);
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Lot5" }, SECRET, { expiresIn: "1h" }) };
}
const auth = (r, t) => r.set("Authorization", "Bearer " + t);
const binaire = (res, cb) => { const d = []; res.on("data", (x) => d.push(x)); res.on("end", () => cb(null, Buffer.concat(d))); };

// Lettre à signer par `signataire`, rédigée par l'auteur
async function lettreASigner(corps = {}) {
  const r = await auth(request(app).post("/api/courriers/rediger"), tokenAuteur).send({ gabarit: "standard", valeurs: VALEURS, signataire_id: signataire.id, sortie: "B", ...corps });
  expect(r.status).toBe(201);
  const id = r.body.courrier.id;
  expect((await auth(request(app).post("/api/courriers/" + id + "/soumettre-signature"), tokenAuteur)).status).toBe(200);
  return id;
}

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  tokenAuteur = login.body.token; auteurId = login.body.utilisateur.id;
  signataire = await creerUtilisateur("associe");
  await R.deposerCachet(png(60, 30));
  await R.deposerSignature(signataire.id, png(50, 25));
});
afterAll(async () => {
  await pool.query("UPDATE parametres_cabinet SET courrier_cachet_chemin = NULL, courrier_cachet_maj_le = NULL WHERE id = 1");
  await pool.end();
});

describe("Aperçu et réglages d'apposition", () => {
  test("le signataire voit le mode, ses réglages mémorisés et l'état des images ; l'aperçu porte un filigrane et n'enregistre rien", async () => {
    const id = await lettreASigner();
    const info = await auth(request(app).get("/api/courriers/" + id + "/apposition"), signataire.token);
    expect(info.status).toBe(200);
    expect(info.body).toMatchObject({ mode: "image", peut_signer: true, cachet_present: true, signature_presente: true, etat_redaction: "a_signer" });
    expect(info.body.defauts).toEqual({ ens: 1, ts: 1, ox: 0, oy: 0 });
    const ap = await auth(request(app).post("/api/courriers/" + id + "/apposition/apercu"), signataire.token).send({ ens: 1.1 }).buffer(true).parse(binaire);
    expect(ap.status).toBe(200);
    expect(ap.body.slice(0, 4).toString()).toBe("%PDF");
    const c = (await pool.query("SELECT etat_redaction, pdf_signe_chemin FROM courriers WHERE id = $1::uuid", [id])).rows[0];
    expect(c.etat_redaction).toBe("a_signer");
    expect(c.pdf_signe_chemin).toBeNull();
  });

  test("sans courriers.signer : accès refusé", async () => {
    const id = await lettreASigner();
    const assistante = await creerUtilisateur("assistante");
    expect((await auth(request(app).get("/api/courriers/" + id + "/apposition"), assistante.token)).status).toBe(403);
    expect((await auth(request(app).post("/api/courriers/" + id + "/signer"), assistante.token).send({ confirmer: true })).status).toBe(403);
  });
});

describe("Signature : conditions", () => {
  test("refusée : pas le signataire désigné, lettre en brouillon, confirmation absente, réglage hors bornes", async () => {
    const id = await lettreASigner();
    expect((await auth(request(app).post("/api/courriers/" + id + "/signer"), tokenAuteur).send({ confirmer: true })).status).toBe(403);
    expect((await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({})).status).toBe(400);
    expect((await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({ confirmer: true, ens: 2 })).status).toBe(400);
    const r = await auth(request(app).post("/api/courriers/rediger"), tokenAuteur).send({ gabarit: "standard", valeurs: VALEURS, signataire_id: signataire.id, sortie: "B" });
    const brouillon = await auth(request(app).post("/api/courriers/" + r.body.courrier.id + "/signer"), signataire.token).send({ confirmer: true });
    expect(brouillon.status).toBe(409);
  });

  test("sans cachet ou sans signature déposés : 409 explicite", async () => {
    const id = await lettreASigner();
    await pool.query("UPDATE parametres_cabinet SET courrier_cachet_chemin = NULL WHERE id = 1");
    const r = await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({ confirmer: true });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/Cachet ou signature/);
    await R.deposerCachet(png(60, 30));
    expect((await pool.query("SELECT etat_redaction FROM courriers WHERE id = $1::uuid", [id])).rows[0].etat_redaction).toBe("a_signer");
  });
});

describe("Signature : sortie B (cachet + signature)", () => {
  test("PDF figé : empreinte tracée, pièce rattachée au courrier, réglages mémorisés, plus aucune modification", async () => {
    const id = await lettreASigner();
    const s = await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({ confirmer: true, ens: 1.1, ts: 0.9, ox: 5, oy: -3 });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ etat_redaction: "signee", mode: "image", pdf_signe: true });
    expect(s.body.empreinte).toMatch(/^[0-9a-f]{64}$/);
    const pdf = await auth(request(app).get("/api/courriers/" + id + "/pdf-signe"), tokenAuteur).buffer(true).parse(binaire);
    expect(pdf.status).toBe(200);
    expect(pdf.body.slice(0, 4).toString()).toBe("%PDF");
    expect(crypto.createHash("sha256").update(pdf.body).digest("hex")).toBe(s.body.empreinte);
    const c = (await pool.query("SELECT etat_redaction, signee_par, signee_le, apposition, fichier_brut_nom, numerise, document_id FROM courriers WHERE id = $1::uuid", [id])).rows[0];
    expect(c.etat_redaction).toBe("signee");
    expect(c.signee_par).toBe(signataire.id);
    expect(c.signee_le).toBeTruthy();
    expect(c.apposition).toMatchObject({ mode: "image", empreinte: s.body.empreinte, ens: 1.1, ts: 0.9, ox: 5, oy: -3 });
    expect(c.fichier_brut_nom).toMatch(/-signe\.pdf$/);
    expect(c.numerise).toBe(true);
    expect(c.document_id).toBeNull();
    const memo = (await pool.query("SELECT apposition_defaut FROM utilisateurs WHERE id = $1::uuid", [signataire.id])).rows[0].apposition_defaut;
    expect(memo).toEqual({ ens: 1.1, ts: 0.9, ox: 5, oy: -3 });
    expect((await auth(request(app).put("/api/courriers/" + id + "/contenu"), tokenAuteur).send({ valeurs: VALEURS })).status).toBe(409);
    expect((await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({ confirmer: true })).status).toBe(409);
    expect((await auth(request(app).post("/api/courriers/" + id + "/annuler-numero"), tokenAuteur).send({ motif: "x" })).status).toBe(409);
    expect((await auth(request(app).post("/api/courriers/" + id + "/retour-brouillon"), tokenAuteur)).status).toBe(409);
  });

  test("avec dossier : la pièce signée entre dans la GED du dossier (catégorie correspondance)", async () => {
    const client = await auth(request(app).post("/api/clients"), tokenAuteur).send({ type: "morale", denomination: "Client lot5 " + Date.now() });
    const dossier = await auth(request(app).post("/api/dossiers"), tokenAuteur).send({
      client_id: client.body.id, intitule: "Dossier lot5", pole: "contentieux", matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: auteurId });
    const id = await lettreASigner({ dossier_id: dossier.body.id });
    const s = await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({ confirmer: true });
    expect(s.status).toBe(200);
    const c = (await pool.query("SELECT document_id, fichier_brut_nom FROM courriers WHERE id = $1::uuid", [id])).rows[0];
    expect(c.document_id).toBeTruthy();
    expect(c.fichier_brut_nom).toBeNull();
    const d = (await pool.query("SELECT categorie, type_mime, dossier_id FROM documents WHERE id = $1::uuid", [c.document_id])).rows[0];
    expect(d).toMatchObject({ categorie: "correspondance", type_mime: "application/pdf", dossier_id: dossier.body.id });
  });

  test("aucune route ne renvoie le cachet ni la signature", async () => {
    const id = await lettreASigner();
    const info = await auth(request(app).get("/api/courriers/" + id + "/apposition"), signataire.token);
    expect(JSON.stringify(info.body)).not.toContain("courrier/prive");
    const reglages = await auth(request(app).get("/api/courrier-reglages"), tokenAuteur);
    expect(JSON.stringify(reglages.body)).not.toContain("courrier/prive");
  });
});

describe("Signature : sortie A (papier à en-tête)", () => {
  test("signature manuscrite : enregistrée sans image ni PDF signé ; la copie signée se joint ensuite", async () => {
    const id = await lettreASigner({ sortie: "A" });
    const info = await auth(request(app).get("/api/courriers/" + id + "/apposition"), signataire.token);
    expect(info.body.mode).toBe("manuscrite");
    expect((await auth(request(app).post("/api/courriers/" + id + "/apposition/apercu"), signataire.token).send({})).status).toBe(409);
    const s = await auth(request(app).post("/api/courriers/" + id + "/signer"), signataire.token).send({ confirmer: true });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ etat_redaction: "signee", mode: "manuscrite", pdf_signe: false, empreinte: null });
    expect((await auth(request(app).get("/api/courriers/" + id + "/pdf-signe"), tokenAuteur)).status).toBe(404);
    const c = (await pool.query("SELECT apposition, fichier_brut_nom FROM courriers WHERE id = $1::uuid", [id])).rows[0];
    expect(c.apposition.mode).toBe("manuscrite");
    expect(c.fichier_brut_nom).toBeNull();
  });
});
