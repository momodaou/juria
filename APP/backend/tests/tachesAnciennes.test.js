// JURIA — Plan d'action : masquage des tâches terminées/annulées
// "anciennes" (13/09/2026, demande explicite de l'utilisateur — comprendre
// puis corriger le sort d'une tâche une fois exécutée). Voir taches.js.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, moiId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  moiId = login.body.utilisateur.id;
});

async function creerAutreUtilisateur() {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const email = `test.vuepl.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestVuePlan123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','VuePlan',$2,$3,'stagiaire',TRUE,now())
     RETURNING id`,
    [`V${suffixe.slice(0, 7)}`, email, hash]
  );
  const t = jwt.sign({ sub: rows[0].id, role: "stagiaire", nom: "Test VuePlan" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: t };
}

afterAll(async () => {
  await pool.end();
});

// Insertion directe (pas via l'API) pour pouvoir poser un `maj_le` déjà
// ancien à la création : le déclencheur `trg_maj_taches` (BEFORE UPDATE)
// réécrirait sinon systématiquement `maj_le` à `now()` sur tout UPDATE,
// y compris un UPDATE de test — seul un INSERT direct y échappe.
async function creerTacheAvecMajLe(statut, joursDepuis) {
  const { rows } = await pool.query(
    `INSERT INTO taches (titre, statut, responsable_id, cree_par, maj_le)
     VALUES ($1, $2, $3, $3, now() - ($4 || ' days')::interval)
     RETURNING id`,
    [`Tâche test ${statut} ${joursDepuis}j`, statut, moiId, joursDepuis]
  );
  return rows[0].id;
}

describe("GET /api/taches — masquage des tâches terminées/annulées anciennes", () => {
  test("une tâche active reste visible quel que soit son ancienneté", async () => {
    const id = await creerTacheAvecMajLe("a_faire", 90);
    const res = await request(app).get("/api/taches").set("Authorization", `Bearer ${token}`);
    expect(res.body.some((t) => t.id === id)).toBe(true);
  });

  test("une tâche terminée récemment (< 30 jours) reste visible par défaut", async () => {
    const id = await creerTacheAvecMajLe("termine", 5);
    const res = await request(app).get("/api/taches").set("Authorization", `Bearer ${token}`);
    expect(res.body.some((t) => t.id === id)).toBe(true);
  });

  test("une tâche terminée depuis longtemps (> 30 jours) est masquée par défaut, mais reste en base", async () => {
    const id = await creerTacheAvecMajLe("termine", 45);
    const sansAnciennes = await request(app).get("/api/taches").set("Authorization", `Bearer ${token}`);
    expect(sansAnciennes.body.some((t) => t.id === id)).toBe(false);

    const avecAnciennes = await request(app).get("/api/taches?anciennes=true").set("Authorization", `Bearer ${token}`);
    expect(avecAnciennes.body.some((t) => t.id === id)).toBe(true);

    // Toujours en base, rien n'est jamais supprimé.
    const enBase = await pool.query("SELECT statut FROM taches WHERE id = $1", [id]);
    expect(enBase.rows[0].statut).toBe("termine");
  });

  test("une tâche annulée depuis longtemps (> 30 jours) est masquée par défaut, comme une terminée", async () => {
    const id = await creerTacheAvecMajLe("annule", 60);
    const sansAnciennes = await request(app).get("/api/taches").set("Authorization", `Bearer ${token}`);
    expect(sansAnciennes.body.some((t) => t.id === id)).toBe(false);
    const avecAnciennes = await request(app).get("/api/taches?anciennes=true").set("Authorization", `Bearer ${token}`);
    expect(avecAnciennes.body.some((t) => t.id === id)).toBe(true);
  });
});

describe("GET /api/taches?mine=1 — vue par défaut du Plan d'action (14/10/2026)", () => {
  test("inclut une tâche assignée à l'appelant", async () => {
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Mine — assignée à moi" });
    const res = await request(app).get("/api/taches?mine=1").set("Authorization", `Bearer ${token}`);
    expect(res.body.some((t) => t.id === creation.body.id)).toBe(true);
  });

  test("inclut aussi une tâche que l'appelant a confiée à quelqu'un d'autre (OR cree_par)", async () => {
    const autre = await creerAutreUtilisateur();
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Mine — confiée à un autre", responsable_id: autre.id });
    expect(creation.status).toBe(201);
    const res = await request(app).get("/api/taches?mine=1").set("Authorization", `Bearer ${token}`);
    const ligne = res.body.find((t) => t.id === creation.body.id);
    expect(ligne).toBeTruthy();
    expect(ligne.responsable_id).toBe(autre.id);
  });

  test("exclut une tâche ni assignée à l'appelant, ni créée par lui", async () => {
    const autre = await creerAutreUtilisateur();
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${autre.token}`)
      .send({ titre: "Mine — sans rapport avec l'appelant" });
    const res = await request(app).get("/api/taches?mine=1").set("Authorization", `Bearer ${token}`);
    expect(res.body.some((t) => t.id === creation.body.id)).toBe(false);
  });
});

describe("PUT /api/taches/:id — statut 'annule' (13/09/2026, gap comblé côté écran)", () => {
  test("passe une tâche à 'annule' puis la réactive à 'a_faire'", async () => {
    const creation = await request(app)
      .post("/api/taches")
      .set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche à annuler puis réactiver" });
    const id = creation.body.id;

    const annulation = await request(app)
      .put(`/api/taches/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statut: "annule" });
    expect(annulation.status).toBe(200);
    expect(annulation.body.statut).toBe("annule");

    const reactivation = await request(app)
      .put(`/api/taches/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ statut: "a_faire" });
    expect(reactivation.status).toBe(200);
    expect(reactivation.body.statut).toBe("a_faire");
  });
});
