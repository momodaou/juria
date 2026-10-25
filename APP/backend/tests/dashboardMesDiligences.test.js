// JURIA — tuile « Mes diligences » du Tableau de bord (25/10/2026).
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

async function creerCollaborateur() {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestDilig123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Diligent',$2,$3,'collaborateur'::role_utilisateur,TRUE,now()) RETURNING id`,
    [`D${suffixe.slice(0, 7)}`, `test.dilig.${suffixe}@jfcavocats-mali.com`, hash]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role: "collaborateur", nom: "Test Diligent" }, SECRET, { expiresIn: "1h" }) };
}

const tableau = (t) => request(app).get("/api/dashboard").set("Authorization", `Bearer ${t}`);

describe("Tableau de bord — Mes diligences", () => {
  test("une diligence confiée par un autre apparaît « nouvelle » chez le diligent, puis « reportée » après report", async () => {
    const diligent = await creerCollaborateur();
    const avantAutre = (await tableau(token)).body.mes_diligences_n;

    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ membre_id: diligent.id, date_diligence: "2027-02-01", objet: "Retirer la grosse au greffe" });
    expect(creation.status).toBe(201);

    const chez = (await tableau(diligent.token)).body;
    expect(chez.mes_diligences_n).toBe(1);
    expect(chez.mes_diligences_apercu[0]).toMatchObject({ objet: "Retirer la grosse au greffe", nouvelle: true, statut: "a_faire" });
    expect(chez.mes_diligences_apercu[0].confiee_par).toBeTruthy();
    // le créateur n'a pas cette diligence dans « Mes diligences » (elle n'est pas à lui)
    expect((await tableau(token)).body.mes_diligences_n).toBe(avantAutre);

    // report par le créateur : visible chez le diligent comme « reportée »
    await request(app).put(`/api/diligences/${creation.body.id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "reporte" });
    const apres = (await tableau(diligent.token)).body;
    expect(apres.mes_diligences_n).toBe(1);
    expect(apres.mes_diligences_apercu[0].statut).toBe("reporte");

    const detail = await request(app).get("/api/dashboard/detail/mes_diligences").set("Authorization", `Bearer ${diligent.token}`);
    expect(detail.body).toHaveLength(1);
  });

  test("auto-attribution : ni « nouvelle » ni « confiée par »", async () => {
    await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ membre_id: userId, date_diligence: "2027-02-02", objet: "Auto" });
    const d = await request(app).get("/api/dashboard/detail/mes_diligences").set("Authorization", `Bearer ${token}`);
    const ligne = d.body.find((l) => l.objet === "Auto");
    expect(ligne.nouvelle).toBe(false);
    expect(ligne.confiee_par).toBeNull();
  });
});
