// JURIA — 19/09/2026 : audit des actions manquantes demandé par
// l'utilisateur (« ou même des actions à créer... jamais envisagé ») —
// 4 capacités qui n'existaient tout simplement pas avant ce jour :
// corriger une ressource Bibliothèque, corriger/annuler une rétrocession
// avant décaissement, corriger une dépense avant décision, retirer une
// demande de congé avant décision.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
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

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestGapAction123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Gap',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`G${suffixe.slice(0, 7)}`, `test.gap.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  const jetons = jwt.sign({ sub: rows[0].id, role, nom: "Test Gap" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jetons };
}

describe("Bibliothèque — PUT /api/biblio/:id (corriger une ressource)", () => {
  test("corrige le titre et la matière sans toucher au fichier", async () => {
    const creation = await request(app)
      .post("/api/biblio")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "jurisprudence", titre: "Titre avec une faute" });
    expect(creation.status).toBe(201);

    const maj = await request(app)
      .put(`/api/biblio/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ titre: "Titre corrigé", matiere: "Droit OHADA" });
    expect(maj.status).toBe(200);
    expect(maj.body.titre).toBe("Titre corrigé");
    expect(maj.body.matiere).toBe("Droit OHADA");
  });

  test("ressource inexistante → 404", async () => {
    const res = await request(app)
      .put("/api/biblio/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`)
      .send({ titre: "X" });
    expect(res.status).toBe(404);
  });
});

describe("Rétrocessions — PUT/DELETE /api/retrocessions/:id (corriger avant décaissement)", () => {
  async function creerRetrocession(overrides = {}) {
    const res = await request(app)
      .post("/api/retrocessions")
      .set("Authorization", `Bearer ${token}`)
      .send({ beneficiaire_id: userId, qualite: "associe", base_ht: 1000000, ...overrides });
    return res.body;
  }

  test("PUT recalcule le montant depuis le nouveau taux × base_ht", async () => {
    const r = await creerRetrocession();
    expect(Number(r.montant)).toBe(300000); // 30% de 1 000 000

    const maj = await request(app)
      .put(`/api/retrocessions/${r.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ base_ht: 2000000 });
    expect(maj.status).toBe(200);
    expect(Number(maj.body.montant)).toBe(600000); // 30% de 2 000 000, pas l'ancien montant recopié
  });

  test("DELETE retire une rétrocession encore en attente", async () => {
    const r = await creerRetrocession();
    const suppr = await request(app).delete(`/api/retrocessions/${r.id}`).set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(204);
  });

  test("PUT refusé (409) une fois décaissée", async () => {
    const r = await creerRetrocession();
    await pool.query("UPDATE retrocessions SET statut = 'decaissee' WHERE id = $1", [r.id]);
    const maj = await request(app)
      .put(`/api/retrocessions/${r.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ base_ht: 5000000 });
    expect(maj.status).toBe(409);
  });

  test("DELETE refusé (409) une fois décaissée", async () => {
    const r = await creerRetrocession();
    await pool.query("UPDATE retrocessions SET statut = 'decaissee' WHERE id = $1", [r.id]);
    const suppr = await request(app).delete(`/api/retrocessions/${r.id}`).set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(409);
  });
});

describe("Dépenses — PUT /api/depenses/:id (corriger avant décision)", () => {
  test("le déposant corrige sa propre dépense soumise", async () => {
    const creation = await request(app)
      .post("/api/depenses")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ponctuelle", libelle: "Frais taxi", montant: 5000 });
    const maj = await request(app)
      .put(`/api/depenses/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant: 7500, libelle: "Frais taxi (correction)" });
    expect(maj.status).toBe(200);
    expect(Number(maj.body.montant)).toBe(7500);
  });

  test("un autre collaborateur sans depenses.decision ne peut pas corriger la dépense d'autrui (403)", async () => {
    const creation = await request(app)
      .post("/api/depenses")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ponctuelle", libelle: "Frais transport", montant: 3000 });
    const autre = await creerUtilisateurRole("collaborateur");
    const maj = await request(app)
      .put(`/api/depenses/${creation.body.id}`)
      .set("Authorization", `Bearer ${autre.token}`)
      .send({ montant: 9999 });
    expect(maj.status).toBe(403);
  });

  test("refusé (409) une fois la décision prise", async () => {
    const creation = await request(app)
      .post("/api/depenses")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "ponctuelle", libelle: "Frais divers", montant: 1000 });
    await pool.query("UPDATE depenses SET statut = 'validee' WHERE id = $1", [creation.body.id]);
    const maj = await request(app)
      .put(`/api/depenses/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant: 2000 });
    expect(maj.status).toBe(409);
  });
});

describe("Congés — DELETE /api/cabinet/conges/:id (retirer avant décision)", () => {
  test("le demandeur retire sa propre demande en attente", async () => {
    const creation = await request(app)
      .post("/api/cabinet/conges")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "annuel", date_debut: "2026-12-01", date_fin: "2026-12-05" });
    const suppr = await request(app).delete(`/api/cabinet/conges/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(204);
  });

  test("quelqu'un d'autre sans cabinet.conge.decision ne peut pas retirer la demande d'autrui (403)", async () => {
    const creation = await request(app)
      .post("/api/cabinet/conges")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "annuel", date_debut: "2026-12-10", date_fin: "2026-12-12" });
    const autre = await creerUtilisateurRole("collaborateur");
    const suppr = await request(app).delete(`/api/cabinet/conges/${creation.body.id}`).set("Authorization", `Bearer ${autre.token}`);
    expect(suppr.status).toBe(403);
  });

  test("refusé (409) une fois la décision prise", async () => {
    const creation = await request(app)
      .post("/api/cabinet/conges")
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "annuel", date_debut: "2026-12-15", date_fin: "2026-12-16" });
    await pool.query("UPDATE conges SET statut = 'approuve' WHERE id = $1", [creation.body.id]);
    const suppr = await request(app).delete(`/api/cabinet/conges/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(409);
  });
});
