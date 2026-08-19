// JURIA — tests ciblés sur le volet pro bono (18/08/2026) : déclaration
// réservée aux avocats + quota bloquant, statut honoraires calculé (cumul
// de factures vs seuil pro bono), configurabilité des seuils, et le job
// d'alertes échelonnées.
//
// Historique : ce fichier couvrait à l'origine un second mécanisme, un
// seuil d'honoraires minimum pour les dossiers CLASSIQUES (150 000 FCFA,
// non pro bono) — abandonné par l'utilisateur le jour même de sa mise en
// place (colonne honoraires_min_xof supprimée, statut_honoraires renvoie
// désormais null pour un dossier non pro bono). Les tests correspondants
// ont été retirés plutôt que laissés à figer un comportement disparu.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { executerJobAlertesHonoraires } = require("../src/jobs/alertesHonoraires");

let token; // compte "associe" (a dossiers.pro_bono.declarer + parametres.honoraires.modifier)

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

// Crée un utilisateur de test frais avec le rôle demandé, retourne {id, token}.
// Le jeton est signé directement (même charge utile que routes/auth.js)
// plutôt que via POST /auth/login : ce fichier crée un grand nombre
// d'utilisateurs de test (test.each sur 4 rôles avocats, etc.), et passer
// par la route réelle épuise vite la limitation de débit du login
// (10 tentatives/15 min/IP, express-rate-limit) — non pertinente ici,
// l'authenticité du mot de passe n'étant pas ce que ces tests vérifient.
async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const email = `test.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestHono123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Honoraires',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`H${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const token = jwt.sign({ sub: rows[0].id, role, nom: "Test Honoraires" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token };
}

async function creerClient(overrides = {}) {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client honoraires ${Date.now()}-${Math.random()}`, ...overrides });
  return res.body.id;
}

async function creerDossier(tokenAppelant, payload) {
  return request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${tokenAppelant}`)
    .send({
      numero: `HON-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test honoraires",
      pole: "contentieux",
      ...payload,
    });
}

describe("Déclaration pro bono — réservée aux avocats (associé, associé-fondateur, Of Counsel, collaborateur)", () => {
  test("refusée (403) pour un rôle non-avocat (assistante)", async () => {
    const clientId = await creerClient();
    const assistante = await creerUtilisateurRole("assistante");
    const res = await creerDossier(assistante.token, {
      client_id: clientId, responsable_id: assistante.id, pro_bono: true,
    });
    expect(res.status).toBe(403);
  });

  test("refusée (403) pour un administrateur (admin_general) — technique, pas avocat", async () => {
    const clientId = await creerClient();
    const admin = await creerUtilisateurRole("admin_general");
    const res = await creerDossier(admin.token, {
      client_id: clientId, responsable_id: admin.id, pro_bono: true,
    });
    expect(res.status).toBe(403);
  });

  test.each(["associe", "associe_fondateur", "of_counsel", "collaborateur"])(
    "acceptée pour le rôle avocat %s",
    async (role) => {
      const clientId = await creerClient();
      const avocat = await creerUtilisateurRole(role);
      const res = await creerDossier(avocat.token, {
        client_id: clientId, responsable_id: avocat.id, pro_bono: true,
      });
      expect(res.status).toBe(201);
      expect(res.body.pro_bono).toBe(true);
    }
  );
});

describe("Quota pro bono — blocage réel à la création", () => {
  test("bloque au-delà du quota mensuel/responsable configuré", async () => {
    const responsable = await creerUtilisateurRole("associe");
    const { body: parametres } = await request(app)
      .get("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${token}`);
    const quota = parametres.quota_pro_bono_mensuel;

    for (let i = 0; i < quota; i++) {
      const clientId = await creerClient();
      const res = await creerDossier(token, {
        client_id: clientId, responsable_id: responsable.id, pro_bono: true,
      });
      expect(res.status).toBe(201);
    }

    const clientDeTrop = await creerClient();
    const refus = await creerDossier(token, {
      client_id: clientDeTrop, responsable_id: responsable.id, pro_bono: true,
    });
    expect(refus.status).toBe(409);
  });
});

