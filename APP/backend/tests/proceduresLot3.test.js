// JURIA — Procédures d'un dossier, lot 3 (13/11/2026) : ouverture guidée (même partie adverse), procédure sur factures et
// temps, exclusion automatique de la rétrocession pour un incident postérieur, repère « pas encore facturée ».
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId;
const auth = () => ({ Authorization: `Bearer ${token}` });

async function creerClient() {
  return (await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client lot3 ${Date.now()}-${Math.random()}` })).body.id;
}
async function creerDossier(clientId, extra = {}) {
  const cid = clientId || await creerClient();
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `L3-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier lot 3", pole: "contentieux",
    client_id: cid, responsable_id: associeId, mode_honoraires: "forfait", ...extra,
  });
  return { dossierId: d.body.id, clientId: cid };
}
const instance = async (dossierId, corps) => (await request(app).post(`/api/dossiers/${dossierId}/instances`).set(auth()).send(corps)).body;
const facturer = (corps) => request(app).post("/api/factures").set(auth()).send({ mode: "forfait", montant_ht: 100000, ...corps });
const factureEnBase = async (id) => (await pool.query("SELECT instance_id, retro_exclue, retro_exclue_motif FROM factures WHERE id = $1", [id])).rows[0];

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

describe("Ouverture guidée : même client, même partie adverse", () => {
  test("un dossier du même client contre la même partie est signalé même dans une autre matière", async () => {
    const { dossierId, clientId } = await creerDossier(null, { code_matiere: "SOC" });
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, type_partie) VALUES ($1,'adverse','SOCIETE ADVERSE-LOT TROIS SA','morale')", [dossierId]);
    const sans = await request(app).get(`/api/dossiers/verifier-doublon?client_id=${clientId}&code_matiere=CIV`).set(auth());
    expect(sans.body.map((x) => x.id)).not.toContain(dossierId);
    const avec = await request(app).get(`/api/dossiers/verifier-doublon?client_id=${clientId}&code_matiere=CIV&adverses=${encodeURIComponent("Societe Adverse Lot Trois SA, Autre")}`).set(auth());
    const ligne = avec.body.find((x) => x.id === dossierId);
    expect(ligne).toBeTruthy();
    expect(ligne.meme_adverse).toBe(true);
    const memeMatiere = await request(app).get(`/api/dossiers/verifier-doublon?client_id=${clientId}&code_matiere=SOC`).set(auth());
    expect(memeMatiere.body.find((x) => x.id === dossierId).meme_adverse).toBe(false);
  });
});

