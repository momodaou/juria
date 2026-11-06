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

describe("Lot 2 : programmer l'audience depuis l'acte", () => {
  const dossierPour = async () => {
    const cl = await pool.query("INSERT INTO clients (type, denomination, reference) VALUES ('morale','BDM TEST ' || substr(md5(random()::text),1,5), 'C' || substr(md5(random()::text),1,8)) RETURNING id, denomination");
    const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
    const d = await pool.query(
      `INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id)
       SELECT $1, 'Dossier test lot 2', $2, (SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1), id FROM utilisateurs LIMIT 1 RETURNING id`, ["T-" + ref, cl.rows[0].id]);
    return { dossierId: d.rows[0].id, client: cl.rows[0].denomination };
  };
  const acte = async (extra = {}) => (await deposer(assistante, { correspondant: "BDM SA", destinataire_id: collabId, audience_indiquee: dans(4), ...extra })).body;

  test("un associé programme l'audience : rattachement, rôle, tâche ; l'acte quitte la tuile", async () => {
    const { dossierId } = await dossierPour();
    const a = await acte();
    const r = await request(app).post(`/api/courriers/${a.id}/programmer-audience`).set(auth(associe))
      .send({ dossier_id: dossierId, date_prevue: dans(4), heure: "08:30", juridiction: "Tribunal de commerce de Bamako", type: "mise_en_etat", urgente: true });
    expect(r.status).toBe(201);
    expect(r.body.dossier_id).toBe(dossierId);
    const c = (await pool.query("SELECT dossier_id, audience_programmee_le, orientation FROM courriers WHERE id = $1", [a.id])).rows[0];
    expect(c.dossier_id).toBe(dossierId); expect(c.audience_programmee_le).not.toBeNull(); expect(c.orientation).toBe("rattache");
    expect((await pool.query("SELECT 1 FROM role_audience_lignes WHERE audience_id = $1", [r.body.audience_id])).rowCount).toBe(1);
    const detail = await request(app).get("/api/dashboard/detail/actes_audience").set(auth(associe));
    expect(detail.body.some((l) => l.id === a.id)).toBe(false);
    const deux = await request(app).post(`/api/courriers/${a.id}/programmer-audience`).set(auth(associe)).send({ dossier_id: dossierId, date_prevue: dans(4) });
    expect(deux.status).toBe(409);
  });

  test("sans dossier : refus ; sans date : refus ; rôle sans permission : 403 ; suggestions par client", async () => {
    const a = await acte();
    expect((await request(app).post(`/api/courriers/${a.id}/programmer-audience`).set(auth(associe)).send({ date_prevue: dans(4) })).status).toBe(400);
    expect((await request(app).post(`/api/courriers/${a.id}/programmer-audience`).set(auth(associe)).send({ dossier_id: "x" })).status).toBe(400);
    expect((await request(app).post(`/api/courriers/${a.id}/programmer-audience`).set(auth(collab)).send({ date_prevue: dans(4) })).status).toBe(403);
    const { client } = await dossierPour();
    const b = await acte({ correspondant: client });
    const s = await request(app).get(`/api/courriers/${b.id}/dossiers-suggeres`).set(auth(associe));
    expect(s.status).toBe(200); expect(s.body.length).toBeGreaterThanOrEqual(1);
  });
});

