// JURIA — imputation du responsable d'un dossier à un profil subordonné
// (30/08/2026, précision explicite de l'utilisateur, suite de l'exercice
// « pour chaque profil ») : « seul l'avocat associé peut imputer un
// dossier à un profil [Of Counsel, collaborateur, avocat stagiaire], sur
// tout dossier, classique ou pro bono. »
//
// Un collaborateur garde la capacité de CRÉER un dossier (dossiers.creer
// reste ouvert) — il ne peut simplement pas se désigner, ni désigner un
// autre profil avocat subordonné, comme responsable : ce choix doit venir
// d'un compte associé.
//
// Complété le 12/09/2026 (option séparation « Responsable » / « Intervenant(s) »,
// demande explicite de l'utilisateur) : le responsable d'un dossier doit
// désormais TOUJOURS être un avocat (associé, associé-fondateur, Of
// Counsel, avocat stagiaire, collaborateur) — un juriste ou un stagiaire
// non-avocat ne peut plus être désigné responsable, quel que soit
// l'appelant (même un associé ne le peut plus). Contrôle NON rétroactif :
// seul un nouveau choix (création ou réattribution) est vérifié. Ce
// contrôle avocat-only est distinct et s'exécute AVANT la restriction
// d'imputation ci-dessus, qui ne concerne plus que les 3 vrais profils
// avocat subordonnés (Of Counsel, collaborateur, avocat stagiaire).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
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

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestImputation123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Imputation',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`I${suffixe.slice(0, 7)}`, `test.imputation.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jetons = jwt.sign({ sub: rows[0].id, role, nom: "Test Imputation" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jetons };
}

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client imputation ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

function creerDossier(tokenAppelant, payload) {
  return request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${tokenAppelant}`)
    .send({
      numero: `IMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test imputation",
      pole: "contentieux",
      ...payload,
    });
}

