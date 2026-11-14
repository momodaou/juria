// JURIA — Dossiers liés (14/11/2026) : relier deux dossiers de la même affaire sans rien déplacer ; alerte précoce d'ouverture.
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId, tokenComptable;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

async function creerDossier(clientId) {
  const cid = clientId || (await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client liens ${Date.now()}-${Math.random()}` })).body.id;
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `LIE-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier lié", pole: "contentieux",
    client_id: cid, responsable_id: associeId, mode_honoraires: "forfait",
  });
  return { id: d.body.id, numero: d.body.numero, clientId: cid };
}
const lier = (id, corps, t) => request(app).post(`/api/dossiers/${id}/liens`).set(auth(t)).send(corps);
const liens = async (id) => (await request(app).get(`/api/dossiers/${id}/liens`).set(auth())).body;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
  const sfx = Math.random().toString(36).slice(2, 8);
  const email = `test.liens.${sfx}@jfcavocats-mali.com`;
  await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) VALUES ($1,'Test','Liens',$2,$3,'comptable',TRUE,now())",
    ["LI" + sfx, email, await bcrypt.hash("x-Liens-123!", 4)]);
  tokenComptable = (await request(app).post("/auth/login").send({ email, mot_de_passe: "x-Liens-123!" })).body.token;
});
afterAll(async () => { await pool.end(); });

describe("Dossiers liés", () => {
  test("le lien se lit des deux côtés, avec la relation vue de chaque dossier", async () => {
    const a = await creerDossier();
    const b = await creerDossier(a.clientId);
    const r = await lier(a.id, { dossier_id: b.id, relation: "incident_de" });
    expect(r.status).toBe(201);
    const deA = await liens(a.id);
    expect(deA).toHaveLength(1);
    expect(deA[0].relation).toBe("incident_de");
    expect(deA[0].libelle).toBe("est l'incident de");
    expect(deA[0].autre_id).toBe(b.id);
    expect(deA[0].numero).toBe(b.numero);
    const deB = await liens(b.id);
    expect(deB[0].relation).toBe("a_pour_incident");
    expect(deB[0].libelle).toBe("a pour incident");
    expect(deB[0].autre_id).toBe(a.id);
  });

  test("relations « suite » et « lié à » ; sens inverse choisi depuis l'autre dossier", async () => {
    const a = await creerDossier();
    const b = await creerDossier(a.clientId);
    const c = await creerDossier(a.clientId);
    await lier(a.id, { dossier_id: b.id, relation: "a_pour_suite" });     // B est la suite de A
    expect((await liens(b.id))[0].relation).toBe("suite_de");
    await lier(a.id, { dossier_id: c.id });                               // relation par défaut : lié à
    const deC = await liens(c.id);
    expect(deC[0].relation).toBe("lie_a");
    expect(deC[0].libelle).toBe("est lié à");
  });

  test("refus : lui-même, doublon (même dans l'autre sens), relation inconnue, dossier inconnu, profil sans droit de modification", async () => {
    const a = await creerDossier();
    const b = await creerDossier(a.clientId);
    expect((await lier(a.id, { dossier_id: a.id })).status).toBe(400);
    expect((await lier(a.id, { dossier_id: b.id, relation: "bizarre" })).status).toBe(400);
    expect((await lier(a.id, { dossier_id: "00000000-0000-0000-0000-000000000000" })).status).toBe(404);
    expect((await lier(a.id, { dossier_id: b.id }, tokenComptable)).status).toBe(403);
    expect((await lier(a.id, { dossier_id: b.id, relation: "incident_de" })).status).toBe(201);
    const doublon = await lier(b.id, { dossier_id: a.id, relation: "suite_de" });
    expect(doublon.status).toBe(409);
  });

  test("retirer le lien depuis l'un ou l'autre dossier ; les dossiers restent inchangés", async () => {
    const a = await creerDossier();
    const b = await creerDossier(a.clientId);
    await lier(a.id, { dossier_id: b.id, relation: "incident_de" });
    const lienId = (await liens(b.id))[0].id;
    expect((await request(app).delete(`/api/dossiers/${b.id}/liens/${lienId}`).set(auth(tokenComptable))).status).toBe(403);
    expect((await request(app).delete(`/api/dossiers/${b.id}/liens/${lienId}`).set(auth())).status).toBe(204);
    expect(await liens(a.id)).toEqual([]);
    expect(await liens(b.id)).toEqual([]);
    expect((await request(app).delete(`/api/dossiers/${b.id}/liens/${lienId}`).set(auth())).status).toBe(404);
    expect((await request(app).get(`/api/dossiers/${a.id}`).set(auth())).status).toBe(200);
  });

  test("un dossier déjà lié n'apparaît plus dans les « dossiers connexes » automatiques", async () => {
    const a = await creerDossier();
    const b = await creerDossier(a.clientId);
    for (const d of [a, b]) await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, type_partie) VALUES ($1,'adverse','PARTIE ADVERSE COMMUNE LIENS SA','morale')", [d.id]);
    const avant = await request(app).get(`/api/dossiers/${a.id}/connexes`).set(auth());
    expect(avant.body.map((x) => x.id)).toContain(b.id);
    await lier(a.id, { dossier_id: b.id });
    const apres = await request(app).get(`/api/dossiers/${a.id}/connexes`).set(auth());
    expect(apres.body.map((x) => x.id)).not.toContain(b.id);
  });

  test("le journal d'audit garde la trace du lien et du retrait", async () => {
    const a = await creerDossier();
    const b = await creerDossier(a.clientId);
    await lier(a.id, { dossier_id: b.id });
    const lienId = (await liens(a.id))[0].id;
    await request(app).delete(`/api/dossiers/${a.id}/liens/${lienId}`).set(auth());
    const { rows } = await pool.query("SELECT action FROM journal_audit WHERE entite = 'dossiers' AND entite_id = $1 AND action IN ('lier_dossier','delier_dossier') ORDER BY horodatage", [a.id]);
    expect(rows.map((r) => r.action)).toEqual(["lier_dossier", "delier_dossier"]);
  });
});

describe("Alerte d'ouverture : le contrôle renvoie le pôle du dossier existant", () => {
  test("pole présent et meme_adverse vrai pour le même client contre la même partie", async () => {
    const a = await creerDossier();
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, type_partie) VALUES ($1,'adverse','AUTRE PARTIE ADVERSE ALERTE SA','morale')", [a.id]);
    const r = await request(app).get(`/api/dossiers/verifier-doublon?client_id=${a.clientId}&adverses=${encodeURIComponent("Autre Partie Adverse Alerte SA")}`).set(auth());
    const ligne = r.body.find((x) => x.id === a.id);
    expect(ligne.meme_adverse).toBe(true);
    expect(ligne.pole).toBe("contentieux");
  });
});
