// JURIA — tests ciblés sur l'ajout du 21/08/2026 (demande utilisateur :
// aperçu de fichier sans ouverture classique) : client_pieces_kyc n'avait
// jamais capturé le type MIME du fichier téléversé (contrairement à
// documents/ressources_biblio), empêchant la route de téléchargement de
// fixer un Content-Type correct — condition nécessaire à un aperçu fiable
// côté écran (le composant de prévisualisation détecte d'abord le format
// via le Content-Type réel du blob téléchargé, l'extension du nom de
// fichier n'étant qu'un repli).
const fs = require("fs");
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});

// Chemin local réel (repli disque en environnement de test, pas de
// GED_BUCKET) — permet de vérifier que le FICHIER a bien disparu, pas
// seulement la ligne en base.
function cheminLocal(cheminStorage) {
  return cheminStorage.replace("file://", "");
}

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

  // Gap comblé le 28/08/2026, suite au même correctif sur documents.js
  // (constat utilisateur) : la suppression n'effaçait jamais le fichier
  // physique, laissant un objet orphelin dans le stockage.
  test("la suppression d'une pièce KYC efface aussi le fichier physique", async () => {
    const clientId = await creerClient();
    const ajout = await request(app)
      .post(`/api/clients/${clientId}/kyc-pieces`)
      .set("Authorization", `Bearer ${token}`)
      .field("libelle", "Passeport à supprimer")
      .attach("fichier", Buffer.from("contenu"), { filename: "passeport.pdf", contentType: "application/pdf" });
    expect(ajout.status).toBe(201);

    const { rows } = await pool.query("SELECT chemin_storage FROM client_pieces_kyc WHERE id = $1", [ajout.body.id]);
    const chemin = cheminLocal(rows[0].chemin_storage);
    expect(fs.existsSync(chemin)).toBe(true);

    const suppr = await request(app)
      .delete(`/api/clients/${clientId}/kyc-pieces/${ajout.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(204);
    expect(fs.existsSync(chemin)).toBe(false);
  });
});

describe("Bibliothèque — suppression nettoie aussi le fichier physique (28/08/2026)", () => {
  test("DELETE /api/biblio/:id efface la ligne ET le fichier", async () => {
    const ajout = await request(app)
      .post("/api/biblio")
      .set("Authorization", `Bearer ${token}`)
      .field("type", "modele")
      .field("titre", `Modèle test suppression ${Date.now()}`)
      .attach("fichier", Buffer.from("contenu"), { filename: "modele.txt", contentType: "text/plain" });
    expect(ajout.status).toBe(201);

    const { rows } = await pool.query("SELECT chemin_storage FROM ressources_biblio WHERE id = $1", [ajout.body.id]);
    const chemin = cheminLocal(rows[0].chemin_storage);
    expect(fs.existsSync(chemin)).toBe(true);

    const suppr = await request(app)
      .delete(`/api/biblio/${ajout.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(204);
    expect(fs.existsSync(chemin)).toBe(false);
  });
});
