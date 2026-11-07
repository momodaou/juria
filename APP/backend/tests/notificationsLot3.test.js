// JURIA — centre de notifications, lot 3 (07/11/2026) : e-mails récapitulatifs (gardés par l'interrupteur), e-mail avec PDF à la
// soumission de l'état de charges, travail confié par acte reçu avec audience.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { SECRET } = require("../src/auth");
const { executerRecapMatin, executerRecapLundi, executerRecapCreations } = require("../src/jobs/recapsEmail");
const { assurerUtilisateurTest, pool } = require("./setup");

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestL3123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','L3',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`T${sfx.slice(0, 7)}`, `test.l3.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, email: `test.l3.${sfx}@jfcavocats-mali.com`, token: jwt.sign({ sub: rows[0].id, role, nom: "Test L3" }, SECRET, { expiresIn: "1h" }) };
}
const interrupteur = (v) => pool.query("UPDATE parametres_cabinet SET notifications_email_actif = $1 WHERE id = 1", [v]);
const vers = (u) => envoyerEmail.mock.calls.map((c) => c[0]).filter((m) => m.to === u.email);
const mercredi = new Date("2026-11-11T08:00:00Z"), lundi = new Date("2026-11-09T07:00:00Z"), samedi = new Date("2026-11-14T08:00:00Z");
const liste = async (u, q = "") => (await request(app).get("/api/notifications" + q).set(auth(u))).body;

beforeAll(async () => { await assurerUtilisateurTest(); });
beforeEach(async () => { envoyerEmail.mockClear(); await interrupteur(false); });
afterAll(async () => { await interrupteur(false); await pool.end(); });

describe("Interrupteur général des e-mails de notification", () => {
  test("éteint : aucun récapitulatif ne part", async () => {
    expect(await executerRecapMatin(pool, mercredi)).toMatchObject({ actif: false });
    expect(await executerRecapLundi(pool, lundi)).toMatchObject({ actif: false });
    expect(await executerRecapCreations(pool, mercredi)).toMatchObject({ actif: false });
    expect(envoyerEmail).not.toHaveBeenCalled();
  });
});

describe("Récapitulatif du matin (dépenses)", () => {
  test("un e-mail par décideur, avec des nombres seulement (ni montant ni libellé) ; rien le week-end", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Secret fournisseur L3", montant: 987654 });
    await interrupteur(true);
    const r = await executerRecapMatin(pool, mercredi);
    expect(r.envoyes).toBeGreaterThanOrEqual(1);
    const m = vers(assoc);
    expect(m).toHaveLength(1);
    expect(m[0].subject).toMatch(/dépenses attendent/);
    expect(m[0].html).toMatch(/dépenses? soumises? attend(ent)? votre décision/);
    expect(m[0].html).not.toMatch(/987|Secret fournisseur/);
    expect(vers(adminG)).toHaveLength(0);
    envoyerEmail.mockClear();
    expect(await executerRecapMatin(pool, samedi)).toMatchObject({ week_end: true });
    expect(envoyerEmail).not.toHaveBeenCalled();
  });
});

describe("Récapitulatif du lundi (un seul e-mail par personne)", () => {
  test("diligences et tâches du membre, retards du cabinet pour les associés ; rien un autre jour", async () => {
    const membre = await creer("collaborateur"), chef = await creer("associe");
    await request(app).post("/api/diligences").set(auth(chef)).send({ date_diligence: "2099-01-05", membre_id: membre.id });
    await request(app).post("/api/taches").set(auth(chef)).send({ titre: "Retard L3", responsable_id: membre.id, echeance: "2026-01-05" });
    await interrupteur(true);
    expect(await executerRecapLundi(pool, mercredi)).toMatchObject({ pas_lundi: true });
    expect(envoyerEmail).not.toHaveBeenCalled();
    await executerRecapLundi(pool, lundi);
    const m = vers(membre);
    expect(m).toHaveLength(1);
    expect(m[0].html).toMatch(/1 diligence à faire/);
    expect(m[0].html).toMatch(/1 tâche en cours dont 1 en retard/);
    expect(m[0].html).not.toMatch(/Retard L3/);
    const a = vers(chef);
    expect(a).toHaveLength(1);
    expect(a[0].html).toMatch(/en retard dans le cabinet/);
  });
});

