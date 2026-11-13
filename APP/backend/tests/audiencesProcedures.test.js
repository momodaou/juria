// JURIA — Procédures d'un dossier, lot 2 (13/11/2026) : audiences rattachées à la procédure concernée.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId;
const auth = () => ({ Authorization: `Bearer ${token}` });

async function creerDossier() {
  const cl = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client audiences ${Date.now()}-${Math.random()}` });
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `AUP-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier audiences", pole: "contentieux",
    client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait",
  });
  return d.body.id;
}
const instance = async (dossierId, corps) => (await request(app).post(`/api/dossiers/${dossierId}/instances`).set(auth()).send(corps)).body;
const programmer = (corps) => request(app).post("/api/roles-audience/lignes").set(auth()).send(corps);
const audiencesDuDossier = async (dossierId) => (await request(app).get(`/api/dossiers/${dossierId}/audiences`).set(auth())).body;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

describe("Audiences rattachées à une procédure", () => {
  test("dossier à une seule procédure : l'audience s'y rattache d'office", async () => {
    const dossierId = await creerDossier();
    const p1 = await instance(dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    const r = await programmer({ dossier_id: dossierId, date_prevue: "2026-12-14", juridiction: "TPI" });
    expect(r.status).toBe(201);
    const [a] = await audiencesDuDossier(dossierId);
    expect(a.instance_id).toBe(p1.id);
    expect(Number(a.procedure_rang)).toBe(1);
  });

  test("plusieurs procédures : choix explicite (incident), sinon aucune procédure ; refus d'une procédure d'un autre dossier", async () => {
    const dossierId = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-03-01" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA (référé)", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p1.id });
    const sans = await programmer({ dossier_id: dossierId, date_prevue: "2026-12-15" });
    expect(sans.status).toBe(201);
    const avec = await programmer({ dossier_id: dossierId, date_prevue: "2026-12-16", instance_id: p2.id });
    expect(avec.status).toBe(201);
    const liste = await audiencesDuDossier(dossierId);
    const a16 = liste.find((x) => String(x.date_audience).startsWith("2026-12-16"));
    expect(a16.instance_id).toBe(p2.id);
    expect(Number(a16.procedure_rang)).toBe(2);
    expect(a16.procedure_nature).toBe("incidente");
    expect(a16.procedure_type).toBe("Défense à exécution");
    expect(liste.find((x) => String(x.date_audience).startsWith("2026-12-15")).instance_id).toBeNull();
    const autre = await creerDossier();
    const pAutre = await instance(autre, { degre: "premiere_instance", juridiction: "TPI" });
    expect((await programmer({ dossier_id: dossierId, date_prevue: "2026-12-17", instance_id: pAutre.id })).status).toBe(400);
  });

  test("affectation puis retrait après coup (audiences déjà saisies) ; refus d'une procédure d'un autre dossier", async () => {
    const dossierId = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-03-01" });
    await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Sursis à exécution", parent_instance_id: p1.id });
    const r = await programmer({ dossier_id: dossierId, date_prevue: "2026-12-18" });
    const audienceId = r.body.audience_id;
    const set = await request(app).put(`/api/roles-audience/audiences/${audienceId}`).set(auth()).send({ instance_id: p1.id });
    expect(set.status).toBe(200);
    expect(set.body.instance_id).toBe(p1.id);
    const autre = await creerDossier();
    const pAutre = await instance(autre, { degre: "premiere_instance", juridiction: "TPI" });
    expect((await request(app).put(`/api/roles-audience/audiences/${audienceId}`).set(auth()).send({ instance_id: pAutre.id })).status).toBe(400);
    const retire = await request(app).put(`/api/roles-audience/audiences/${audienceId}`).set(auth()).send({ instance_id: null });
    expect(retire.body.instance_id).toBeNull();
    // une modification qui ne parle pas de la procédure la laisse telle quelle
    await request(app).put(`/api/roles-audience/audiences/${audienceId}`).set(auth()).send({ instance_id: p1.id });
    const autreChamp = await request(app).put(`/api/roles-audience/audiences/${audienceId}`).set(auth()).send({ instructions: "Apporter les pièces" });
    expect(autreChamp.body.instance_id).toBe(p1.id);
  });

  test("renvoi : l'audience suivante reste rattachée à la même procédure ; le rôle de la semaine l'indique", async () => {
    const dossierId = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-03-01" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p1.id });
    const r = await programmer({ dossier_id: dossierId, date_prevue: "2026-12-21", instance_id: p2.id });
    const retour = await request(app).post(`/api/roles-audience/audiences/${r.body.audience_id}/retour`).set(auth()).send({ resultat: "renvoi", prochaine_date: "2027-01-11" });
    expect(retour.status).toBe(200);
    const liste = await audiencesDuDossier(dossierId);
    const suite = liste.find((x) => String(x.date_audience).startsWith("2027-01-11"));
    expect(suite.instance_id).toBe(p2.id);
    const role = await request(app).get("/api/roles-audience?semaine=2026-12-21").set(auth());
    const ligne = role.body.lignes.find((l) => l.audience_id === r.body.audience_id);
    expect(Number(ligne.procedure_rang)).toBe(2);
    expect(ligne.procedure_type).toBe("Défense à exécution");
  });

  test("retirer la procédure : l'audience reste, rattachée au dossier seul", async () => {
    const dossierId = await creerDossier();
    const p1 = await instance(dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    await programmer({ dossier_id: dossierId, date_prevue: "2026-12-22" });
    expect((await audiencesDuDossier(dossierId))[0].instance_id).toBe(p1.id);
    expect((await request(app).delete(`/api/dossiers/${dossierId}/instances/${p1.id}`).set(auth())).status).toBe(204);
    const [a] = await audiencesDuDossier(dossierId);
    expect(a.instance_id).toBeNull();
  });

  test("PDF du rôle : la procédure est indiquée pour un incident, et pas pour un dossier à une seule procédure", async () => {
    const texte = (buf) => [...buf.toString("latin1").matchAll(/<([0-9a-fA-F]+)>/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join("");
    const pdf = (roleId) => request(app).get(`/api/roles-audience/${roleId}/pdf`).set(auth()).buffer(true)
      .parse((r, cb) => { const c = []; r.on("data", (x) => c.push(x)); r.on("end", () => cb(null, Buffer.concat(c))); });
    const dossierId = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-03-01" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Defense a execution", parent_instance_id: p1.id });
    await programmer({ dossier_id: dossierId, date_prevue: "2027-02-01", instance_id: p2.id });
    const seul = await creerDossier();
    await instance(seul, { degre: "premiere_instance", juridiction: "TPI" });
    await programmer({ dossier_id: seul, date_prevue: "2027-02-02" });
    const role = await request(app).get("/api/roles-audience?semaine=2027-02-01").set(auth());
    const rep = await pdf(role.body.id);
    expect(rep.status).toBe(200);
    const t = texte(rep.body);
    expect(t).toContain("procédure n° 2 (incident : Defense a execution)");
    expect(t).toContain("Defense a execution");
    expect(t.match(/procédure n°/g)).toHaveLength(1);   // seule la ligne de l'incident porte la mention
  });
});