describe("Statut honoraires pro bono — cumul de factures vs seuil", () => {
  test("dossier pro bono : sans_honoraires → sous_seuil → atteint", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const { body: parametres } = await request(app)
      .get("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${token}`);
    const seuil = Number(parametres.frais_procedure_pro_bono_min_xof);

    const creation = await creerDossier(associe.token, {
      client_id: clientId, responsable_id: associe.id, pro_bono: true, mode_honoraires: "forfait",
    });
    expect(creation.status).toBe(201);
    const dossierId = creation.body.id;

    const initial = await request(app)
      .get(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(initial.body.statut_honoraires).toBe("sans_honoraires");
    expect(Number(initial.body.cumul_xof)).toBe(0);
    expect(Number(initial.body.honoraires_seuil_xof)).toBe(seuil);

    const montantPartiel = Math.round(seuil / 2 / 1.18); // HT tel que TTC (TVA 18%) < seuil
    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: dossierId, mode: "forfait", montant_ht: montantPartiel });

    const partiel = await request(app)
      .get(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(partiel.body.statut_honoraires).toBe("sous_seuil");

    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: dossierId, mode: "forfait", montant_ht: seuil });

    const atteint = await request(app)
      .get(`/api/dossiers/${dossierId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(atteint.body.statut_honoraires).toBe("atteint");
  });

  test("dossier non pro bono : statut_honoraires et seuil toujours null (seuil classique abandonné)", async () => {
    const clientId = await creerClient();
    const responsable = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: responsable.id, mode_honoraires: "forfait",
    });
    expect(creation.status).toBe(201);

    const d = await request(app)
      .get(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(d.body.statut_honoraires).toBeNull();
    expect(d.body.honoraires_seuil_xof).toBeNull();
  });
});

describe("GET/PUT /api/parametres/honoraires (pro bono uniquement)", () => {
  test("lecture ouverte à tout rôle authentifié ; écriture réservée à la permission dédiée", async () => {
    const collaborateur = await creerUtilisateurRole("juriste");

    const lecture = await request(app)
      .get("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${collaborateur.token}`);
    expect(lecture.status).toBe(200);
    expect(lecture.body.honoraires_min_xof).toBeUndefined();
    const original = lecture.body;

    const refus = await request(app)
      .put("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${collaborateur.token}`)
      .send({ quota_pro_bono_mensuel: 99 });
    expect(refus.status).toBe(403);

    const maj = await request(app)
      .put("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${token}`)
      .send({ frais_procedure_pro_bono_min_xof: 60000 });
    expect(maj.status).toBe(200);
    expect(Number(maj.body.frais_procedure_pro_bono_min_xof)).toBe(60000);

    // Restauration immédiate pour ne pas fausser les autres tests.
    await request(app)
      .put("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${token}`)
      .send(original);
  });
});

describe("Job d'alertes honoraires — paliers échelonnés (pro bono uniquement)", () => {
  test("dossier pro bono resté sous le seuil depuis >15 jours : palier J+15 déclenché directement", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(associe.token, {
      client_id: clientId, responsable_id: associe.id, pro_bono: true, mode_honoraires: "forfait",
    });
    const dossierId = creation.body.id;

    // Recule artificiellement la date d'ouverture (test only) pour simuler
    // un dossier ancien sans avoir à attendre 15 jours réels.
    await pool.query(
      "UPDATE dossiers SET date_ouverture = current_date - INTERVAL '20 days' WHERE id = $1",
      [dossierId]
    );

    const resultat = await executerJobAlertesHonoraires(pool, undefined);
    const entree = resultat.details.find((d) => d.dossier === creation.body.numero);
    expect(entree).toBeDefined();
    expect(entree.niveau).toBe("j15");

    const d = await pool.query(
      "SELECT alerte_honoraires_j3, alerte_honoraires_j7, alerte_honoraires_j15 FROM dossiers WHERE id = $1",
      [dossierId]
    );
    expect(d.rows[0].alerte_honoraires_j3).toBe(true);
    expect(d.rows[0].alerte_honoraires_j7).toBe(true);
    expect(d.rows[0].alerte_honoraires_j15).toBe(true);

    const alertes = await pool.query(
      "SELECT destinataire_id, niveau FROM alertes_honoraires WHERE dossier_id = $1",
      [dossierId]
    );
    expect(alertes.rows.length).toBeGreaterThan(0);
    expect(alertes.rows.every((r) => r.niveau === "j15")).toBe(true);
    expect(alertes.rows.some((r) => r.destinataire_id === associe.id)).toBe(true);

    // Idempotence : un second passage ne renvoie plus ce dossier (déjà traité).
    const second = await executerJobAlertesHonoraires(pool, undefined);
    expect(second.details.find((r) => r.dossier === creation.body.numero)).toBeUndefined();
  });

  test("un dossier non pro bono, même ancien et sous n'importe quel seuil, n'est jamais concerné", async () => {
    const clientId = await creerClient();
    const responsable = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: responsable.id, mode_honoraires: "forfait",
    });
    await pool.query(
      "UPDATE dossiers SET date_ouverture = current_date - INTERVAL '30 days' WHERE id = $1",
      [creation.body.id]
    );
    const resultat = await executerJobAlertesHonoraires(pool, undefined);
    expect(resultat.details.find((d) => d.dossier === creation.body.numero)).toBeUndefined();
  });
});
