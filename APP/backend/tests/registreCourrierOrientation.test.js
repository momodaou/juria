// JURIA — registre du courrier : acte reçu SANS dossier (ex. assignation),
// destinataire avocat, orientation, imputation avec instructions (17/10/2026).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let associeId; let destinataire; let tiers; let juriste; let avocatCollab; let assistante;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function creerUtilisateur(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestOrient123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Orient',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`O${suffixe.slice(0, 7)}`, `test.orient.${suffixe}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Orient" }, SECRET, { expiresIn: "1h" }) };
}

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  associe = login.body.token; associeId = login.body.utilisateur.id;
  destinataire = await creerUtilisateur("collaborateur"); // avocat destinataire
  tiers = await creerUtilisateur("collaborateur");        // avocat non concerné
  juriste = await creerUtilisateur("juriste");
  avocatCollab = await creerUtilisateur("collaborateur");
  assistante = await creerUtilisateur("assistante");
});
afterAll(async () => { await pool.end(); });

async function dossier() {
  const c = await request(app).post("/api/clients").set(auth(associe)).send({ type: "morale", denomination: `Client orient ${Date.now()}-${Math.random()}` });
  const d = await request(app).post("/api/dossiers").set(auth(associe)).send({
    client_id: c.body.id, intitule: "Dossier orientation", pole: "contentieux", matiere: "Droit civil",
    mode_honoraires: "forfait", urgence: "moyenne", responsable_id: associeId });
  return d.body.id;
}
const enregistrer = (t, extra = {}) =>
  request(app).post("/api/courriers").set(auth(t)).send({ sens: "arrivee", type: "assignation", correspondant: "Huissier X", objet: "Assignation en paiement", ...extra });

describe("Enregistrement d'un acte reçu sans dossier", () => {
  test("le destinataire avocat est obligatoire ; un non-avocat est refusé", async () => {
    expect((await enregistrer(assistante.token)).status).toBe(400);
    expect((await enregistrer(assistante.token, { destinataire_id: juriste.id })).status).toBe(400);
  });

  test("statut « à orienter », transmis au destinataire, rappel créé pour lui (J+2 pour une assignation)", async () => {
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    expect(r.status).toBe(201);
    expect(r.body.orientation).toBe("a_orienter");
    expect(r.body.destinataire_id).toBe(destinataire.id);
    expect(r.body.imputation_id).toBeNull();
    expect(r.body.transmis_le).toBeTruthy();
    expect(r.body.rappel.titre).toContain(r.body.reference);
    const taches = (await request(app).get("/api/taches?mine=1").set(auth(destinataire.token))).body;
    expect(taches.some((t) => t.id === r.body.rappel.id)).toBe(true);
    // Aucun événement/diligence automatique tant qu'il n'y a pas de dossier.
    expect(r.body.declenchement).toBeNull();
  });
});

describe("Visibilité d'un acte sensible non orienté", () => {
  test("visible du destinataire, de l'enregistreur et des associés — pas des autres avocats", async () => {
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    const id = r.body.id;
    const voit = async (t) => (await request(app).get("/api/courriers").set(auth(t))).body.some((c) => c.id === id);
    expect(await voit(destinataire.token)).toBe(true);
    expect(await voit(assistante.token)).toBe(true);
    expect(await voit(associe)).toBe(true);
    expect(await voit(tiers.token)).toBe(false);
    expect((await request(app).get(`/api/courriers/${id}`).set(auth(tiers.token))).status).toBe(404);
    // Un courrier non sensible (lettre) reste visible de tous.
    const lettre = await enregistrer(assistante.token, { type: "lettre", destinataire_id: destinataire.id });
    expect((await request(app).get("/api/courriers").set(auth(tiers.token))).body.some((c) => c.id === lettre.body.id)).toBe(true);
  });
});

