// JURIA — 28/09/2026 : `documents.confidentialite` (ENUM présent dans le
// schéma depuis le premier jour) était posée à la création mais ne
// filtrait jamais rien — trouvé lors de l'audit systématique des routes GET
// du 28/09/2026. Câblée pour de vrai (voir backend/src/confidentialiteDocuments.js) :
// - 'dossier' (défaut) : tout le cabinet, y compris l'aperçu Portail client.
// - 'interne' : tout le cabinet, jamais dans l'aperçu Portail client.
// - 'equipe' : responsable + intervenants + direction uniquement.
// - 'restreint' : responsable + direction uniquement (pas les intervenants simples).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { pool } = require("./setup");

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestConfidoc123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Confidoc',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`X${suffixe.slice(0, 7)}`, `test.confidoc.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Confidoc" }, SECRET, { expiresIn: "1h" }) };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function creerClient(t) {
  const res = await request(app).post("/api/clients").set(auth(t))
    .send({ type: "morale", denomination: `Client Confidoc ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

// Création par un ASSOCIÉ (createurToken) — un collaborateur ne peut pas se
// désigner lui-même responsable (règle du 30/08/2026, verifierImputationResponsable) ;
// responsable_id peut être n'importe quel avocat, intervenant optionnel.
async function creerDossier(createurToken, responsableId, intervenantId) {
  const clientId = await creerClient(createurToken);
  const res = await request(app).post("/api/dossiers").set(auth(createurToken))
    .send({
      intitule: "Dossier Confidoc", client_id: clientId, pole: "conseil",
      responsable_id: responsableId, mode_honoraires: "forfait",
      intervenants: intervenantId ? [{ utilisateur_id: intervenantId }] : [],
    });
  if (res.status !== 201) throw new Error(`Création dossier échouée (${res.status}): ${JSON.stringify(res.body)}`);
  return res.body.id;
}

async function televerser(t, dossierId, confidentialite) {
  const res = await request(app).post("/api/documents").set(auth(t))
    .field("dossier_id", dossierId)
    .field("confidentialite", confidentialite)
    .attach("fichier", Buffer.from("contenu"), { filename: "piece.txt", contentType: "text/plain" });
  return res.body.id;
}

describe("Confidentialité des documents (28/09/2026)", () => {
  // ⚠️ Un dossier a déjà 1 document dès sa création (lettre de mission
  // auto-générée, niveau 'dossier' par défaut — Discipline de facturation
  // Bloc A, 18/09/2026) — on vérifie donc la présence/absence du document
  // uploadé PAR SON ID plutôt qu'un total de la liste (déjà le patron
  // utilisé par les tests 'equipe'/'restreint' ci-dessous).
  test("niveau 'dossier' (défaut) : visible à tout le cabinet et dans l'aperçu Portail client", async () => {
    const createur = await creerUtilisateurRole("associe");
    const responsable = await creerUtilisateurRole("collaborateur");
    const dossierId = await creerDossier(createur.token, responsable.id);
    const docId = await televerser(responsable.token, dossierId, "dossier");

    const tiers = await creerUtilisateurRole("juriste");
    const liste = await request(app).get(`/api/dossiers/${dossierId}/documents`).set(auth(tiers.token));
    expect(liste.body.some((d) => d.id === docId)).toBe(true);

    const vueClient = await request(app).get(`/api/dossiers/${dossierId}/documents?vue=client`).set(auth(tiers.token));
    expect(vueClient.body.some((d) => d.id === docId)).toBe(true);
  });

  test("niveau 'interne' : visible en interne à tout le cabinet, jamais dans l'aperçu Portail client", async () => {
    const createur = await creerUtilisateurRole("associe");
    const responsable = await creerUtilisateurRole("collaborateur");
    const dossierId = await creerDossier(createur.token, responsable.id);
    const docId = await televerser(responsable.token, dossierId, "interne");

    const tiers = await creerUtilisateurRole("juriste");
    const liste = await request(app).get(`/api/dossiers/${dossierId}/documents`).set(auth(tiers.token));
    expect(liste.body.some((d) => d.id === docId)).toBe(true);

    const vueClient = await request(app).get(`/api/dossiers/${dossierId}/documents?vue=client`).set(auth(tiers.token));
    expect(vueClient.body.some((d) => d.id === docId)).toBe(false);
  });

  test("niveau 'equipe' : responsable, intervenant et direction voient le document ; un collègue non affecté ne le voit pas", async () => {
    const responsable = await creerUtilisateurRole("collaborateur");
    const intervenant = await creerUtilisateurRole("juriste");
    const tiers = await creerUtilisateurRole("juriste");
    const associe = await creerUtilisateurRole("associe");
    const dossierId = await creerDossier(associe.token, responsable.id, intervenant.id);
    const docId = await televerser(responsable.token, dossierId, "equipe");

    for (const [nom, u, attendu] of [
      ["responsable", responsable, true], ["intervenant", intervenant, true],
      ["direction", associe, true], ["tiers", tiers, false],
    ]) {
      const liste = await request(app).get(`/api/dossiers/${dossierId}/documents`).set(auth(u.token));
      expect(liste.body.some((d) => d.id === docId)).toBe(attendu);
    }

    // Défense en profondeur : le téléchargement direct par id applique la même règle.
    const dlTiers = await request(app).get(`/api/documents/${docId}/download`).set(auth(tiers.token));
    expect(dlTiers.status).toBe(403);
    const dlResponsable = await request(app).get(`/api/documents/${docId}/download`).set(auth(responsable.token));
    expect(dlResponsable.status).toBe(200);
  });

  test("niveau 'restreint' : responsable et direction voient le document ; un simple intervenant ne le voit pas", async () => {
    const responsable = await creerUtilisateurRole("collaborateur");
    const intervenant = await creerUtilisateurRole("juriste");
    const associe = await creerUtilisateurRole("associe");
    const dossierId = await creerDossier(associe.token, responsable.id, intervenant.id);
    const docId = await televerser(responsable.token, dossierId, "restreint");

    for (const [nom, u, attendu] of [
      ["responsable", responsable, true], ["direction", associe, true], ["intervenant simple", intervenant, false],
    ]) {
      const liste = await request(app).get(`/api/dossiers/${dossierId}/documents`).set(auth(u.token));
      expect(liste.body.some((d) => d.id === docId)).toBe(attendu);
    }
  });
});