describe("Procédure sur factures et temps", () => {
  test("facture d'un incident postérieur : procédure enregistrée et facture exclue de la rétrocession (motif automatique)", async () => {
    const { dossierId, clientId } = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-01-10" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p1.id });
    const fIncident = await facturer({ client_id: clientId, dossier_id: dossierId, instance_id: p2.id });
    expect(fIncident.status).toBe(201);
    const e = await factureEnBase(fIncident.body.id);
    expect(e.instance_id).toBe(p2.id);
    expect(e.retro_exclue).toBe(true);
    expect(e.retro_exclue_motif).toMatch(/Incident postérieur/);
    const fPrincipale = await facturer({ client_id: clientId, dossier_id: dossierId, instance_id: p1.id });
    expect((await factureEnBase(fPrincipale.body.id)).retro_exclue).toBe(false);
    const liste = await request(app).get(`/api/factures?dossier_id=${dossierId}`).set(auth());
    const l = liste.body.find((x) => x.id === fIncident.body.id);
    expect(Number(l.procedure_rang)).toBe(2);
    expect(l.procedure_nature).toBe("incidente");
    expect(l.procedure_type).toBe("Défense à exécution");
    expect(l.retro_exclue).toBe(true);
  });

  test("dossier reçu d'abord sous forme d'incident : saisi comme première procédure, jamais exclu ; incident suivant exclu ; procédure d'un autre dossier refusée", async () => {
    const { dossierId, clientId } = await creerDossier();
    // un incident ne peut pas viser « rien » (lot 1) : la procédure par laquelle le dossier arrive est la première du dossier
    const sansParent = await request(app).post(`/api/dossiers/${dossierId}/instances`).set(auth()).send({ degre: "refere", juridiction: "CA", nature: "incidente", type_procedure: "Sursis" });
    expect(sansParent.status).toBe(400);
    const entree = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01" });
    const fEntree = await facturer({ client_id: clientId, dossier_id: dossierId, instance_id: entree.id });
    expect((await factureEnBase(fEntree.body.id)).retro_exclue).toBe(false);
    // un incident déclaré ensuite, même un jour de début identique, est postérieur à la procédure préalable
    const incident = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Opposition", parent_instance_id: entree.id });
    const f = await facturer({ client_id: clientId, dossier_id: dossierId, instance_id: incident.id });
    expect((await factureEnBase(f.body.id)).retro_exclue).toBe(true);
    const autre = await creerDossier();
    const pAutre = await instance(autre.dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    const refus = await facturer({ client_id: clientId, dossier_id: dossierId, instance_id: pAutre.id });
    expect(refus.status).toBe(400);
  });

  test("temps rattaché à une procédure ; facture créée depuis ces temps : la procédure est reprise", async () => {
    const { dossierId } = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-01-10" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p1.id });
    const t = await request(app).post("/api/temps").set(auth()).send({ dossier_id: dossierId, duree_minutes: 90, taux_horaire: 50000, description: "Requête en défense", instance_id: p2.id });
    expect(t.status).toBe(201);
    expect(t.body.instance_id).toBe(p2.id);
    const autre = await creerDossier();
    const pAutre = await instance(autre.dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    expect((await request(app).post("/api/temps").set(auth()).send({ dossier_id: dossierId, duree_minutes: 30, instance_id: pAutre.id })).status).toBe(400);
    const liste = await request(app).get(`/api/temps?dossier_id=${dossierId}`).set(auth());
    expect(Number(liste.body.find((x) => x.id === t.body.id).procedure_rang)).toBe(2);
    const f = await request(app).post("/api/factures").set(auth()).send({ dossier_id: dossierId, mode: "temps_passe", temps_ids: [t.body.id] });
    expect(f.status).toBe(201);
    const e = await factureEnBase(f.body.id);
    expect(e.instance_id).toBe(p2.id);
    expect(e.retro_exclue).toBe(true);
  });

  test("correction : procédure affectée après coup sur une facture ; refusée si une rétrocession existe", async () => {
    const { dossierId, clientId } = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2026-01-10" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Sursis", parent_instance_id: p1.id });
    const f = await facturer({ client_id: clientId, dossier_id: dossierId });
    expect((await factureEnBase(f.body.id)).instance_id).toBeNull();
    const maj = await request(app).put(`/api/factures/${f.body.id}`).set(auth()).send({ instance_id: p2.id });
    expect(maj.status).toBe(200);
    const e = await factureEnBase(f.body.id);
    expect(e.instance_id).toBe(p2.id);
    expect(e.retro_exclue).toBe(true);
    await pool.query("INSERT INTO retrocessions (beneficiaire_id, qualite, taux, base_ht, montant, facture_id) VALUES ($1,'associe',30,1000,300,$2)", [associeId, f.body.id]);
    const refus = await request(app).put(`/api/factures/${f.body.id}`).set(auth()).send({ instance_id: p1.id });
    expect(refus.status).toBe(409);
  });
});

describe("Repère « pas encore facturée »", () => {
  test("procédure facturée à part, en cours, sans facture depuis 30 jours : repère ; disparaît dès qu'une facture la concerne", async () => {
    const { dossierId, clientId } = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2025-01-10" });
    const p2 = await instance(dossierId, { degre: "refere", juridiction: "CA", date_debut: "2025-02-01", nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p1.id });
    const lire = async () => (await request(app).get(`/api/dossiers/${dossierId}`).set(auth())).body.instances;
    let inst = await lire();
    expect(inst.find((i) => i.id === p2.id).pas_facturee).toBe(true);          // incident : facturé à part par défaut
    expect(inst.find((i) => i.id === p1.id).pas_facturee).toBe(false);         // principale : facturation incluse
    await facturer({ client_id: clientId, dossier_id: dossierId, instance_id: p2.id });
    inst = await lire();
    expect(inst.find((i) => i.id === p2.id).pas_facturee).toBe(false);
  });

  test("procédure récente ou terminée : pas de repère", async () => {
    const { dossierId } = await creerDossier();
    const p1 = await instance(dossierId, { degre: "appel", juridiction: "CA", date_debut: "2025-01-10" });
    const recent = await instance(dossierId, { degre: "refere", juridiction: "CA", nature: "incidente", type_procedure: "Sursis", parent_instance_id: p1.id, date_debut: new Date().toISOString().slice(0, 10) });
    const ancien = await instance(dossierId, { degre: "refere", juridiction: "CA", nature: "incidente", type_procedure: "Opposition", parent_instance_id: p1.id, date_debut: "2025-02-01", statut_procedure: "terminee" });
    const inst = (await request(app).get(`/api/dossiers/${dossierId}`).set(auth())).body.instances;
    expect(inst.find((i) => i.id === recent.id).pas_facturee).toBe(false);
    expect(inst.find((i) => i.id === ancien.id).pas_facturee).toBe(false);
  });
});