describe("Lot 3 : heure, correction, fichier, annulation, doublon, habitudes, travail confié", () => {
  const acte = async (extra = {}) => (await deposer(assistante, { correspondant: "CLIENT L3 " + Math.random().toString(36).slice(2, 6), destinataire_id: collabId, audience_indiquee: dans(5), audience_heure: "08:30", ...extra })).body;

  test("l'heure est enregistrée ; un acte semblable est signalé puis accepté si confirmé", async () => {
    const cl = "DOUBLON " + Math.random().toString(36).slice(2, 6);
    const a = await deposer(assistante, { correspondant: cl, destinataire_id: collabId, audience_indiquee: dans(9), audience_heure: "14:00" });
    expect(a.status).toBe(201); expect(a.body.audience_heure).toBe("14:00");
    const b = await deposer(assistante, { correspondant: cl, destinataire_id: collabId, audience_indiquee: dans(9) });
    expect(b.status).toBe(409); expect(b.body.doublons.length).toBe(1);
    expect((await deposer(assistante, { correspondant: cl, destinataire_id: collabId, audience_indiquee: dans(9), confirmer_doublon: "true" })).status).toBe(201);
  });

  test("correction : le déposant corrige la date et l'avocat ; refus pour un tiers ; refus si audience programmée", async () => {
    const a = await acte();
    const r = await request(app).put(`/api/courriers/${a.id}/acte-audience`).set(auth(assistante)).send({ audience_indiquee: dans(2), audience_heure: "09:00", audience_juridiction: "TC Bamako" });
    expect(r.status).toBe(200); expect(r.body.audience_heure).toBe("09:00");
    expect((await request(app).put(`/api/courriers/${a.id}/acte-audience`).set(auth(collab2)).send({ audience_juridiction: "X" })).status).toBe(403);
    const cl = await pool.query("INSERT INTO clients (type, denomination, reference) VALUES ('morale','L3 ' || substr(md5(random()::text),1,5), 'C' || substr(md5(random()::text),1,8)) RETURNING id");
    const d = await pool.query(`INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id) SELECT $1, 'Dossier L3', $2, (SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1), id FROM utilisateurs LIMIT 1 RETURNING id`, ["T-" + Math.random().toString(36).slice(2, 8).toUpperCase(), cl.rows[0].id]);
    const p = await request(app).post(`/api/courriers/${a.id}/programmer-audience`).set(auth(associe)).send({
      dossier_id: d.rows[0].id, date_prevue: dans(2), confier: { utilisateur_id: collabId, instructions: "Préparer la constitution" } });
    expect(p.status).toBe(201); expect(p.body.tache_confiee.titre).toMatch(/Travail confié/);
    expect((await request(app).put(`/api/courriers/${a.id}/acte-audience`).set(auth(associe)).send({ audience_indiquee: dans(3) })).status).toBe(409);
    expect((await request(app).post(`/api/courriers/${a.id}/annuler-acte`).set(auth(associe)).send({ motif: "test" })).status).toBe(409);
  });

  test("fichier remplacé puis retiré ; annulation avec motif sort l'acte de la tuile", async () => {
    const a = await acte();
    const rem = await request(app).post(`/api/courriers/${a.id}/acte-fichier`).set(auth(assistante)).attach("fichier", Buffer.from("%PDF-1.4 v2"), { filename: "v2.pdf", contentType: "application/pdf" });
    expect(rem.status).toBe(200); expect(rem.body.fichier_brut_nom).toBe("v2.pdf");
    expect((await request(app).delete(`/api/courriers/${a.id}/acte-fichier`).set(auth(assistante))).status).toBe(204);
    expect((await request(app).post(`/api/courriers/${a.id}/annuler-acte`).set(auth(assistante)).send({})).status).toBe(400);
    expect((await request(app).post(`/api/courriers/${a.id}/annuler-acte`).set(auth(assistante)).send({ motif: "Déposé par erreur" })).status).toBe(200);
    const detail = await request(app).get("/api/dashboard/detail/actes_audience").set(auth(associe));
    expect(detail.body.some((l) => l.id === a.id)).toBe(false);
  });

  test("sans date d'audience : compté à part ; habitudes par client ; liste des clients", async () => {
    const cl = "HABITUDE " + Math.random().toString(36).slice(2, 6);
    await deposer(assistante, { correspondant: cl, destinataire_id: collabId, audience_juridiction: "Tribunal de commerce de Bamako", nature: "Sommation" });
    const dash = await request(app).get("/api/dashboard").set(auth(associe));
    expect(dash.body.actes_sans_date_n).toBeGreaterThanOrEqual(1);
    const h = await request(app).get("/api/courriers/acte-audience/habitudes").query({ client: cl }).set(auth(assistante));
    expect(h.status).toBe(200); expect(h.body.juridiction).toBe("Tribunal de commerce de Bamako"); expect(h.body.destinataire_id).toBe(collabId);
    const l = await request(app).get("/api/courriers/acte-audience/habitudes").set(auth(assistante));
    expect(l.body.clients).toContain(cl);
  });
});
