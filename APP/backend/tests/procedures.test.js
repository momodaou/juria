// JURIA — Procédures d'un dossier, lot 1 (13/11/2026) : nature principale/incidente, rattachement, statut, facturation à part,
// juridiction « actuelle » ; masquage des informations de rétrocession pour les profils non concernés.
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId, tokenComptable;
const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

async function creerDossier() {
  const cl = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client procédures ${Date.now()}-${Math.random()}` });
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `PRO-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier procédures", pole: "contentieux",
    client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait", juridiction: "Tribunal du travail de Bamako",
  });
  return { dossierId: d.body.id, clientId: cl.body.id };
}
const ajouter = (dossierId, corps) => request(app).post(`/api/dossiers/${dossierId}/instances`).set(auth()).send(corps);
const lire = async (dossierId) => (await request(app).get(`/api/dossiers/${dossierId}`).set(auth())).body;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
  const sfx = Math.random().toString(36).slice(2, 8);
  const email = `test.compta.${sfx}@jfcavocats-mali.com`;
  await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) VALUES ($1,'Test','Comptable',$2,$3,'comptable',TRUE,now())",
    ["CP" + sfx, email, await bcrypt.hash("x-Compta-123!", 4)]);
  const l2 = await request(app).post("/auth/login").send({ email, mot_de_passe: "x-Compta-123!" });
  tokenComptable = l2.body.token;
});
afterAll(async () => { await pool.end(); });

