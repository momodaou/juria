// JURIA — tests ciblés sur l'ajout du 21/08/2026 (demande utilisateur :
// aperçu de fichier sans ouverture classique) : client_pieces_kyc n'avait
// jamais capturé le type MIME du fichier téléversé (contrairement à
// documents/ressources_biblio), empêchant la route de téléchargement de
// fixer un Content-Type correct — condition nécessaire à un aperçu fiable
// côté écran (le composant de prévisualisation détecte d'abord le format
// via le Content-Type réel du blob téléchargé, l'extension du nom de
// fichier n'étant qu'un repli).
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

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client aperçu ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

describe("Pièces KYC — type MIME capturé à l'upload, restitué au téléchargement", () => {
  test("POST avec fichier PDF → GET download renvoie Content-Type: application/pdf", async () => {
    const clientId = await creerClient();
    // Un vrai en-tête PDF minimal suffit : la route ne valide pas le
    // contenu, seul filtreTypeFichier (extension/mimetype déclarés) filtre.
    const contenu = Buffer.from("%PDF-1.4\n%%EOF");

    const ajout = await request(app)
      .post(`/api/clients/${clientId}/kyc-pieces`)
      .set("Authorization", `Bearer ${token}`)
      .field("libelle", "Passeport")
      .attach("fichier", contenu, { filename: "passeport.pdf", contentType: "application/pdf" });
    expect(ajout.status).toBe(201);

    const dl = await request(app)
      .get(`/api/clients/${clientId}/kyc-pieces/${ajout.body.id}/download`)
      .set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-type"]).toMatch(/application\/pdf/);
  });

  test("une pièce sans fichier (chemin_storage NULL) renvoie 404 au téléchargement, pas une erreur serveur", async () => {
    const clientId = await creerClient();
    const ajout = await request(app)
      .post(`/api/clients/${clientId}/kyc-pieces`)
      .set("Authorization", `Bearer ${token}`)
      .field("libelle", "Pièce à venir");
    expect(ajout.status).toBe(201);

    const dl = await request(app)
      .get(`/api/clients/${clientId}/kyc-pieces/${ajout.body.id}/download`)
      .set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(404);
  });
});
