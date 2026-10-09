// JURIA — 🔴 bug critique trouvé le 09/10/2026 (constat utilisateur :
// « lettre d'engagement n'est pas visible ni en aperçu ni n'a l'action
// télécharger ») : `Content-Disposition: attachment; filename="${nom}"`
// avec un nom contenant un caractère non-ASCII (tiret cadratin, apostrophe
// typographique, accent…) fait planter Node en 500 (ERR_INVALID_CHAR)
// AVANT d'envoyer le fichier — touchait potentiellement tout document/
// pièce/ressource au nom français « normal », dont la lettre de mission
// auto-générée (Bloc A, 18/09/2026), nommée « Lettre de mission /
// d'engagement — <numéro de dossier> ». Corrigé via enteteContentDisposition()
// (storage.js, RFC 5987) sur les 4 points d'émission concernés.
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

async function creerClientEtDossier(modeHonoraires = "forfait") {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client CD ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test Content-Disposition", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: modeHonoraires, urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("Téléchargement d'un document au nom accentué/typographique — ne doit jamais renvoyer 500", () => {
  test("lettre de mission auto-générée (nom avec tiret cadratin) se télécharge en 200", async () => {
    const dossierId = await creerClientEtDossier("forfait");
    const fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    const lettreId = fiche.body.lettre_mission_document_id;
    expect(lettreId).toBeTruthy();

    const dl = await request(app).get(`/api/documents/${lettreId}/download`).set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toMatch(/^attachment; filename="[\x20-\x7E]*"; filename\*=UTF-8''/);
  });

  test("document GED téléversé avec un nom accentué/apostrophe se télécharge en 200", async () => {
    const dossierId = await creerClientEtDossier("forfait");
    const nom = "Conclusions récapitulatives — l'affaire Société Générale.txt";
    const upload = await request(app).post("/api/documents").set("Authorization", `Bearer ${token}`)
      .field("dossier_id", dossierId).field("nom", nom)
      .attach("fichier", Buffer.from("contenu"), { filename: "scan.txt", contentType: "text/plain" });
    expect(upload.status).toBe(201);

    const dl = await request(app).get(`/api/documents/${upload.body.id}/download`).set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(dl.headers["content-disposition"].split("filename*=UTF-8''")[1])).toBe(nom);
  });

  test("pièce KYC au libellé accentué se télécharge en 200", async () => {
    const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination: `Client KYC CD ${Date.now()}` });
    const libelle = "Pièce d'identité — carte nationale (vérifiée)";
    const piece = await request(app).post(`/api/clients/${client.body.id}/kyc-pieces`).set("Authorization", `Bearer ${token}`)
      .field("libelle", libelle)
      .attach("fichier", Buffer.from("contenu"), { filename: "piece.txt", contentType: "text/plain" });
    expect(piece.status).toBe(201);

    const dl = await request(app).get(`/api/clients/${client.body.id}/kyc-pieces/${piece.body.id}/download`)
      .set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''");
  });

  test("ressource de bibliothèque au titre accentué se télécharge en 200", async () => {
    const titre = "Étude comparée — droit des sûretés OHADA";
    const res = await request(app).post("/api/biblio").set("Authorization", `Bearer ${token}`)
      .field("type", "modele").field("titre", titre)
      .attach("fichier", Buffer.from("contenu"), { filename: "ressource.txt", contentType: "text/plain" });
    expect(res.status).toBe(201);

    const dl = await request(app).get(`/api/biblio/${res.body.id}/fichier`).set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("filename*=UTF-8''");
  });
});