describe("Procédures : appel + défense à exécution dans le même dossier", () => {
  test("1re instance, appel, puis incident rattaché à l'appel avec sa propre juridiction ; facturation à part par défaut", async () => {
    const { dossierId } = await creerDossier();
    const p1 = await ajouter(dossierId, { degre: "premiere_instance", juridiction: "Tribunal du travail de Bamako", date_debut: "2025-01-10" });
    expect(p1.status).toBe(201);
    expect(p1.body.nature).toBe("principale");
    expect(p1.body.facturation).toBe("incluse");
    const p2 = await ajouter(dossierId, { degre: "appel", juridiction: "Cour d'appel de Bamako", date_debut: "2026-03-01" });
    const p3 = await ajouter(dossierId, {
      degre: "refere", juridiction: "Cour d'appel de Bamako (référé)", date_debut: "2026-04-01",
      nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p2.body.id,
    });
    expect(p3.status).toBe(201);
    expect(p3.body.nature).toBe("incidente");
    expect(p3.body.parent_instance_id).toBe(p2.body.id);
    expect(p3.body.facturation).toBe("a_part");
    const d = await lire(dossierId);
    expect(d.instances.map((i) => Number(i.rang))).toEqual([1, 2, 3]);
    expect(d.instances[2].type_procedure).toBe("Défense à exécution");
  });

  test("juridiction actuelle : celle de la procédure principale en cours, jamais celle d'un incident", async () => {
    const { dossierId } = await creerDossier();
    const p1 = await ajouter(dossierId, { degre: "premiere_instance", juridiction: "Tribunal du travail de Bamako", date_debut: "2025-01-10" });
    expect((await lire(dossierId)).juridiction_actuelle).toBe("Tribunal du travail de Bamako");
    const p2 = await ajouter(dossierId, { degre: "appel", juridiction: "Cour d'appel de Bamako", date_debut: "2026-03-01" });
    await request(app).put(`/api/dossiers/${dossierId}/instances/${p1.body.id}`).set(auth()).send({ statut_procedure: "terminee", date_fin: "2026-02-15" });
    await ajouter(dossierId, { degre: "refere", juridiction: "Juge des référés", date_debut: "2026-04-01", nature: "incidente", type_procedure: "Sursis à exécution", parent_instance_id: p2.body.id });
    const d = await lire(dossierId);
    expect(d.juridiction_actuelle).toBe("Cour d'appel de Bamako");
    expect(d.instances.find((i) => i.id === p1.body.id).statut_procedure).toBe("terminee");
    // la liste des dossiers garde le degré de la procédure principale
    const liste = await request(app).get("/api/dossiers").set(auth());
    const ligne = (liste.body.dossiers || liste.body).find((x) => x.id === dossierId);
    expect(ligne.instance_degre).toBe("appel");
  });

  test("contrôles : incident sans procédure visée, sans nature précisée, visant un autre dossier, boucle, procédure inconnue", async () => {
    const { dossierId } = await creerDossier();
    const autre = await creerDossier();
    const p1 = await ajouter(dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    const pAutre = await ajouter(autre.dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    expect((await ajouter(dossierId, { degre: "refere", nature: "incidente", type_procedure: "Opposition" })).status).toBe(400);
    expect((await ajouter(dossierId, { degre: "refere", nature: "incidente", parent_instance_id: p1.body.id })).status).toBe(400);
    expect((await ajouter(dossierId, { degre: "refere", nature: "incidente", type_procedure: "Opposition", parent_instance_id: pAutre.body.id })).status).toBe(400);
    expect((await ajouter(dossierId, { nature: "bizarre" })).status).toBe(400);
    const inc = await ajouter(dossierId, { degre: "refere", nature: "incidente", type_procedure: "Opposition", parent_instance_id: p1.body.id });
    expect(inc.status).toBe(201);
    const soi = await request(app).put(`/api/dossiers/${dossierId}/instances/${inc.body.id}`).set(auth()).send({ parent_instance_id: inc.body.id });
    expect(soi.status).toBe(400);
    const sous = await ajouter(dossierId, { degre: "refere", nature: "incidente", type_procedure: "Sursis", parent_instance_id: inc.body.id });
    const boucle = await request(app).put(`/api/dossiers/${dossierId}/instances/${inc.body.id}`).set(auth()).send({ parent_instance_id: sous.body.id });
    expect(boucle.status).toBe(400);
  });

  test("une procédure qui a des incidents rattachés ne peut pas être retirée ; l'incident, si", async () => {
    const { dossierId } = await creerDossier();
    const p = await ajouter(dossierId, { degre: "appel", juridiction: "CA" });
    const inc = await ajouter(dossierId, { degre: "refere", nature: "incidente", type_procedure: "Défense à exécution", parent_instance_id: p.body.id });
    expect((await request(app).delete(`/api/dossiers/${dossierId}/instances/${p.body.id}`).set(auth())).status).toBe(409);
    expect((await request(app).delete(`/api/dossiers/${dossierId}/instances/${inc.body.id}`).set(auth())).status).toBe(204);
    expect((await request(app).delete(`/api/dossiers/${dossierId}/instances/${p.body.id}`).set(auth())).status).toBe(204);
  });

  test("modification : date de fin effacée si la procédure redevient en cours ; responsable propre", async () => {
    const { dossierId } = await creerDossier();
    const p = await ajouter(dossierId, { degre: "premiere_instance", juridiction: "TPI" });
    const fin = await request(app).put(`/api/dossiers/${dossierId}/instances/${p.body.id}`).set(auth()).send({ statut_procedure: "terminee", date_fin: "2026-05-05", responsable_id: associeId });
    expect(fin.status).toBe(200);
    expect(String(fin.body.date_fin).slice(0, 10)).toBe("2026-05-05");
    expect(fin.body.responsable_id).toBe(associeId);
    const re = await request(app).put(`/api/dossiers/${dossierId}/instances/${p.body.id}`).set(auth()).send({ statut_procedure: "en_cours" });
    expect(re.body.date_fin).toBeNull();
    expect(re.body.responsable_id).toBe(associeId);
  });

  test("suggestions de types d'incident disponibles dans les listes de valeurs", async () => {
    const r = await request(app).get("/api/listes-valeurs?domaine=type_procedure_incidente").set(auth());
    expect(r.status).toBe(200);
    expect(r.body.map((x) => x.libelle)).toContain("Défense à exécution");
  });
});

describe("Rétrocessions : informations masquées aux profils non concernés", () => {
  test("indicateur « exclue de la rétrocession » absent de la liste des factures pour un comptable, présent pour un associé", async () => {
    const { dossierId, clientId } = await creerDossier();
    const f = await request(app).post("/api/factures").set(auth()).send({ client_id: clientId, dossier_id: dossierId, mode: "forfait", montant_ht: 100000 });
    const comptable = await request(app).get(`/api/factures?dossier_id=${dossierId}`).set(auth(tokenComptable));
    expect(comptable.status).toBe(200);
    const lc = comptable.body.find((x) => x.id === f.body.id);
    expect(lc).toBeTruthy();
    expect("retro_exclue" in lc).toBe(false);
    const associe = await request(app).get(`/api/factures?dossier_id=${dossierId}`).set(auth());
    expect(associe.body.find((x) => x.id === f.body.id).retro_exclue).toBe(false);
  });

  test("la désignation d'apporteurs n'apparaît pas dans « dernière modification » du dossier pour un profil non concerné", async () => {
    const { dossierId } = await creerDossier();
    await pool.query("UPDATE dossiers SET date_ouverture = '2027-02-01' WHERE id = $1", [dossierId]);
    const r = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: associeId }] });
    expect(r.status).toBe(200);
    const vuAssocie = await lire(dossierId);
    expect(vuAssocie.derniere_modification.action).toBe("designer_apporteurs");
    const vuComptable = (await request(app).get(`/api/dossiers/${dossierId}`).set(auth(tokenComptable))).body;
    expect(vuComptable.derniere_modification === null || vuComptable.derniere_modification.action !== "designer_apporteurs").toBe(true);
  });
});