describe("Responsable dossier réservé aux avocats (12/09/2026)", () => {
  test.each(["juriste", "stagiaire"])(
    "%s ne peut jamais être désigné responsable, même par un associé (400)",
    async (role) => {
      const clientId = await creerClient();
      const nonAvocat = await creerUtilisateurRole(role);
      const res = await creerDossier(token, { client_id: clientId, responsable_id: nonAvocat.id });
      expect(res.status).toBe(400);
    }
  );

  test("un profil administratif (ex. admin_general) ne peut pas être désigné responsable (400)", async () => {
    const clientId = await creerClient();
    const admin = await creerUtilisateurRole("admin_general");
    const res = await creerDossier(admin.token, { client_id: clientId, responsable_id: admin.id });
    expect(res.status).toBe(400);
  });

  test("PUT /api/dossiers/:id : réattribuer le responsable à un juriste est refusé, même par un associé (400)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    expect(creation.status).toBe(201);

    const juriste = await creerUtilisateurRole("juriste");
    const maj = await request(app)
      .put(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`) // token = associe (test principal)
      .send({ responsable_id: juriste.id });
    expect(maj.status).toBe(400);
  });

  test("un avocat associé peut toujours être désigné responsable (201)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    expect(res.status).toBe(201);
  });
});

describe("Imputation du responsable — réservée aux associés pour les profils avocat subordonnés (30/08/2026, narrowé le 12/09/2026)", () => {
  test.each(["of_counsel", "collaborateur", "avocat_stagiaire"])(
    "%s ne peut pas se désigner lui-même comme responsable (403)",
    async (role) => {
      const clientId = await creerClient();
      const utilisateur = await creerUtilisateurRole(role);
      const res = await creerDossier(utilisateur.token, { client_id: clientId, responsable_id: utilisateur.id });
      expect(res.status).toBe(403);
    }
  );

  test("un collaborateur ne peut pas désigner un autre collaborateur comme responsable (403)", async () => {
    const clientId = await creerClient();
    const collaborateur1 = await creerUtilisateurRole("collaborateur");
    const collaborateur2 = await creerUtilisateurRole("collaborateur");
    const res = await creerDossier(collaborateur1.token, { client_id: clientId, responsable_id: collaborateur2.id });
    expect(res.status).toBe(403);
  });

  test("un collaborateur PEUT créer un dossier en désignant un associé comme responsable (201)", async () => {
    const clientId = await creerClient();
    const collaborateur = await creerUtilisateurRole("collaborateur");
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(collaborateur.token, { client_id: clientId, responsable_id: associe.id });
    expect(res.status).toBe(201);
  });

  test("un associé peut imputer un dossier à un profil avocat subordonné (201)", async () => {
    const clientId = await creerClient();
    const collaborateur = await creerUtilisateurRole("collaborateur");
    const res = await creerDossier(token, { client_id: clientId, responsable_id: collaborateur.id });
    expect(res.status).toBe(201);
  });

  test("aucune restriction d'imputation hors des 3 profils avocat subordonnés listés (ex. un juriste peut désigner un associé)", async () => {
    const clientId = await creerClient();
    const juriste = await creerUtilisateurRole("juriste");
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(juriste.token, { client_id: clientId, responsable_id: associe.id });
    expect(res.status).toBe(201);
  });

  test("PUT /api/dossiers/:id : réattribution à un profil avocat subordonné refusée pour un non-associé", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    expect(creation.status).toBe(201);

    const collaborateur = await creerUtilisateurRole("collaborateur");
    const maj = await request(app)
      .put(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${collaborateur.token}`)
      .send({ responsable_id: collaborateur.id });
    expect(maj.status).toBe(403);
  });

  test("PUT /api/dossiers/:id : un dossier pro bono reste réservé à un responsable associé, même en réattribution par un associé", async () => {
    const clientId = await creerClient();
    const associe1 = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe1.id, pro_bono: true });
    expect(creation.status).toBe(201);

    const collaborateur = await creerUtilisateurRole("collaborateur");
    const maj = await request(app)
      .put(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`) // token = associe (test principal)
      .send({ responsable_id: collaborateur.id });
    expect(maj.status).toBe(400);
  });
});

describe("Intervenant(s) sur un dossier (12/09/2026)", () => {
  test("ajouter puis retirer un intervenant non-avocat (juriste) sur un dossier", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    expect(creation.status).toBe(201);

    const juriste = await creerUtilisateurRole("juriste");
    const ajout = await request(app)
      .post(`/api/dossiers/${creation.body.id}/intervenants`)
      .set("Authorization", `Bearer ${token}`)
      .send({ utilisateur_id: juriste.id, role_dossier: "Juriste en soutien" });
    expect(ajout.status).toBe(201);

    const fiche = await request(app)
      .get(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(fiche.status).toBe(200);
    expect(fiche.body.intervenants).toEqual([
      expect.objectContaining({ utilisateur_id: juriste.id, statut: "juriste", role_dossier: "Juriste en soutien" }),
    ]);

    const retrait = await request(app)
      .delete(`/api/dossiers/${creation.body.id}/intervenants/${juriste.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(retrait.status).toBe(204);

    const ficheApres = await request(app)
      .get(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ficheApres.body.intervenants).toEqual([]);
  });

  test("retirer un intervenant absent renvoie 404", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    const autre = await creerUtilisateurRole("juriste");
    const res = await request(app)
      .delete(`/api/dossiers/${creation.body.id}/intervenants/${autre.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test("ajouter un intervenant sans utilisateur_id renvoie 400", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    const res = await request(app)
      .post(`/api/dossiers/${creation.body.id}/intervenants`)
      .set("Authorization", `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
  });

  // 12/09/2026, alignement sur le patron déjà suivi par clients_additionnels/
  // parties_adverses : la désignation d'intervenant(s) dès la création est
  // tout aussi légitime que la gestion après coup depuis la fiche dossier.
  test("POST /api/dossiers avec intervenants les crée directement", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const juriste = await creerUtilisateurRole("juriste");
    const collaborateur = await creerUtilisateurRole("collaborateur");
    const creation = await creerDossier(token, {
      client_id: clientId,
      responsable_id: associe.id,
      intervenants: [
        { utilisateur_id: juriste.id, role_dossier: "Juriste en soutien" },
        { utilisateur_id: collaborateur.id },
      ],
    });
    expect(creation.status).toBe(201);

    const fiche = await request(app)
      .get(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(fiche.body.intervenants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ utilisateur_id: juriste.id, statut: "juriste", role_dossier: "Juriste en soutien" }),
        expect.objectContaining({ utilisateur_id: collaborateur.id, statut: "collaborateur", role_dossier: "collaborateur" }),
      ])
    );
    expect(fiche.body.intervenants.length).toBe(2);
  });

  test("POST /api/dossiers avec un intervenants malformé (sans utilisateur_id) l'ignore silencieusement", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId,
      responsable_id: associe.id,
      intervenants: [{ role_dossier: "Sans id" }, null],
    });
    expect(creation.status).toBe(201);
  });
});
