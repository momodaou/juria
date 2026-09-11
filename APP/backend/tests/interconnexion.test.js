// JURIA — Interconnexion Registre du courrier / Rôle d'audience / Dossiers
// (11/09/2026, gap comblé — voir HISTORY.md) : pièce jointe GED sur un
// courrier, diligences enfin exposées, historique des audiences sur la
// fiche dossier, garde-fou de suppression étendu à `audiences`.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // compte "associe"
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

async function creerClientEtDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client interco ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test interconnexion", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("Courrier -> GED (courriers.document_id)", () => {
  test("refuse le téléversement si le courrier n'a pas de dossier", async () => {
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Un expéditeur sans dossier" });
    expect(courrier.status).toBe(201);
    const res = await request(app).post(`/api/courriers/${courrier.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("contenu"), { filename: "scan.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  test("accepte le téléversement quand le courrier est rattaché à un dossier, met à jour document_id", async () => {
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Un expéditeur", dossier_id: dossierId });
    const upload = await request(app).post(`/api/courriers/${courrier.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("contenu du scan"), { filename: "scan.txt", contentType: "text/plain" });
    expect(upload.status).toBe(201);
    expect(upload.body.document_id).toBeTruthy();

    const relu = await request(app).get(`/api/courriers?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    const ligne = relu.body.find((c) => c.id === courrier.body.id);
    expect(ligne.document_id).toBe(upload.body.document_id);
  });
});

describe("Diligences (planning des rendez-vous/démarches de terrain)", () => {
  test("création sans dossier acceptée (formalité générale)", async () => {
    const res = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ type_diligence: "formalite", date_diligence: "2026-12-01", objet: "Dépôt au greffe" });
    expect(res.status).toBe(201);
    expect(res.body.statut).toBe("a_faire");
  });

  test("création avec dossier + type 'autre' et precision, puis relecture", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ type_diligence: "autre", type_precision: "Constat d'huissier", dossier_id: dossierId, date_diligence: "2026-12-05", objet: "Constat" });
    expect(creation.status).toBe(201);
    const liste = await request(app).get(`/api/diligences?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(liste.status).toBe(200);
    const ligne = liste.body.find((d) => d.id === creation.body.id);
    expect(ligne.type_precision).toBe("Constat d'huissier");
    expect(ligne.dossier_id).toBe(dossierId);
  });

  test("mise à jour du statut (fait), et le déclencheur automatique de courrier alimente bien la table", async () => {
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ date_diligence: "2026-12-01" });
    const maj = await request(app).put(`/api/diligences/${creation.body.id}/statut`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "fait" });
    expect(maj.status).toBe(200);
    expect(maj.body.statut).toBe("fait");

    // Déclencheur : un courrier de type 'convocation' sur un dossier crée
    // automatiquement une diligence (voir courriers.js, appliquerDeclencheurs).
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "convocation", correspondant: "Juridiction X", dossier_id: dossierId });
    expect(courrier.body.declenchement?.type).toBe("diligence");
    const liste = await request(app).get(`/api/diligences?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(liste.body.some((d) => d.courrier_id === courrier.body.id)).toBe(true);
  });
});

describe("Historique des audiences sur la fiche dossier", () => {
  test("GET /api/dossiers/:id/audiences renvoie les audiences du dossier", async () => {
    const dossierId = await creerClientEtDossier();
    await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-10", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const res = await request(app).get(`/api/dossiers/${dossierId}/audiences`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].juridiction).toBe("TGI Bamako");
  });

  test("un dossier avec une audience ne peut plus être supprimé silencieusement (409)", async () => {
    const dossierId = await creerClientEtDossier();
    await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-11", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const suppression = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(409);
    expect(suppression.body.error).toMatch(/audiences/);
  });
});
