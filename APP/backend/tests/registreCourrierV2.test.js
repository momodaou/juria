// JURIA — 15/10/2026, réflexion "Registre courrier" (DOC/CLAUDE CODE -
// JURIA/Priompt Registre courrier JURIA.docx), 10 questions tranchées avec
// l'utilisateur avant implémentation. Couvre : visa de l'avocat (Q1),
// envoi effectif tracé symétriquement (Q4), numerise réellement mis à
// jour (Q3), échéance interne J+3 au lieu d'"aujourd'hui" sur assignation/
// convocation (Q5), nouveaux types "Requête"/"Notification".
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, userId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestCourrierV2-123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','CourrierV2',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`CV${suffixe.slice(0, 6)}`, `test.courrierv2.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jeton = jwt.sign({ sub: rows[0].id, role, nom: "Test CourrierV2" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jeton };
}

async function creerClientEtDossier(responsableId) {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client courrierV2 ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test courrierV2", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: responsableId || userId,
    });
  return dossier.body.id;
}

describe("Types 'Requête'/'Notification' — ENUM enfin alignée avec le référentiel", () => {
  test("acceptés par POST /api/courriers", async () => {
    const requete = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "depart", type: "requete", correspondant: "Tribunal de commerce" });
    expect(requete.status).toBe(201);
    const notification = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "depart", type: "notification", correspondant: "Confrère adverse" });
    expect(notification.status).toBe(201);
  });
});

describe("numerise — enfin réellement mis à jour (Q3)", () => {
  test("passe à TRUE quand un scan est classé directement dans la GED (dossier déjà rattaché)", async () => {
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Expéditeur", dossier_id: dossierId, support: "papier" });
    expect(courrier.body.a_numeriser).toBe(true);
    expect(courrier.body.numerise).toBe(false);
    await request(app).post(`/api/courriers/${courrier.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("scan papier"), { filename: "scan.txt", contentType: "text/plain" });
    const relu = await request(app).get(`/api/courriers?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    const ligne = relu.body.find((c) => c.id === courrier.body.id);
    expect(ligne.numerise).toBe(true);
  });

  test("passe à TRUE aussi lors de la migration automatique (PUT /:id)", async () => {
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", destinataire_id: userId, type: "lettre", correspondant: "Expéditeur", support: "papier" });
    await request(app).post(`/api/courriers/${courrier.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("scan en attente"), { filename: "scan.txt", contentType: "text/plain" });
    const dossierId = await creerClientEtDossier();
    const maj = await request(app).put(`/api/courriers/${courrier.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId });
    expect(maj.body.document_id).toBeTruthy();
    const relu = await request(app).get(`/api/courriers?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.find((c) => c.id === courrier.body.id).numerise).toBe(true);
  });

  test("GET ?en_attente_numerisation=true ne renvoie que a_numeriser=TRUE ET numerise=FALSE", async () => {
    const dossierId = await creerClientEtDossier();
    const enAttente = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Papier en attente", dossier_id: dossierId, support: "papier" });
    const dejaNumerise = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Papier déjà scanné", dossier_id: dossierId, support: "papier" });
    await request(app).post(`/api/courriers/${dejaNumerise.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("déjà scanné"), { filename: "scan.txt", contentType: "text/plain" });
    const numerique = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Reçu par e-mail", dossier_id: dossierId, support: "numerique" });

    const filtre = await request(app).get(`/api/courriers?dossier_id=${dossierId}&en_attente_numerisation=true`)
      .set("Authorization", `Bearer ${token}`);
    const ids = filtre.body.map((c) => c.id);
    expect(ids).toContain(enAttente.body.id);
    expect(ids).not.toContain(dejaNumerise.body.id);
    expect(ids).not.toContain(numerique.body.id);
  });
});

describe("Envoi effectif tracé symétriquement à l'imputation (Q4)", () => {
  test("PUT /:id/statut statut='expedie' pose expedie_par/expedie_le, comme 'impute' pose transmis_par/transmis_le", async () => {
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "depart", type: "lettre", correspondant: "Destinataire", dossier_id: dossierId });

    const impute = await request(app).put(`/api/courriers/${courrier.body.id}/statut`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "impute", imputation_id: userId });
    expect(impute.status).toBe(200);
    let relu = await request(app).get(`/api/courriers?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    let ligne = relu.body.find((c) => c.id === courrier.body.id);
    expect(ligne.transmis_par).toBe(userId);
    expect(ligne.transmis_le).toBeTruthy();
    expect(ligne.expedie_par).toBeNull();

    const expedie = await request(app).put(`/api/courriers/${courrier.body.id}/statut`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "expedie" });
    expect(expedie.status).toBe(200);
    relu = await request(app).get(`/api/courriers?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    ligne = relu.body.find((c) => c.id === courrier.body.id);
    expect(ligne.expedie_par).toBe(userId);
    expect(ligne.expedie_le).toBeTruthy();
  });
});

