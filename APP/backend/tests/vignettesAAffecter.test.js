// JURIA — Vignettes de plaidoirie, lot F (11/11/2026) : proposition automatique, affectation manuelle.
// À la création d'une instance sur un dossier contentieux : notification « vignette à affecter », liste des instances en attente,
// prochain numéro proposé, dispense, rappel après 3 jours ouvrés, alerte de stock bas. Jamais de décompte automatique.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { executerJobNotificationsRelances } = require("../src/jobs/notificationsRelances");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe, userId;
const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function creerUtilisateur(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestVa123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Vignette',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`F${sfx.slice(0, 7)}`, `test.va.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Vignette" }, SECRET, { expiresIn: "1h" }) };
}
async function creerDossier(pole = "contentieux") {
  const cl = await request(app).post("/api/clients").set(auth(associe)).send({ type: "morale", denomination: `Client vignette F ${Date.now()}-${Math.random()}` });
  const r = await request(app).post("/api/dossiers").set(auth(associe)).send({
    numero: `VGF-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier test lot F", client_id: cl.body.id, pole,
    responsable_id: userId, mode_honoraires: "forfait" });
  return r.body.id;
}
const creerInstance = (dossierId, user = associe) => request(app).post(`/api/dossiers/${dossierId}/instances`).set(auth(user.token || user)).send({ degre: "premiere_instance" });
const notifs = async (t, type) => (await request(app).get("/api/notifications").set(auth(t))).body.filter((n) => n.type === type);
const aAffecter = async () => (await request(app).get("/api/depenses/vignettes/a-affecter").set(auth(associe))).body;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  associe = login.body.token;
  userId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

describe("Vignette à affecter", () => {
  test("une instance sur un dossier contentieux est proposée ; sur un dossier de conseil, non", async () => {
    const gestionnaire = await creerUtilisateur("assistante"); // reçoit l'alerte (depenses.vignettes.mouvement) sans l'avoir créée
    await pool.query("UPDATE instances SET vignette_dispensee = TRUE WHERE vignette_dispensee = FALSE"); // isolement du décompte
    const dossier = await creerDossier("contentieux");
    const inst = await creerInstance(dossier);
    expect(inst.status).toBe(201);
    const liste = await aAffecter();
    expect(liste.instances.map((i) => i.instance_id)).toContain(inst.body.id);
    const ligne = liste.instances.find((i) => i.instance_id === inst.body.id);
    expect(ligne.dossier_id).toBe(dossier);
    expect(ligne.mode_honoraires_renseigne).toBe(true);
    const n = (await notifs(gestionnaire.token, "vignette_a_affecter"));
    expect(n.some((x) => x.a_traiter && x.lien === `/dossiers/${dossier}`)).toBe(true);
    expect(n[0].texte).toMatch(/vignette de plaidoirie/);

    const conseil = await creerDossier("conseil");
    const inst2 = await creerInstance(conseil);
    expect((await aAffecter()).instances.map((i) => i.instance_id)).not.toContain(inst2.body.id);
  });

  test("le prochain numéro connu est proposé ; l'affecter retire l'instance de la liste et clôt l'alerte (jamais de décompte automatique)", async () => {
    const base = 6000000 + Math.floor(Math.random() * 300000);
    expect((await request(app).post("/api/depenses/vignettes").set(auth(associe)).send({ numeros: `${base}-${base + 2}` })).status).toBe(201);
    const stockAvant = (await request(app).get("/api/depenses/vignettes/stock").set(auth(associe))).body.stock;
    const gestionnaire = await creerUtilisateur("assistante");
    const dossier = await creerDossier();
    const inst = await creerInstance(dossier);
    const avant = await aAffecter();
    expect(avant.prochain_numero).not.toBeNull();
    // rien n'a été décompté tout seul
    expect((await request(app).get("/api/depenses/vignettes/stock").set(auth(associe))).body.stock).toBe(stockAvant);
    const r = await request(app).post(`/api/dossiers/${dossier}/instances/${inst.body.id}/vignette`).set(auth(associe)).send({ numero_vignette: avant.prochain_numero });
    expect(r.status).toBe(201);
    expect((await request(app).get("/api/depenses/vignettes/stock").set(auth(associe))).body.stock).toBe(stockAvant - 1);
    expect((await aAffecter()).instances.map((i) => i.instance_id)).not.toContain(inst.body.id);
    expect((await notifs(gestionnaire.token, "vignette_a_affecter")).every((x) => !x.a_traiter || x.lien !== `/dossiers/${dossier}`)).toBe(true);
  });

  test("dispense : l'instance sort de la liste ; rétablissement possible ; refusée si une vignette existe déjà", async () => {
    const dossier = await creerDossier();
    const inst = await creerInstance(dossier);
    const dispenser = (v) => request(app).post(`/api/dossiers/${dossier}/instances/${inst.body.id}/vignette-dispensee`).set(auth(associe)).send({ dispensee: v });
    expect((await dispenser(true)).status).toBe(200);
    expect((await aAffecter()).instances.map((i) => i.instance_id)).not.toContain(inst.body.id);
    expect((await dispenser(false)).status).toBe(200);
    expect((await aAffecter()).instances.map((i) => i.instance_id)).toContain(inst.body.id);
    const sans = await creerUtilisateur("archiviste");
    expect((await request(app).post(`/api/dossiers/${dossier}/instances/${inst.body.id}/vignette-dispensee`).set(auth(sans.token)).send({})).status).toBe(403);
  });
});

describe("Rappel et suivi", () => {
  test("rappel unique après 3 jours ouvrés sans vignette ; instances antérieures au début du suivi ignorées", async () => {
    const gestionnaire = await creerUtilisateur("assistante");
    const dossier = await creerDossier();
    const inst = await creerInstance(dossier);
    // un jour ouvré récent comme « maintenant » ; l'instance date de 10 jours avant (plus de 3 jours ouvrés)
    let mercredi = new Date();
    while ([0, 6].includes(mercredi.getUTCDay())) mercredi = new Date(mercredi.getTime() - 86400000);
    const avant = await pool.query("SELECT vignettes_suivi_depuis FROM parametres_cabinet WHERE id = 1");
    await pool.query("UPDATE parametres_cabinet SET vignettes_suivi_depuis = '2000-01-01' WHERE id = 1");
    await pool.query("UPDATE instances SET cree_le = $2::timestamptz WHERE id = $1", [inst.body.id, new Date(mercredi.getTime() - 10 * 86400000).toISOString()]);
    const b1 = await executerJobNotificationsRelances(pool, mercredi);
    expect(b1.vignettes).toBeGreaterThanOrEqual(1);
    // le rappel est fusionné dans la ligne « N procédures attendent leur vignette, dont N depuis plus de 3 jours » (jamais une 2e ligne)
    const ligne1 = await notifs(gestionnaire.token, "vignette_a_affecter");
    expect(ligne1).toHaveLength(1);
    expect(ligne1[0].texte).toMatch(/depuis plus de 3 jours/);
    await executerJobNotificationsRelances(pool, mercredi);
    expect(await notifs(gestionnaire.token, "vignette_a_affecter")).toHaveLength(1);
    await pool.query("UPDATE parametres_cabinet SET vignettes_suivi_depuis = $1 WHERE id = 1", [avant.rows[0].vignettes_suivi_depuis]);
    // antérieure au suivi : ignorée
    const ancien = await creerInstance(await creerDossier());
    await pool.query("UPDATE instances SET cree_le = '2020-01-01' WHERE id = $1", [ancien.body.id]);
    expect((await aAffecter()).instances.map((i) => i.instance_id)).not.toContain(ancien.body.id);

  });

  test("stock bas : une alerte d'information au franchissement du seuil, une seule fois par mois", async () => {
    const gestionnaire = await creerUtilisateur("assistante");
    const base = 7000000 + Math.floor(Math.random() * 200000);
    await request(app).post("/api/depenses/vignettes").set(auth(associe)).send({ numeros: `${base}-${base + 1}` });
    const stock = (await request(app).get("/api/depenses/vignettes/stock").set(auth(associe))).body.stock;
    await request(app).put("/api/parametres/honoraires").set(auth(associe)).send({ seuil_alerte_vignettes: stock + 100 });
    const dossier = await creerDossier();
    const inst = await creerInstance(dossier);
    const aff = await request(app).post(`/api/dossiers/${dossier}/instances/${inst.body.id}/vignette`).set(auth(associe)).send({ numero_vignette: base });
    expect(aff.status).toBe(201);
    // Lecture en base : la cloche de ce compte partagé ne montre que les 30 plus récentes.
    const moisCle = "stock:" + new Date().toISOString().slice(0, 7);
    const { rows } = await pool.query("SELECT niveau FROM notifications WHERE type = 'vignette_stock_bas' AND charge->>'ref' = $1 AND destinataire_id = $2", [moisCle, userId]);
    expect(rows.length).toBe(1); // une seule fois par mois et par personne
    expect(rows[0].niveau).toBe("information");
    // une 2e affectation le même mois ne renvoie rien
    const inst2 = await creerInstance(dossier);
    await request(app).post(`/api/dossiers/${dossier}/instances/${inst2.body.id}/vignette`).set(auth(associe)).send({ numero_vignette: base + 1 });
    const { rows: apres } = await pool.query("SELECT 1 FROM notifications WHERE type = 'vignette_stock_bas' AND charge->>'ref' = $1 AND destinataire_id = $2", [moisCle, userId]);
    expect(apres.length).toBe(1);
    await request(app).put("/api/parametres/honoraires").set(auth(associe)).send({ seuil_alerte_vignettes: 10 });
    expect(gestionnaire.token).toBeTruthy();
  });
});
