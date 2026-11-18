// JURIA — 18/11/2026 : tri côté serveur de la liste des dossiers, total et pagination.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, uid, clientId;
const auth = () => ({ Authorization: `Bearer ${token}` });
const ids = {};

beforeAll(async () => {
  await assurerUtilisateurTest();
  const l = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = l.body.token; uid = l.body.utilisateur.id;
  clientId = (await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: "CLIENT TRI SARL" })).body.id;
  const creer = async (numero, intitule, urgence) => {
    const d = await request(app).post("/api/dossiers").set(auth()).send({ numero, client_id: clientId, intitule, pole: "contentieux", matiere: "x",
      mode_honoraires: "forfait", urgence, responsable_id: uid });
    expect(d.status).toBe(201);
    return d.body.id;
  };
  const r = 1000 + Math.floor(Math.random() * 8000); // numéros uniques d'une exécution à l'autre
  ids.a = await creer(`CX-CIV-2025-${r + 5}`, "Zeta tri", "basse");
  ids.b = await creer(`CX-COM-2026-${r + 1}`, "Alpha tri", "haute");
  ids.c = await creer(`CX-CIV-2026-${r}`, "Mu tri", "moyenne");
  await pool.query("UPDATE dossiers SET date_ouverture = '2025-03-01' WHERE id = $1", [ids.a]);
  await pool.query("UPDATE dossiers SET date_ouverture = '2026-05-01' WHERE id = $1", [ids.b]);
  await pool.query("UPDATE dossiers SET date_ouverture = '2026-01-15' WHERE id = $1", [ids.c]);
});
afterAll(async () => {
  // nettoyage : les numéros élevés fausseraient les compteurs testés ailleurs (gestion-dossiers)
  try { await pool.query("DELETE FROM dossiers WHERE id = ANY($1::uuid[])", [Object.values(ids)]); } catch (e) { /* données liées : laissées */ }
  await pool.end();
});

const liste = async (qs) => (await request(app).get(`/api/dossiers?client_id=${clientId}&${qs}`).set(auth()));
const ordreIds = (r) => r.body.map((d) => d.id);

describe("Tri de la liste des dossiers", () => {
  test("date d'ouverture croissante / décroissante", async () => {
    expect(ordreIds(await liste("tri=ouverture&sens=asc"))).toEqual([ids.a, ids.c, ids.b]);
    expect(ordreIds(await liste("tri=ouverture&sens=desc"))).toEqual([ids.b, ids.c, ids.a]);
  });
  test("numéro : année puis rang, pas l'ordre alphabétique", async () => {
    expect(ordreIds(await liste("tri=numero&sens=asc"))).toEqual([ids.a, ids.c, ids.b]);
    expect(ordreIds(await liste("tri=numero&sens=desc"))).toEqual([ids.b, ids.c, ids.a]);
  });
  test("urgence : la plus urgente d'abord en décroissant ; intitulé A→Z", async () => {
    expect(ordreIds(await liste("tri=urgence&sens=desc"))).toEqual([ids.b, ids.c, ids.a]);
    expect(ordreIds(await liste("tri=intitule&sens=asc"))).toEqual([ids.b, ids.c, ids.a]);
  });
  test("critère inconnu : tri par défaut sans erreur ; réponse = tableau", async () => {
    const r = await liste("tri=drop_table&sens=nimporte");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body)).toBe(true);
    expect(r.body).toHaveLength(3);
  });
  test("avec_total : { lignes, total } et pagination par décalage", async () => {
    const r = await liste("tri=numero&sens=asc&avec_total=1");
    expect(r.body.total).toBe(3);
    expect(r.body.lignes).toHaveLength(3);
    const suite = await liste("tri=numero&sens=asc&avec_total=1&decalage=2");
    expect(suite.body.lignes.map((d) => d.id)).toEqual([ids.b]);
    expect(suite.body.total).toBe(3);
  });
  test("la matière est renvoyée dans la liste", async () => {
    const r = await liste("tri=matiere&sens=asc");
    expect(r.status).toBe(200);
    expect(r.body[0]).toHaveProperty("matiere");
  });
});
