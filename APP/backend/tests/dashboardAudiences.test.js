// JURIA — « Audiences (7 j) » du Tableau de bord : lit les audiences du Rôle
// d'audience (table audiences), pas seulement les délais de type « audience »
// (25/10/2026).
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

async function creerDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client dashboard audience ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test audience tableau de bord", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

async function audiencesSemaine() {
  const r = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
  return r.body.audiences_semaine;
}

describe("Tableau de bord — audiences (7 j)", () => {
  test("une audience du Rôle d'audience dans 3 jours est comptée, pas celle dans 10 jours ni celle déjà jugée", async () => {
    const dossierId = await creerDossier();
    const avant = await audiencesSemaine();
    const ins = (jours, resultat) => pool.query(
      `INSERT INTO audiences (dossier_id, juridiction, date_audience, type, resultat)
       VALUES ($1,'TGI Bamako', current_date + $2::int, 'plaidoirie', $3::resultat_audience)`,
      [dossierId, jours, resultat]
    );
    await ins(10, null);
    await ins(3, 'plaide');
    expect(await audiencesSemaine()).toBe(avant);

    await ins(3, null);
    expect(await audiencesSemaine()).toBe(avant + 1);

    const detail = await request(app).get("/api/dashboard/detail/audiences").set("Authorization", `Bearer ${token}`);
    expect(detail.body.some((l) => l.dossier_id === dossierId)).toBe(true);
  });
});

describe("Délais & échéances — plus de type « audience » à la saisie", () => {
  test("POST /api/evenements refuse le type audience, accepte un délai de recours", async () => {
    const dossierId = await creerDossier();
    const refus = await request(app).post("/api/evenements").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, type: "audience", titre: "x", date_echeance: "2027-03-01" });
    expect(refus.status).toBe(400);
    const ok = await request(app).post("/api/evenements").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, type: "delai_recours", titre: "Appel", date_echeance: "2027-03-01" });
    expect(ok.status).toBe(201);
    const maj = await request(app).put(`/api/evenements/${ok.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ type: "audience" });
    expect(maj.status).toBe(400);
  });
});
