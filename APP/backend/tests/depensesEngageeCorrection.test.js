// JURIA — 06/11/2026 : l'engageur corrige une dépense de petite caisse avant validation après coup.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let admin1; let admin2;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const mois = () => new Date().toISOString().slice(0, 8) + "01";
async function creerToken(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestPC123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','CE',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`E${sfx.slice(0, 7)}`, `test.ce.${sfx}@jfcavocats-mali.com`, hash, role]);
  return jwt.sign({ sub: rows[0].id, role, nom: "Test CE" }, SECRET, { expiresIn: "1h" });
}
beforeAll(async () => {
  await assurerUtilisateurTest();
  associe = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  admin1 = await creerToken("admin_general");
  admin2 = await creerToken("admin_general");
  await request(app).put("/api/parametres/honoraires").set(auth(associe)).send({ petite_caisse_plafond_depense: 50000 });
  await request(app).post("/api/depenses/petite-caisse").set(auth(associe)).send({ mois: mois(), montant_alloue: 10000000 });
});
afterAll(async () => { await pool.end(); });

const engager = (t) => request(app).post("/api/depenses/engager").set(auth(t))
  .send({ libelle: "Eua de bureau", montant: 12000, mode_paiement: "orange_money", references: { id_transaction: "MP260101.0001" } });

describe("Correction d'une dépense engagée", () => {
  test("l'engageur corrige libellé et montant ; la correction est tracée", async () => {
    const e = await engager(admin1);
    const r = await request(app).put(`/api/depenses/${e.body.id}/engagee`).set(auth(admin1)).send({ libelle: "Eau de bureau", montant: 15000 });
    expect(r.status).toBe(200);
    expect(r.body.libelle).toBe("Eau de bureau");
    expect(Number(r.body.montant)).toBe(15000);
    expect(r.body.apres_coup_statut).toBe("a_valider");
    const { rows } = await pool.query("SELECT 1 FROM journal_audit WHERE action = 'corriger_depense_engagee' AND entite_id = $1", [e.body.id]);
    expect(rows.length).toBe(1);
  });

  test("refus : un autre que l'engageur, ou un montant au-dessus du plafond", async () => {
    const e = await engager(admin1);
    expect((await request(app).put(`/api/depenses/${e.body.id}/engagee`).set(auth(admin2)).send({ libelle: "X" })).status).toBe(403);
    expect((await request(app).put(`/api/depenses/${e.body.id}/engagee`).set(auth(admin1)).send({ montant: 50001 })).status).toBe(409);
  });

  test("refus une fois la dépense validée par un associé", async () => {
    const e = await engager(admin1);
    expect((await request(app).post(`/api/depenses/${e.body.id}/valider-apres-coup`).set(auth(associe)).send({ decision: "validee" })).status).toBe(200);
    expect((await request(app).put(`/api/depenses/${e.body.id}/engagee`).set(auth(admin1)).send({ libelle: "Trop tard" })).status).toBe(409);
  });
});
