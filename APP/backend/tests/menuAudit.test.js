// JURIA — 28/09/2026 : audit menu par menu (Bibliothèque, Registre du
// courrier, Dépenses & caisse, Rétrocessions), suite de l'audit Cabinet du
// 27/09/2026 et de l'audit systématique des routes GET du 28/09/2026.
//
// Couvre les 3 corrections de code testables au niveau backend :
// - GET /api/courriers/:id n'avait AUCUNE garde (contournait
//   courriers.consulter, posée sur GET /) — alignée sur la même permission.
// - PUT /api/courriers/:id (nouveau) — correction des champs de base
//   (correspondant/objet/type/date/dossier/imputation) d'un courrier déjà
//   enregistré, jusqu'ici impossible (seul le statut pouvait évoluer).
// - GET /api/retrocessions/pro-bono n'avait aucune garde — nomme chaque
//   associé et son quota utilisé/restant — alignée sur retrocessions.consulter.
//
// Le bug retrocessions "un bénéficiaire ne voit jamais ses propres
// rétrocessions" était un bug FRONTEND (charger() n'envoyait jamais
// beneficiaire_id=soi-même par défaut) — le backend le permettait déjà
// (voir retrocessions.test.js existant si présent, sinon retrocessions.js
// lui-même) : rien à tester ici côté backend, corrigé uniquement côté écran.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // associe (Test Régression)

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
  const hash = await bcrypt.hash("TestMenuAudit123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','MenuAudit',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`W${suffixe.slice(0, 7)}`, `test.menuaudit.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test MenuAudit" }, SECRET, { expiresIn: "1h" }) };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe("Registre du courrier — GET /:id gardée par courriers.consulter (28/09/2026)", () => {
  test("un rôle sans courriers.consulter (stagiaire) reçoit 403 sur GET /:id", async () => {
    const creation = await request(app).post("/api/courriers").set(auth(token))
      .send({ sens: "arrivee", type: "lettre", correspondant: "Test MenuAudit" });
    expect(creation.status).toBe(201);
    const stagiaire = await creerUtilisateurRole("stagiaire");
    const res = await request(app).get(`/api/courriers/${creation.body.id}`).set(auth(stagiaire.token));
    expect(res.status).toBe(403);
  });

  test("un rôle avec courriers.consulter (associé) reçoit 200 sur GET /:id", async () => {
    const creation = await request(app).post("/api/courriers").set(auth(token))
      .send({ sens: "arrivee", type: "lettre", correspondant: "Test MenuAudit" });
    const res = await request(app).get(`/api/courriers/${creation.body.id}`).set(auth(token));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(creation.body.id);
  });
});

describe("Registre du courrier — PUT /:id, correction des champs de base (28/09/2026)", () => {
  test("corrige correspondant/objet/type/date/imputation sans toucher la référence", async () => {
    const creation = await request(app).post("/api/courriers").set(auth(token))
      .send({ sens: "arrivee", type: "lettre", correspondant: "Faute de frappe", objet: "Objet initial" });
    const membre = await creerUtilisateurRole("collaborateur");

    const maj = await request(app).put(`/api/courriers/${creation.body.id}`).set(auth(token))
      .send({ correspondant: "Nom corrigé", objet: "Objet corrigé", type: "assignation", imputation_id: membre.id });
    expect(maj.status).toBe(200);
    expect(maj.body.correspondant).toBe("Nom corrigé");
    expect(maj.body.objet).toBe("Objet corrigé");
    expect(maj.body.type).toBe("assignation");
    expect(maj.body.imputation_id).toBe(membre.id);
    expect(maj.body.reference).toBe(creation.body.reference);
  });

  test("un rôle sans courriers.statut.modifier ne peut pas corriger un courrier", async () => {
    const creation = await request(app).post("/api/courriers").set(auth(token))
      .send({ sens: "arrivee", type: "lettre", correspondant: "Test MenuAudit" });
    const collab = await creerUtilisateurRole("collaborateur");
    const res = await request(app).put(`/api/courriers/${creation.body.id}`).set(auth(collab.token))
      .send({ correspondant: "Tentative non autorisée" });
    expect(res.status).toBe(403);
  });

  test("404 sur un courrier inexistant", async () => {
    const res = await request(app).put("/api/courriers/00000000-0000-0000-0000-000000000000").set(auth(token))
      .send({ correspondant: "X" });
    expect(res.status).toBe(404);
  });
});

describe("Rétrocessions — GET /pro-bono gardée par retrocessions.consulter (28/09/2026)", () => {
  test("un rôle sans retrocessions.consulter (collaborateur) reçoit 403", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const res = await request(app).get("/api/retrocessions/pro-bono").set(auth(collab.token));
    expect(res.status).toBe(403);
  });

  test("un rôle avec retrocessions.consulter (associé) reçoit 200", async () => {
    const res = await request(app).get("/api/retrocessions/pro-bono").set(auth(token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});
