// JURIA — 10/10/2026, Bloc C du diagnostic "instruction avocat ->
// collaborateur" (voir CLAUDE.md/HISTORY.md) : "Transformer en tâche"
// depuis un message lié à un dossier, et décompte tâches/diligences dans
// la charge de travail du module Cabinet.
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
  const email = `test.blocc.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestBlocC123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','BlocC',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`C${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test BlocC" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, email, token: t };
}

async function creerDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client BlocC ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test BlocC", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return { id: dossier.body.id, numero: dossier.body.numero };
}

describe("GET /api/cabinet/equipe — tâches/diligences en cours par collaborateur", () => {
  test("taches_en_cours compte les tâches actives, exclut terminées/annulées", async () => {
    const membre = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche active 1", responsable_id: membre.id });
    const t2 = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche active 2", responsable_id: membre.id });
    const t3 = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche terminée", responsable_id: membre.id });
    await request(app).put(`/api/taches/${t3.body.id}`).set("Authorization", `Bearer ${token}`).send({ statut: "termine" });

    const equipe = await request(app).get("/api/cabinet/equipe").set("Authorization", `Bearer ${token}`);
    expect(equipe.status).toBe(200);
    const ligne = equipe.body.find((m) => m.id === membre.id);
    expect(ligne).toBeTruthy();
    expect(Number(ligne.taches_en_cours)).toBe(2);
  });

  test("diligences_en_cours compte les diligences à faire, exclut faites/reportées/annulées", async () => {
    const membre = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ membre_id: membre.id, date_diligence: "2027-02-01", objet: "Diligence active" });
    const d2 = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ membre_id: membre.id, date_diligence: "2027-02-02", objet: "Diligence faite" });
    await request(app).put(`/api/diligences/${d2.body.id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "fait" });

    const equipe = await request(app).get("/api/cabinet/equipe").set("Authorization", `Bearer ${token}`);
    const ligne = equipe.body.find((m) => m.id === membre.id);
    expect(Number(ligne.diligences_en_cours)).toBe(1);
  });
});

describe("GET /api/messagerie/conversations — dossier_numero exposé pour « Transformer en tâche »", () => {
  test("null quand la conversation n'est liée à aucun dossier", async () => {
    const autre = await creerUtilisateurRole("collaborateur");
    const conv = await request(app).post("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`)
      .send({ participants: [autre.id] });
    expect(conv.status).toBe(201);

    const liste = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    const ligne = liste.body.find((c) => c.id === conv.body.id);
    expect(ligne.dossier_id).toBeNull();
    expect(ligne.dossier_numero).toBeNull();
  });

  test("renvoie le numéro du dossier quand la conversation y est rattachée", async () => {
    const autre = await creerUtilisateurRole("collaborateur");
    const dossier = await creerDossier();
    const conv = await request(app).post("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`)
      .send({ participants: [autre.id], dossier_id: dossier.id });
    expect(conv.status).toBe(201);

    const liste = await request(app).get("/api/messagerie/conversations").set("Authorization", `Bearer ${token}`);
    const ligne = liste.body.find((c) => c.id === conv.body.id);
    expect(ligne.dossier_id).toBe(dossier.id);
    expect(ligne.dossier_numero).toBe(dossier.numero);
  });
});
