// JURIA — Rétrocessions des avocats apporteurs (13/11/2026) : désignation, partage, date d'effet, calcul automatique à
// l'encaissement intégral, exclusions, abonnements.
const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, associeId, collabId, assoc2Id, juristeId;
const auth = () => ({ Authorization: `Bearer ${token}` });

async function creerUtilisateur(role, code) {
  const sfx = Math.random().toString(36).slice(2, 8);
  const { rows } = await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) VALUES ($1,'Test','Apporteur',$2,$3,$4,TRUE,now()) RETURNING id",
    [code + sfx, `test.${code}.${sfx}@jfcavocats-mali.com`, await bcrypt.hash("x-Appo-123!", 4), role]);
  return rows[0].id;
}
async function creerClient(extra = {}) {
  return (await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client apport ${Date.now()}-${Math.random()}`, ...extra })).body.id;
}
async function creerDossier(clientId, ouverture = "2027-02-01") {
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `APP-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier apporteurs", pole: "contentieux",
    client_id: clientId, responsable_id: associeId, mode_honoraires: "forfait",
  });
  await pool.query("UPDATE dossiers SET date_ouverture = $1::date WHERE id = $2", [ouverture, d.body.id]);
  return d.body.id;
}
const facturer = (clientId, dossierId, extra = {}) =>
  request(app).post("/api/factures").set(auth()).send({ client_id: clientId, dossier_id: dossierId, mode: "forfait", montant_ht: 1000000, ...extra });
const payer = (factureId, montant) => request(app).post(`/api/factures/${factureId}/paiements`).set(auth()).send({ montant, mode: "virement" });
const retros = async (factureId) => (await pool.query("SELECT * FROM retrocessions WHERE facture_id = $1 ORDER BY montant DESC", [factureId])).rows;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
  collabId = await creerUtilisateur("collaborateur", "CB");
  assoc2Id = await creerUtilisateur("associe", "AS");
  juristeId = await creerUtilisateur("juriste", "JU");
});
afterAll(async () => { await pool.end(); });

describe("Désignation des apporteurs", () => {
  test("date d'effet 01/01/2027 par défaut, lisible dans les paramètres", async () => {
    const r = await request(app).get("/api/parametres/honoraires").set(auth());
    expect(r.body.retro_date_effet).toBe("2027-01-01");
  });

  test("seuls des avocats ; parts égales par défaut ; total 100 % exigé ; pas de doublon", async () => {
    const dossierId = await creerDossier(await creerClient());
    const juriste = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: juristeId }] });
    expect(juriste.status).toBe(400);
    const egal = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId }, { utilisateur_id: assoc2Id }, { utilisateur_id: associeId }] });
    expect(egal.status).toBe(200);
    expect(egal.body.apporteurs.map((a) => a.part_pct)).toEqual([33.34, 33.33, 33.33]);
    const faux = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId, part_pct: 60 }, { utilisateur_id: assoc2Id, part_pct: 30 }] });
    expect(faux.status).toBe(400);
    const doublon = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId }, { utilisateur_id: collabId }] });
    expect(doublon.status).toBe(400);
    const lu = await request(app).get(`/api/apporteurs?dossier_id=${dossierId}`).set(auth());
    expect(lu.body.eligible).toBe(true);
    expect(lu.body.apporteurs).toHaveLength(3);
  });

  test("dossier ouvert avant la date d'effet : désignation refusée", async () => {
    const dossierId = await creerDossier(await creerClient(), "2026-12-31");
    const r = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId }] });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/avant le 2027-01-01/);
    expect((await request(app).get(`/api/apporteurs?dossier_id=${dossierId}`).set(auth())).body.eligible).toBe(false);
  });
});

