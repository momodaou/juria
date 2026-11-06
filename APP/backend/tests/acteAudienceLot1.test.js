// JURIA — 06/11/2026 : parcours « Acte reçu avec audience », lot 1 (dépôt de l'acte, tâche, tuile).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let collab; let collab2; let assistante; let comptable; let collabId;
const auth = (t) => ({ Authorization: `Bearer ${t}` });
async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestAA123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','AA',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`A${sfx.slice(0, 7)}`, `test.aa.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test AA" }, SECRET, { expiresIn: "1h" }) };
}
const dans = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const deposer = (tok, champs = {}, avecFichier = true) => {
  const r = request(app).post("/api/courriers/acte-audience").set(auth(tok));
  if (avecFichier) r.attach("fichier", Buffer.from("%PDF-1.4 test"), { filename: "assignation.pdf", contentType: "application/pdf" });
  Object.entries(champs).forEach(([k, v]) => r.field(k, v));
  return r;
};

beforeAll(async () => {
  await assurerUtilisateurTest();
  associe = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  const c = await creer("collaborateur"); collab = c.token; collabId = c.id;
  collab2 = (await creer("collaborateur")).token;
  assistante = (await creer("assistante")).token;
  comptable = (await creer("comptable")).token;
});
afterAll(async () => { await pool.end(); });

describe("Dépôt d'un acte reçu avec audience", () => {
  test("l'assistante dépose l'acte : courrier sans dossier, pièce jointe, tâche urgente si audience dans 3 jours", async () => {
    const r = await deposer(assistante, { correspondant: "BDM SA", nature: "Assignation", destinataire_id: collabId, audience_indiquee: dans(3), date_signification: dans(-1) });
    expect(r.status).toBe(201);
    expect(r.body.urgent).toBe(true);
    expect(r.body.dossier_id).toBeNull();
    expect(r.body.acte_audience).toBe(true);
    expect(r.body.orientation).toBe("a_orienter");
    expect(r.body.tache.titre).toMatch(/^URGENT/);
    const { rows } = await pool.query("SELECT fichier_brut_nom FROM courriers WHERE id = $1", [r.body.id]);
    expect(rows[0].fichier_brut_nom).toBe("assignation.pdf");
  });

  test("audience lointaine : pas urgent ; sans audience : accepté", async () => {
    const loin = await deposer(assistante, { correspondant: "ORABANK Mali", destinataire_id: collabId, audience_indiquee: dans(30) });
    expect(loin.status).toBe(201); expect(loin.body.urgent).toBe(false);
    const sans = await deposer(assistante, { correspondant: "ORABANK Mali", destinataire_id: collabId });
    expect(sans.status).toBe(201); expect(sans.body.urgent).toBe(false);
  });

  test("refus : sans fichier, sans client, sans avocat, avocat inactif/inexistant, rôle non autorisé", async () => {
    expect((await deposer(assistante, { correspondant: "BDM SA", destinataire_id: collabId }, false)).status).toBe(400);
    expect((await deposer(assistante, { destinataire_id: collabId })).status).toBe(400);
    expect((await deposer(assistante, { correspondant: "BDM SA" })).status).toBe(400);
    expect((await deposer(assistante, { correspondant: "BDM SA", destinataire_id: "00000000-0000-0000-0000-000000000000" })).status).toBe(400);
    expect((await deposer(comptable, { correspondant: "BDM SA", destinataire_id: collabId })).status).toBe(403);
  });

  test("tuile : l'associé voit les actes proches, l'avocat désigné les siens, un autre avocat rien", async () => {
    await deposer(assistante, { correspondant: "BDM SA", destinataire_id: collabId, audience_indiquee: dans(2) });
    const a = await request(app).get("/api/dashboard").set(auth(associe));
    expect(a.status).toBe(200);
    expect(a.body.actes_audience_n).toBeGreaterThanOrEqual(1);
    const d = await request(app).get("/api/dashboard").set(auth(collab));
    expect(d.body.actes_audience_n).toBeGreaterThanOrEqual(1);
    const autre = await request(app).get("/api/dashboard").set(auth(collab2));
    expect(autre.body.actes_audience_n).toBeNull();
    const detail = await request(app).get("/api/dashboard/detail/actes_audience").set(auth(associe));
    expect(detail.status).toBe(200);
    expect(detail.body[0]).toMatchObject({ reference: expect.any(String), jours_restants: expect.any(Number) });
  });
});
