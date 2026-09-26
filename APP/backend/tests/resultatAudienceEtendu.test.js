// JURIA — Rôle d'audience : distinction « délibéré » (décision réservée) /
// « délibéré vidé » (décision effectivement rendue), avant dire droit (ADD)
// et document de la décision (26/09/2026, voir CLAUDE.md et HISTORY.md).
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

async function creerClientEtDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client résultat ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test résultat étendu", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("resultat_audience étendu — décision rendue / avant dire droit", () => {
  test("« décision rendue » est acceptée sans prochaine_date (contrairement à renvoi)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-01", juridiction: "TGI Bamako", type: "prononce" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "decision_rendue", observations: "Jugement définitif au fond" });
    expect(retour.status).toBe(200);
    expect(retour.body.audience.resultat).toBe("decision_rendue");
  });

  test("« avant dire droit » est acceptée sans prochaine_date et n'inscrit aucune audience suivante", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-02", juridiction: "TGI Bamako", type: "plaidoirie" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "avant_dire_droit", observations: "Expertise ordonnée" });
    expect(retour.status).toBe(200);
    expect(retour.body.audience.resultat).toBe("avant_dire_droit");
    expect(retour.body.prochaine_inscrite).toBeNull();
  });

  test("les 10 qualifications déjà cataloguées mais jamais activées sont désormais utilisables (ex. sursis à statuer)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-03", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "sursis" });
    expect(retour.status).toBe(200);
    expect(retour.body.audience.resultat).toBe("sursis");
  });

  test("GET /api/listes-valeurs?domaine=resultat_audience expose les 2 nouvelles valeurs", async () => {
    const res = await request(app).get("/api/listes-valeurs?domaine=resultat_audience").set("Authorization", `Bearer ${token}`);
    const codes = res.body.map((r) => r.code);
    expect(codes).toEqual(expect.arrayContaining(["decision_rendue", "avant_dire_droit"]));
  });

  test("le chaînage d'une mise en délibéré crée l'audience de prononcé avec le type 'prononce'", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-04", juridiction: "TGI Bamako", type: "plaidoirie" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere", prochaine_date: "2027-03-20" });
    expect(retour.status).toBe(200);
    const semaineProchaine = await request(app).get("/api/roles-audience?semaine=2027-03-15").set("Authorization", `Bearer ${token}`);
    const ligne = semaineProchaine.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne).toBeDefined();
    expect(ligne.type).toBe("prononce");
  });

  test("un renvoi (pas un délibéré) chaîné garde le type de l'audience d'origine", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-05", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-03-25" });
    expect(retour.status).toBe(200);
    const semaineProchaine = await request(app).get("/api/roles-audience?semaine=2027-03-22").set("Authorization", `Bearer ${token}`);
    const ligne = semaineProchaine.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.type).toBe("mise_en_etat");
  });
});

describe("POST /api/roles-audience/audiences/:id/decision-document", () => {
  test("joint un document, catégorie 'decision', et le lie à l'audience", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-06", juridiction: "TGI Bamako", type: "prononce" });
    const upload = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/decision-document`)
      .set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("contenu du jugement"), { filename: "jugement.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);
    expect(upload.body.decision_document_id).toBeDefined();

    const doc = await pool.query("SELECT categorie, dossier_id FROM documents WHERE id = $1", [upload.body.decision_document_id]);
    expect(doc.rows[0].categorie).toBe("decision");
    expect(doc.rows[0].dossier_id).toBe(dossierId);

    const role = await request(app).get("/api/roles-audience?semaine=2027-03-01").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.decision_document_id).toBe(upload.body.decision_document_id);

    const surDossier = await request(app).get(`/api/dossiers/${dossierId}/audiences`).set("Authorization", `Bearer ${token}`);
    expect(surDossier.body[0].decision_document_id).toBe(upload.body.decision_document_id);
  });

  test("404 pour une audience inexistante", async () => {
    const res = await request(app).post("/api/roles-audience/audiences/00000000-0000-0000-0000-000000000000/decision-document")
      .set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("x"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(404);
  });
});

describe("Tableau de bord — « En attente de réenrôlement » (avant dire droit)", () => {
  test("compte + aperçu incluent un dossier dont la dernière audience est ADD", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-07", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "avant_dire_droit" });

    const dash = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(dash.body.reenrolement_n).toBeGreaterThanOrEqual(1);

    const detail = await request(app).get("/api/dashboard/detail/reenrolement").set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.some((l) => l.dossier_id === dossierId)).toBe(true);
  });

  test("un dossier passé ensuite à une audience 'normale' ne compte plus (seule la DERNIÈRE audience fait foi)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation1 = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-08", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation1.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "avant_dire_droit" });
    // Réenrôlé : nouvelle audience plus récente, résultat différent.
    await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-30", juridiction: "TGI Bamako", type: "mise_en_etat" });

    const detail = await request(app).get("/api/dashboard/detail/reenrolement").set("Authorization", `Bearer ${token}`);
    expect(detail.body.some((l) => l.dossier_id === dossierId)).toBe(false);
  });
});