describe("POST /api/courriers/:id/viser — Q1", () => {
  test("un avocat responsable du dossier peut viser", async () => {
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "assignation", correspondant: "Huissier", dossier_id: dossierId });
    const visa = await request(app).post(`/api/courriers/${courrier.body.id}/viser`).set("Authorization", `Bearer ${token}`);
    expect(visa.status).toBe(200);
    expect(visa.body.vise_par).toBe(userId);
    expect(visa.body.vise_le).toBeTruthy();
  });

  test("un avocat INTERVENANT (pas responsable) peut aussi viser", async () => {
    const intervenant = await creerUtilisateurRole("collaborateur");
    const dossierId = await creerClientEtDossier(); // responsable = userId (associe)
    await request(app).post(`/api/dossiers/${dossierId}/intervenants`).set("Authorization", `Bearer ${token}`)
      .send({ utilisateur_id: intervenant.id });
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "assignation", correspondant: "Huissier", dossier_id: dossierId });
    const visa = await request(app).post(`/api/courriers/${courrier.body.id}/viser`).set("Authorization", `Bearer ${intervenant.token}`);
    expect(visa.status).toBe(200);
    expect(visa.body.vise_par).toBe(intervenant.id);
  });

  test("refusé (403) pour un rôle non-avocat (juriste)", async () => {
    const juriste = await creerUtilisateurRole("juriste");
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "assignation", correspondant: "Huissier", dossier_id: dossierId });
    const visa = await request(app).post(`/api/courriers/${courrier.body.id}/viser`).set("Authorization", `Bearer ${juriste.token}`);
    expect(visa.status).toBe(403);
  });

  test("refusé (403) pour un avocat qui n'est ni responsable ni intervenant du dossier", async () => {
    const avocatExterieur = await creerUtilisateurRole("collaborateur");
    const dossierId = await creerClientEtDossier(); // responsable = userId, pas avocatExterieur
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "assignation", correspondant: "Huissier", dossier_id: dossierId });
    const visa = await request(app).post(`/api/courriers/${courrier.body.id}/viser`).set("Authorization", `Bearer ${avocatExterieur.token}`);
    expect(visa.status).toBe(403);
  });

  test("refusé (400) si aucun dossier n'est rattaché au courrier", async () => {
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", destinataire_id: userId, type: "assignation", correspondant: "Huissier" });
    const visa = await request(app).post(`/api/courriers/${courrier.body.id}/viser`).set("Authorization", `Bearer ${token}`);
    expect(visa.status).toBe(400);
  });
});

describe("Échéance interne J+3 au lieu d'« aujourd'hui » (Q5) — assignation/convocation", () => {
  test("assignation crée désormais une échéance (evenement, type 'audience') à date_courrier + 3 jours", async () => {
    const dossierId = await creerClientEtDossier();
    const dateCourrier = "2027-01-10";
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "assignation", correspondant: "Huissier", dossier_id: dossierId, date_courrier: dateCourrier });
    expect(courrier.body.declenchement.type).toBe("evenement");
    const echeance = new Date(courrier.body.declenchement.date_echeance);
    expect(echeance.toISOString().slice(0, 10)).toBe("2027-01-13"); // +3 jours, pas "aujourd'hui"
  });

  test("convocation crée une diligence à date_courrier + 3 jours", async () => {
    const dossierId = await creerClientEtDossier();
    const dateCourrier = "2027-02-05";
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "convocation", correspondant: "Juridiction", dossier_id: dossierId, date_courrier: dateCourrier });
    expect(courrier.body.declenchement.type).toBe("diligence");
    const diligence = new Date(courrier.body.declenchement.date_diligence);
    expect(diligence.toISOString().slice(0, 10)).toBe("2027-02-08"); // +3 jours
  });
});
