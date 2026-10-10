// JURIA — 10/10/2026, Bloc A du diagnostic "instruction avocat ->
// collaborateur" (voir CLAUDE.md/HISTORY.md) : audit mené sur les liens
// entre tâche/diligence, collaborateur assigné, instructions de l'avocat
// et dossier. Corrige 2 contournements réels trouvés en auditant
// taches.js/diligences.js, et vérifie la traçabilité (journal_audit) +
// l'exposition de cree_par/description/observations désormais ajoutées.
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
  const hash = await bcrypt.hash("TestConfiance123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Confiance',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`C${suffixe.slice(0, 7)}`, `test.confiance.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jeton = jwt.sign({ sub: rows[0].id, role, nom: "Test Confiance" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jeton };
}

async function creerDossierPourMoi() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client confiance ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test confiance", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("Tâches — PUT /api/taches/:id refuse le contournement de la validation requise", () => {
  test("statut='termine' refusé (409) sur une tâche validation_requise=true, même pour l'associé", async () => {
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche à valider", validation_requise: true });
    expect(creation.status).toBe(201);
    const res = await request(app).put(`/api/taches/${creation.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "termine" });
    expect(res.status).toBe(409);
    const enBase = await pool.query("SELECT statut, valide_par FROM taches WHERE id = $1", [creation.body.id]);
    expect(enBase.rows[0].statut).not.toBe("termine");
    expect(enBase.rows[0].valide_par).toBeNull();
  });

  test("POST /:id/valider reste le seul chemin valide, renseigne valide_par/valide_le", async () => {
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche à valider 2", validation_requise: true });
    const res = await request(app).post(`/api/taches/${creation.body.id}/valider`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.statut).toBe("termine");
    const enBase = await pool.query("SELECT valide_par, valide_le FROM taches WHERE id = $1", [creation.body.id]);
    expect(enBase.rows[0].valide_par).toBe(userId);
    expect(enBase.rows[0].valide_le).not.toBeNull();
  });

  test("statut='termine' toujours autorisé directement sans validation_requise (comportement inchangé)", async () => {
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche sans validation" });
    const res = await request(app).put(`/api/taches/${creation.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "termine" });
    expect(res.status).toBe(200);
  });
});

describe("Tâches — champs description/cree_par exposés + traçabilité", () => {
  test("GET expose description et cree_par_nom", async () => {
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche avec instructions", description: "Vérifier le RCCM avant dépôt" });
    const liste = await request(app).get("/api/taches").set("Authorization", `Bearer ${token}`);
    const t = liste.body.find((x) => x.id === creation.body.id);
    expect(t.description).toBe("Vérifier le RCCM avant dépôt");
    expect(t.cree_par_nom).toBeTruthy();
  });

  test("création, changement de statut et validation sont journalisés dans journal_audit", async () => {
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche journalisée", validation_requise: true });
    const id = creation.body.id;
    await request(app).put(`/api/taches/${id}`).set("Authorization", `Bearer ${token}`).send({ statut: "en_cours" });
    await request(app).post(`/api/taches/${id}/valider`).set("Authorization", `Bearer ${token}`);

    const audit = await pool.query(
      "SELECT action FROM journal_audit WHERE entite = 'taches' AND entite_id = $1 ORDER BY horodatage", [id]
    );
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toContain("creer_tache");
    expect(actions).toContain("modifier_statut_tache");
    expect(actions).toContain("valider_tache");
  });
});

describe("Diligences — PUT /api/diligences/:id/statut restreint au membre/créateur/responsable du dossier", () => {
  test("refuse (403) à quelqu'un qui n'est ni l'assigné, ni le créateur, ni le responsable du dossier", async () => {
    const dossierId = await creerDossierPourMoi();
    const inconnu = await creerUtilisateurRole("collaborateur");
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_diligence: "2027-01-10", objet: "Formalité greffe" });
    const res = await request(app).put(`/api/diligences/${creation.body.id}/statut`)
      .set("Authorization", `Bearer ${inconnu.token}`).send({ statut: "fait" });
    expect(res.status).toBe(403);
  });

  test("autorise le membre assigné, même sans être le créateur ni le responsable du dossier, et enregistre le compte-rendu", async () => {
    const dossierId = await creerDossierPourMoi();
    const assigne = await creerUtilisateurRole("collaborateur");
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, membre_id: assigne.id, date_diligence: "2027-01-11", objet: "RDV client" });
    const res = await request(app).put(`/api/diligences/${creation.body.id}/statut`)
      .set("Authorization", `Bearer ${assigne.token}`)
      .send({ statut: "fait", observations: "Rendez-vous tenu, dossier complet." });
    expect(res.status).toBe(200);
    expect(res.body.observations).toBe("Rendez-vous tenu, dossier complet.");
  });

  test("autorise le responsable du dossier même s'il n'est ni l'assigné ni le créateur", async () => {
    const dossierId = await creerDossierPourMoi(); // responsable_id = userId
    const createur = await creerUtilisateurRole("juriste");
    const assigne = await creerUtilisateurRole("stagiaire");
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${createur.token}`)
      .send({ dossier_id: dossierId, membre_id: assigne.id, date_diligence: "2027-01-12", objet: "Collecte de pièces" });
    const res = await request(app).put(`/api/diligences/${creation.body.id}/statut`)
      .set("Authorization", `Bearer ${token}`).send({ statut: "annule" });
    expect(res.status).toBe(200);
  });
});

describe("Diligences — champs cree_par/observations exposés + traçabilité", () => {
  test("GET expose cree_par_nom et observations", async () => {
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ date_diligence: "2027-01-13", objet: "Démarche test", observations: "Apporter le RIB" });
    const liste = await request(app).get("/api/diligences").set("Authorization", `Bearer ${token}`);
    const d = liste.body.find((x) => x.id === creation.body.id);
    expect(d.observations).toBe("Apporter le RIB");
    expect(d.cree_par_nom).toBeTruthy();
  });

  test("création et changement de statut sont journalisés dans journal_audit", async () => {
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ date_diligence: "2027-01-14", objet: "Démarche journalisée" });
    await request(app).put(`/api/diligences/${creation.body.id}/statut`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "fait" });

    const audit = await pool.query(
      "SELECT action FROM journal_audit WHERE entite = 'diligences' AND entite_id = $1 ORDER BY horodatage",
      [creation.body.id]
    );
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toContain("creer_diligence");
    expect(actions).toContain("modifier_statut_diligence");
  });
});