describe("Orientation", () => {
  test("rattachement à un dossier existant : déclencheur de l'assignation rattrapé, rappel clôturé", async () => {
    const dossierId = await dossier();
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    expect((await request(app).post(`/api/courriers/${r.body.id}/orienter`).set(auth(tiers.token)).send({ decision: "rattache", dossier_id: dossierId })).status).toBe(403);
    const o = await request(app).post(`/api/courriers/${r.body.id}/orienter`).set(auth(destinataire.token)).send({ decision: "rattache", dossier_id: dossierId });
    expect(o.status).toBe(200);
    expect(o.body.declenchement.type).toBe("evenement"); // audience de mise en état, rattrapée
    const evts = await pool.query("SELECT responsable_id FROM evenements WHERE courrier_id = $1", [r.body.id]);
    expect(evts.rows).toHaveLength(1);
    expect(evts.rows[0].responsable_id).toBe(destinataire.id);
    const rappel = await pool.query("SELECT statut FROM taches WHERE id = $1", [r.body.rappel.id]);
    expect(rappel.rows[0].statut).toBe("termine");
    expect((await request(app).post(`/api/courriers/${r.body.id}/orienter`).set(auth(destinataire.token)).send({ decision: "rattache", dossier_id: dossierId })).status).toBe(409);
  });

  test("rattachement par « Modifier » (PUT) : mêmes rattrapages, une seule fois", async () => {
    const dossierId = await dossier();
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    const put = await request(app).put(`/api/courriers/${r.body.id}`).set(auth(associe)).send({ dossier_id: dossierId });
    expect(put.status).toBe(200);
    await request(app).put(`/api/courriers/${r.body.id}`).set(auth(associe)).send({ dossier_id: dossierId });
    const evts = await pool.query("SELECT 1 FROM evenements WHERE courrier_id = $1", [r.body.id]);
    expect(evts.rows).toHaveLength(1);
    const c = (await request(app).get(`/api/courriers/${r.body.id}`).set(auth(associe))).body;
    expect(c.orientation).toBe("rattache");
  });

  test("sans suite : motif obligatoire, courrier traité", async () => {
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    expect((await request(app).post(`/api/courriers/${r.body.id}/orienter`).set(auth(associe)).send({ decision: "sans_suite" })).status).toBe(400);
    expect((await request(app).post(`/api/courriers/${r.body.id}/orienter`).set(auth(associe)).send({ decision: "sans_suite", motif: "Erreur de destinataire" })).status).toBe(200);
    const c = (await request(app).get(`/api/courriers/${r.body.id}`).set(auth(associe))).body;
    expect(c.orientation).toBe("sans_suite");
    expect(c.statut).toBe("traite");
  });
});

describe("Imputation avec instructions", () => {
  test("refusée avant orientation, à un avocat collaborateur, sans instructions ou par un tiers ; sinon crée la tâche liée", async () => {
    const dossierId = await dossier();
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    const body = { imputation_id: juriste.id, instructions: "Rédiger les conclusions en défense, délai court." };
    expect((await request(app).post(`/api/courriers/${r.body.id}/imputer`).set(auth(destinataire.token)).send(body)).status).toBe(409); // pas encore orienté
    await request(app).post(`/api/courriers/${r.body.id}/orienter`).set(auth(destinataire.token)).send({ decision: "cree", dossier_id: dossierId });
    expect((await request(app).post(`/api/courriers/${r.body.id}/imputer`).set(auth(destinataire.token)).send({ ...body, instructions: " " })).status).toBe(400);
    expect((await request(app).post(`/api/courriers/${r.body.id}/imputer`).set(auth(destinataire.token)).send({ ...body, imputation_id: avocatCollab.id })).status).toBe(400);
    expect((await request(app).post(`/api/courriers/${r.body.id}/imputer`).set(auth(tiers.token)).send(body)).status).toBe(403);
    const ok = await request(app).post(`/api/courriers/${r.body.id}/imputer`).set(auth(destinataire.token)).send({ ...body, echeance: "2026-12-01" });
    expect(ok.status).toBe(201);
    const t = (await pool.query("SELECT responsable_id, description, dossier_id, courrier_etape, echeance::text AS ech FROM taches WHERE id = $1", [ok.body.tache.id])).rows[0];
    expect(t.responsable_id).toBe(juriste.id);
    expect(t.description).toContain("conclusions");
    expect(t.dossier_id).toBe(dossierId);
    expect(t.courrier_etape).toBe("imputation");
    const c = (await request(app).get(`/api/courriers/${r.body.id}`).set(auth(associe))).body;
    expect(c.statut).toBe("impute");
    expect(c.imputation_id).toBe(juriste.id);
    // Quand la tâche est terminée, le courrier passe à « traité ».
    await request(app).put(`/api/taches/${ok.body.tache.id}`).set(auth(juriste.token)).send({ statut: "termine" });
    expect((await request(app).get(`/api/courriers/${r.body.id}`).set(auth(associe))).body.statut).toBe("traite");
  });

  test("« mes courriers » : destinataire ou imputé", async () => {
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id, type: "lettre" });
    const mes = (await request(app).get("/api/courriers?mes=true").set(auth(destinataire.token))).body;
    expect(mes.some((c) => c.id === r.body.id)).toBe(true);
    expect((await request(app).get("/api/courriers?mes=true").set(auth(tiers.token))).body.some((c) => c.id === r.body.id)).toBe(false);
  });
});

describe("Tuile « Courriers à orienter »", () => {
  test("un associé voit le total ; le destinataire voit les siens ; un tiers ne voit rien", async () => {
    const r = await enregistrer(assistante.token, { destinataire_id: destinataire.id });
    const dAssocie = (await request(app).get("/api/dashboard").set(auth(associe))).body;
    expect(dAssocie.courriers_a_orienter_n).toBeGreaterThan(0);
    const dDest = (await request(app).get("/api/dashboard").set(auth(destinataire.token))).body;
    expect(dDest.courriers_a_orienter_n).toBeGreaterThan(0);
    const dTiers = (await request(app).get("/api/dashboard").set(auth(tiers.token))).body;
    expect(dTiers.courriers_a_orienter_n).toBeNull();
    const det = (await request(app).get("/api/dashboard/detail/courriers_a_orienter").set(auth(destinataire.token))).body;
    expect(det.some((l) => l.id === r.body.id)).toBe(true);
  });
});