describe("Création de dossier : récapitulatif du soir à la place de l'e-mail par dossier", () => {
  async function creerDossier(par, chef) {
    const cl = await request(app).post("/api/clients").set(auth(chef)).send({ type: "morale", denomination: "Client L3 " + Math.random().toString(36).slice(2, 7) });
    const r = await request(app).post("/api/dossiers").set(auth(par)).send({
      client_id: cl.body.id, responsable_id: chef.id, intitule: "Intitulé confidentiel L3", pole: "contentieux", matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne" });
    expect(r.status).toBe(201);
    return r.body;
  }
  test("interrupteur allumé : aucun e-mail à la création, puis un récapitulatif avec les seuls numéros ; le créateur n'est pas prévenu", async () => {
    const collab = await creer("collaborateur"), assoc = await creer("associe"), adminG = await creer("admin_general");
    await pool.query("UPDATE utilisateurs SET actif = FALSE WHERE id <> ALL($1::uuid[]) AND role IN ('associe','admin_general')", [[assoc.id, adminG.id]]);
    await interrupteur(true);
    const dossier = await creerDossier(collab, assoc);
    expect(envoyerEmail).not.toHaveBeenCalled();
    const r = await executerRecapCreations(pool, mercredi);
    expect(r.envoyes).toBe(2);
    for (const u of [assoc, adminG]) {
      const m = vers(u);
      expect(m).toHaveLength(1);
      expect(m[0].html).toContain(dossier.numero);
      expect(m[0].html).not.toMatch(/Intitulé confidentiel/);
    }
    expect(vers(collab)).toHaveLength(0);
  });
});

describe("Conflit d'intérêts : l'e-mail direct s'efface quand l'interrupteur est allumé", () => {
  test("la cloche reste, aucun e-mail direct", async () => {
    const decideur = await creer("associe"), demandeur = await creer("collaborateur");
    const nom = "QWERTIX" + Math.random().toString(36).slice(2, 6).toUpperCase();
    await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', $1)", [nom]);
    await interrupteur(true);
    const c = await request(app).post("/api/conflict-checks").set(auth(demandeur)).send({ intitule_projet: "Test", noms: nom });
    expect(c.body.resultat).toBe("potentiel");
    expect(envoyerEmail).not.toHaveBeenCalled();
    expect((await liste(decideur)).some((n) => n.type === "conflit_a_decider")).toBe(true);
  });
});

describe("État de charges : e-mail unique avec PDF à la soumission", () => {
  const NOMS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  test("éteint : rien ; allumé : un e-mail par décideur (pas le préparateur), PDF daté, aucun montant dans le corps", async () => {
    const prep = await creer("admin_general"), assoc = await creer("associe");
    const annee = 2100 + Math.floor(Math.random() * 800), m = Math.floor(Math.random() * 12);
    const mois = `${annee}-${String(m + 1).padStart(2, "0")}`;
    // état n°1 (interrupteur éteint)
    const id1 = (await request(app).post("/api/charges/etats").set(auth(prep)).send({ mois })).body.id;
    await request(app).post(`/api/charges/etats/${id1}/lignes`).set(auth(prep)).send({ libelle: "Loyer L3", categorie: "entretien", montant: 4567890 });
    expect((await request(app).post(`/api/charges/etats/${id1}/soumettre`).set(auth(prep))).status).toBe(200);
    expect(vers(assoc)).toHaveLength(0);
    // réouverture puis nouvelle soumission, interrupteur allumé
    await request(app).post(`/api/charges/etats/${id1}/rouvrir`).set(auth(prep));
    await interrupteur(true);
    expect((await request(app).post(`/api/charges/etats/${id1}/soumettre`).set(auth(prep))).status).toBe(200);
    const mails = vers(assoc);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toBe(`État de charges de ${NOMS[m]} ${annee} soumis à votre décision`);
    expect(mails[0].attachments[0].filename).toMatch(new RegExp(`^etat-charges-${mois}-soumis-le-\\d{4}-\\d{2}-\\d{2}\\.pdf$`));
    expect(Buffer.isBuffer(mails[0].attachments[0].content)).toBe(true);
    expect(mails[0].attachments[0].content.slice(0, 4).toString()).toBe("%PDF");
    expect(mails[0].html).not.toMatch(/4567890|4 567 890|Loyer L3/);
    expect(vers(prep)).toHaveLength(0);
  });
});

describe("Travail confié par acte reçu avec audience", () => {
  test("l'avocat chargé de l'audience et la personne à qui un travail est confié sont prévenus (jamais l'auteur)", async () => {
    const assistante = await creer("assistante"), avocat = await creer("collaborateur"), confie = await creer("collaborateur"), chef = await creer("associe");
    const acte = await request(app).post("/api/courriers/acte-audience").set(auth(assistante))
      .field("correspondant", "BDM " + Math.random().toString(36).slice(2, 8).toUpperCase()).field("destinataire_id", avocat.id).field("audience_indiquee", new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10))
      .attach("fichier", Buffer.from("%PDF-1.4 test"), { filename: "assignation.pdf", contentType: "application/pdf" });
    expect(acte.status).toBe(201);
    expect((await liste(avocat)).some((n) => n.type === "tache_assignee")).toBe(true); // tâche « acte reçu à traiter »
    const cl = await pool.query("INSERT INTO clients (type, denomination, reference) VALUES ('morale','L3 ' || substr(md5(random()::text),1,5), 'C' || substr(md5(random()::text),1,8)) RETURNING id");
    const d = await pool.query(`INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id) SELECT $1, 'Dossier L3', $2, (SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1), id FROM utilisateurs LIMIT 1 RETURNING id`,
      ["T-" + Math.random().toString(36).slice(2, 8).toUpperCase(), cl.rows[0].id]);
    const avant = (await liste(avocat)).filter((n) => n.type === "tache_assignee").length;
    const p = await request(app).post(`/api/courriers/${acte.body.id}/programmer-audience`).set(auth(chef)).send({
      dossier_id: d.rows[0].id, date_prevue: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      confier: { utilisateur_id: confie.id, instructions: "Préparer la constitution" } });
    expect(p.status).toBe(201);
    expect((await liste(avocat)).filter((n) => n.type === "tache_assignee").length).toBe(avant + 1);
    const n = (await liste(confie)).find((x) => x.type === "tache_assignee");
    expect(n).toBeTruthy();
    expect(n.a_traiter).toBe(true);
    expect((await liste(chef)).some((x) => x.type === "tache_assignee")).toBe(false);
  });
});
