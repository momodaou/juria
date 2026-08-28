// JURIA — diagnostic « l'aperçu GED ne fonctionne pas » (28/08/2026).
// Cas réel rencontré en production : des documents déposés avant le
// correctif GED du 21/08/2026 (GED_BUCKET absent, fichiers écrits sur le
// disque éphémère du conteneur) ont leur fichier physique définitivement
// perdu depuis, mais leur ligne `documents`/`client_pieces_kyc`/
// `ressources_biblio` existe toujours en base — le téléchargement
// renvoyait un 500 « Erreur serveur » générique, indiscernable d'une
// vraie panne. Corrigé : storage.js distingue ce cas (FichierIntrouvableError)
// et les 3 routes de téléchargement renvoient un 404 explicite.
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

async function creerDossier() {
  const client = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client GED perdu ${Date.now()}-${Math.random()}` });
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  const userId = login.body.utilisateur.id;
  const dossier = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `GED-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test fichier perdu",
      client_id: client.body.id,
      pole: "contentieux",
      responsable_id: userId,
    });
  return dossier.body.id;
}

test("un document dont le fichier physique a disparu renvoie 404 explicite, pas 500", async () => {
  const dossierId = await creerDossier();
  const upload = await request(app)
    .post("/api/documents")
    .set("Authorization", `Bearer ${token}`)
    .field("dossier_id", dossierId)
    .attach("fichier", Buffer.from("contenu"), { filename: "piece.txt", contentType: "text/plain" });
  expect(upload.status).toBe(201);

  // Fichier réellement téléchargeable juste après l'upload.
  const ok = await request(app)
    .get(`/api/documents/${upload.body.id}/download`)
    .set("Authorization", `Bearer ${token}`);
  expect(ok.status).toBe(200);

  // Simule la perte du fichier physique (redéploiement avant le correctif
  // GED_BUCKET, ou tout autre incident de stockage) : la ligne reste en
  // base, seul l'objet a disparu.
  await pool.query(
    "UPDATE documents SET chemin_storage = 'file:///chemin/qui/n/existe/plus.txt' WHERE id = $1",
    [upload.body.id]
  );

  const perdu = await request(app)
    .get(`/api/documents/${upload.body.id}/download`)
    .set("Authorization", `Bearer ${token}`);
  expect(perdu.status).toBe(404);
  expect(perdu.body.error).toMatch(/introuvable/i);
});