describe("Calcul automatique à l'encaissement intégral", () => {
  test("partage 70/30 entre un associé (30 %) et un collaborateur (25 %), « tout ou rien », création unique", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: assoc2Id, part_pct: 70 }, { utilisateur_id: collabId, part_pct: 30 }] });
    const f = await facturer(clientId, dossierId, { taux_tva: 0 });
    expect(f.status).toBe(201);
    await payer(f.body.id, 400000);
    expect(await retros(f.body.id)).toHaveLength(0);
    await payer(f.body.id, Number(f.body.montant_ttc) - 400000);
    const l = await retros(f.body.id);
    expect(l).toHaveLength(2);
    const assoc = l.find((r) => r.beneficiaire_id === assoc2Id);
    const collab = l.find((r) => r.beneficiaire_id === collabId);
    expect(Number(assoc.base_ht)).toBe(700000);
    expect(Number(assoc.montant)).toBe(210000);   // 700 000 × 30 %
    expect(Number(collab.base_ht)).toBe(300000);
    expect(Number(collab.montant)).toBe(75000);   // 300 000 × 25 %
    expect(assoc.statut).toBe("a_decaisser");
    expect(assoc.origine).toBe("apport");
    // l'associé peut décaisser
    const dec = await request(app).post(`/api/retrocessions/${assoc.id}/decaisser`).set(auth()).send({});
    expect(dec.status).toBe(200);
    // une seconde exécution ne crée rien de plus
    const auto = require("../src/retrocessionsAuto");
    expect(await auto.declencherPourFacture(f.body.id)).toHaveLength(0);
    // une rétrocession automatique ne se supprime pas directement
    expect((await request(app).delete(`/api/retrocessions/${collab.id}`).set(auth())).status).toBe(409);
  });

  test("honoraires de résultat (success_fee) : aucune rétrocession", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId }] });
    const f = await facturer(clientId, dossierId, { mode: "success_fee" });
    await payer(f.body.id, Number(f.body.montant_ttc));
    expect(await retros(f.body.id)).toHaveLength(0);
  });

  test("dossier sans apporteur ou antérieur à la date d'effet : aucune rétrocession", async () => {
    const clientId = await creerClient();
    const sans = await creerDossier(clientId);
    const f1 = await facturer(clientId, sans);
    await payer(f1.body.id, Number(f1.body.montant_ttc));
    expect(await retros(f1.body.id)).toHaveLength(0);
    const ancien = await creerDossier(clientId, "2026-06-01");
    await pool.query("INSERT INTO apporteurs (dossier_id, utilisateur_id, part_pct) VALUES ($1,$2,100)", [ancien, collabId]);
    const f2 = await facturer(clientId, ancien);
    await payer(f2.body.id, Number(f2.body.montant_ttc));
    expect(await retros(f2.body.id)).toHaveLength(0);
  });

  test("facture exclue (incident) : rien n'est créé ; réintégrée une fois encaissée, la rétrocession naît ; exclusion retire les non décaissées", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId }] });
    const f = await facturer(clientId, dossierId);
    const ex = await request(app).put(`/api/apporteurs/facture/${f.body.id}/exclusion`).set(auth()).send({ exclue: true, motif: "Incident postérieur" });
    expect(ex.status).toBe(200);
    await payer(f.body.id, Number(f.body.montant_ttc));
    expect(await retros(f.body.id)).toHaveLength(0);
    const re = await request(app).put(`/api/apporteurs/facture/${f.body.id}/exclusion`).set(auth()).send({ exclue: false });
    expect(re.body.retrocessions_creees).toBe(1);
    expect(await retros(f.body.id)).toHaveLength(1);
    const ex2 = await request(app).put(`/api/apporteurs/facture/${f.body.id}/exclusion`).set(auth()).send({ exclue: true });
    expect(ex2.status).toBe(200);
    expect(await retros(f.body.id)).toHaveLength(0);
  });

  test("désignation tardive : les factures déjà intégralement encaissées sont rattrapées ; liste verrouillée aux seuls associés ensuite", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const f = await facturer(clientId, dossierId);
    await payer(f.body.id, Number(f.body.montant_ttc));
    expect(await retros(f.body.id)).toHaveLength(0);
    const r = await request(app).put(`/api/apporteurs/dossier/${dossierId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: collabId }] });
    expect(r.body.retrocessions_creees).toBe(1);
    expect(await retros(f.body.id)).toHaveLength(1);
    const lu = await request(app).get(`/api/apporteurs?dossier_id=${dossierId}`).set(auth());
    expect(lu.body.verrouille).toBe(true);
  });
});

describe("Convention-cadre (abonnement)", () => {
  async function clientAbonne(statut) {
    const clientId = await creerClient();
    const cfg = await request(app).put(`/api/clients/${clientId}/abonnement`).set(auth()).send({ abonnement_periodicite: "mensuelle", abonnement_prochaine_facturation: "2027-02-05", montant_convenu: 500000 });
    expect(cfg.status).toBe(200);
    if (statut) expect((await request(app).put(`/api/apporteurs/client/${clientId}/convention`).set(auth()).send({ retro_abonnement: statut })).status).toBe(200);
    return clientId;
  }
  // la date d'émission ne peut pas être future à la saisie : on la recale en base pour simuler 2027
  const factAbo = async (clientId, date = "2027-02-05") => {
    const f = await request(app).post("/api/factures").set(auth()).send({ client_id: clientId, mode: "abonnement", montant_ht: 600000 });
    if (f.body.id) await pool.query("UPDATE factures SET date_emission = $1::date WHERE id = $2", [date, f.body.id]);
    return f;
  };

  test("« une fois » : une seule rétrocession, sur le montant convenu, à la première facture encaissée", async () => {
    const clientId = await clientAbonne("une_fois");
    await request(app).put(`/api/apporteurs/client/${clientId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: assoc2Id }] });
    const f1 = await factAbo(clientId);
    expect(f1.status).toBe(201);
    await payer(f1.body.id, Number(f1.body.montant_ttc));
    const l1 = await retros(f1.body.id);
    expect(l1).toHaveLength(1);
    expect(Number(l1[0].base_ht)).toBe(500000);       // montant convenu, pas le HT facturé
    expect(Number(l1[0].montant)).toBe(150000);       // associé 30 %
    const f2 = await factAbo(clientId, "2027-03-05");
    await payer(f2.body.id, Number(f2.body.montant_ttc));
    expect(await retros(f2.body.id)).toHaveLength(0);
  });

  test("« aucune » (défaut) : jamais de rétrocession, et la saisie manuelle reste refusée", async () => {
    const clientId = await clientAbonne(null);
    await request(app).put(`/api/apporteurs/client/${clientId}`).set(auth()).send({ apporteurs: [{ utilisateur_id: assoc2Id }] });
    const f = await factAbo(clientId);
    await payer(f.body.id, Number(f.body.montant_ttc));
    expect(await retros(f.body.id)).toHaveLength(0);
    const manuelle = await request(app).post("/api/retrocessions").set(auth()).send({ beneficiaire_id: assoc2Id, qualite: "associe", base_ht: 100000, facture_id: f.body.id });
    expect(manuelle.status).toBe(400);
    expect(manuelle.body.error).toMatch(/aucune rétrocession/);
  });
});

describe("Saisie manuelle conservée", () => {
  test("dossier antérieur à la date d'effet : acceptée avec un avertissement", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId, "2026-05-01");
    const r = await request(app).post("/api/retrocessions").set(auth()).send({ beneficiaire_id: collabId, qualite: "collaborateur", base_ht: 100000, dossier_id: dossierId });
    expect(r.status).toBe(201);
    expect(r.body.avertissement).toMatch(/date d'effet/);
  });
});
