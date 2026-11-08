// JURIA — centre de notifications, lot 1 (07/11/2026) : création, regroupement, droits de lecture, diligences, tâches,
// relance, conflits, délais de procédure, e-mail de repli.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { SECRET } = require("../src/auth");
const notif = require("../src/notifications");
const { executerJobAlertesDelais } = require("../src/jobs/alertesDelais");
const { executerJobNotificationsRepli } = require("../src/jobs/notificationsRepli");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; // compte de référence
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

async function creer(role, nom = "Notif") {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestNotif123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test',$2,$3,$4,$5::role_utilisateur,TRUE,now()) RETURNING id`,
    [`N${sfx.slice(0, 7)}`, nom, `test.nc.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, nom: "Test " + nom, email: `test.nc.${sfx}@jfcavocats-mali.com`,
           token: jwt.sign({ sub: rows[0].id, role, nom: "Test " + nom }, SECRET, { expiresIn: "1h" }) };
}
const liste = async (u, q = "") => (await request(app).get("/api/notifications" + q).set(auth(u))).body;
const compteur = async (u) => (await request(app).get("/api/notifications/compteur").set(auth(u))).body;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  associe = { id: login.body.utilisateur.id, role: "associe", nom: "Test Régression", token: login.body.token };
});
beforeEach(() => envoyerEmail.mockClear());
afterAll(async () => { await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = FALSE WHERE id = 1"); await pool.end(); });

describe("notifier() et lecture", () => {
  test("une ligne par destinataire, jamais l'auteur, texte composé sans donnée sensible", async () => {
    const a = await creer("collaborateur"), b = await creer("collaborateur"), auteur = await creer("associe");
    const crees = await notif.notifier({ type: "tache_assignee", destinataires: [a.id, b.id, auteur.id, a.id, null], auteurId: auteur.id, ref: "ref-1", aTraiter: true, charge: { dossier: "CX-CIV-2026-0001" } });
    expect(crees).toHaveLength(2);
    const l = await liste(a);
    expect(l).toHaveLength(1);
    expect(l[0].texte).toMatch(/Une tâche vous est confiée — dossier CX-CIV-2026-0001/);
    expect(l[0].a_traiter).toBe(true);
    expect(await liste(auteur)).toHaveLength(0);
  });

  test("regroupement : même clé non lue → une seule ligne qui compte", async () => {
    const a = await creer("associe");
    for (let i = 1; i <= 3; i++) await notif.notifier({ type: "dossier_cree", destinataires: [a.id], cle: "dossiers_crees:test", charge: { dossier: "D" + i } });
    let l = await liste(a);
    expect(l).toHaveLength(1);
    expect(l[0].nombre).toBe(3);
    expect(l[0].lien).toBe("/dossiers"); // groupe : liste des dossiers (pas une fiche précise)
    expect(l[0].texte).toBe("3 nouveaux dossiers ont été créés aujourd'hui.");
    // une fois lue, un nouvel événement ouvre une nouvelle ligne
    await request(app).post(`/api/notifications/${l[0].id}/lue`).set(auth(a));
    await notif.notifier({ type: "dossier_cree", destinataires: [a.id], cle: "dossiers_crees:test", charge: { dossier: "D4" } });
    l = await liste(a);
    expect(l).toHaveLength(2);
  });

  test("compteur, filtres, tout-lire ; on ne lit jamais la notification d'un autre", async () => {
    const a = await creer("juriste"), b = await creer("juriste");
    await notif.notifier({ type: "tache_assignee", destinataires: [a.id], ref: "r2", aTraiter: true });
    await notif.notifier({ type: "diligence_modifiee", destinataires: [a.id], charge: { statut: "reporte" } });
    expect(await compteur(a)).toEqual({ non_lues: 2, a_traiter: 1 });
    expect(await liste(a, "?filtre=a_traiter")).toHaveLength(1);
    const [premiere] = await liste(a);
    const intrus = await request(app).post(`/api/notifications/${premiere.id}/lue`).set(auth(b));
    expect(intrus.status).toBe(404);
    expect((await compteur(a)).non_lues).toBe(2);
    await request(app).post("/api/notifications/tout-lire").set(auth(a));
    expect(await compteur(a)).toEqual({ non_lues: 0, a_traiter: 1 });
    expect(await liste(a, "?filtre=non_lues")).toHaveLength(0);
  });

  test("filtre par niveau : la bannière ne reçoit que les urgences encore « à traiter »", async () => {
    const a = await creer("associe");
    await notif.notifier({ type: "conflit_a_decider", destinataires: [a.id], ref: "u1", aTraiter: true });
    await notif.notifier({ type: "tache_assignee", destinataires: [a.id], ref: "u2", aTraiter: true });
    await notif.notifier({ type: "diligence_modifiee", destinataires: [a.id], charge: { statut: "annule" } });
    const urgences = await liste(a, "?filtre=a_traiter&niveau=critique");
    expect(urgences).toHaveLength(1);
    expect(urgences[0].type).toBe("conflit_a_decider");
    await notif.traiter("conflit_a_decider", "u1");
    expect(await liste(a, "?filtre=a_traiter&niveau=critique")).toHaveLength(0);
  });

  test("traiter() retire la marque « à traiter »", async () => {
    const a = await creer("juriste");
    await notif.notifier({ type: "tache_assignee", destinataires: [a.id], ref: "r3", aTraiter: true });
    expect(await notif.traiter("tache_assignee", "r3")).toBe(1);
    expect((await compteur(a)).a_traiter).toBe(0);
  });

  test("heures ouvrées : le week-end ne compte pas", () => {
    expect(notif.heuresOuvrees("2026-11-06T18:00:00Z", "2026-11-09T02:00:00Z")).toBe(8); // vendredi → lundi
    expect(notif.heuresOuvrees("2026-11-09T08:00:00Z", "2026-11-09T12:00:00Z")).toBe(4);
  });
});

describe("Diligences", () => {
  test("assignation → cloche du membre ; faite → plus « à traiter » ; reportée → information", async () => {
    const membre = await creer("collaborateur"), chef = await creer("associe");
    const r = await request(app).post("/api/diligences").set(auth(chef)).send({ date_diligence: "2026-12-01", membre_id: membre.id, objet: "Formalité" });
    expect(r.status).toBe(201);
    let l = await liste(membre);
    expect(l[0].type).toBe("diligence_assignee");
    expect(l[0].lien).toBe(`/role-audience?diligence=${r.body.id}`); // arrivée précise sur la diligence
    expect(l[0].a_traiter).toBe(true);
    expect(await liste(chef, "?filtre=a_traiter")).not.toContainEqual(expect.objectContaining({ type: "diligence_assignee" }));
    const rep = await request(app).put(`/api/diligences/${r.body.id}/statut`).set(auth(chef)).send({ statut: "reporte" });
    expect(rep.status).toBe(200);
    l = await liste(membre);
    expect(l.map((n) => n.type)).toEqual(expect.arrayContaining(["diligence_modifiee"]));
    expect(l.find((n) => n.type === "diligence_assignee").a_traiter).toBe(false);
  });

  test("auto-assignation : aucune notification", async () => {
    const avant = (await compteur(associe)).non_lues;
    await request(app).post("/api/diligences").set(auth(associe)).send({ date_diligence: "2026-12-02", membre_id: associe.id });
    expect((await compteur(associe)).non_lues).toBe(avant);
  });
});

describe("Tâches et relance", () => {
  test("tâche confiée → cloche ; réaffectation ; terminée → plus « à traiter »", async () => {
    const x = await creer("collaborateur"), y = await creer("collaborateur"), chef = await creer("associe");
    const t = await request(app).post("/api/taches").set(auth(chef)).send({ titre: "Conclusions", responsable_id: x.id });
    expect(t.status).toBe(201);
    expect((await liste(x))[0].type).toBe("tache_assignee");
    expect((await liste(x))[0].lien).toBe(`/plan-action?tache=${t.body.id}`); // arrivée précise sur la carte
    const re = await request(app).put(`/api/taches/${t.body.id}/details`).set(auth(chef)).send({ responsable_id: y.id });
    expect(re.status).toBe(200);
    expect((await liste(x))[0].a_traiter).toBe(false);
    expect((await liste(y))[0].a_traiter).toBe(true);
    await request(app).put(`/api/taches/${t.body.id}`).set(auth(y)).send({ statut: "termine" });
    expect((await liste(y))[0].a_traiter).toBe(false);
  });

  test("relance : créateur autorisé, trace, une seule toutes les 4 h, refus du tiers et de soi-même", async () => {
    const x = await creer("collaborateur"), tiers = await creer("collaborateur"), chef = await creer("associe");
    const t = await request(app).post("/api/taches").set(auth(chef)).send({ titre: "À relancer", responsable_id: x.id });
    const id = t.body.id;
    expect((await request(app).post(`/api/taches/${id}/relancer`).set(auth(tiers)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/taches/${id}/relancer`).set(auth(x)).send({})).status).toBe(400);
    const ok = await request(app).post(`/api/taches/${id}/relancer`).set(auth(chef)).send({ mot: "Pour demain svp" });
    expect(ok.status).toBe(200);
    const n = (await liste(x)).find((m) => m.type === "relance_action");
    expect(n.texte).toMatch(/vous relance sur une tâche/);
    expect(n.texte).toMatch(/Pour demain svp/);
    expect((await request(app).post(`/api/taches/${id}/relancer`).set(auth(chef)).send({})).status).toBe(429);
    const trace = await pool.query("SELECT 1 FROM journal_audit WHERE action = 'relancer_action' AND entite_id = $1", [id]);
    expect(trace.rowCount).toBe(1);
  });
});

describe("Conflits d'intérêts", () => {
  test("potentiel → décideurs ; décision → plus « à traiter » + demandeur informé", async () => {
    const decideur = await creer("associe"), demandeur = await creer("collaborateur");
    const nom = "ZORBAX" + Math.random().toString(36).slice(2, 6).toUpperCase();
    await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', $1)", [nom]);
    const c = await request(app).post("/api/conflict-checks").set(auth(demandeur)).send({ intitule_projet: "Test", noms: nom });
    expect(c.status).toBe(201);
    expect(c.body.resultat).toBe("potentiel");
    const n = (await liste(decideur)).find((m) => m.type === "conflit_a_decider");
    expect(n).toBeTruthy();
    expect(n.niveau).toBe("critique");
    expect(n.lien).toBe(`/conflits?id=${c.body.id}`);
    expect(await liste(demandeur)).toHaveLength(0); // jamais l'auteur
    const d = await request(app).post(`/api/conflict-checks/${c.body.id}/decision`).set(auth(decideur)).send({ decision: "accepte" });
    expect(d.status).toBe(200);
    expect((await liste(decideur)).find((m) => m.type === "conflit_a_decider").a_traiter).toBe(false);
    expect((await liste(demandeur))[0].texte).toMatch(/accepté/);
  });
});

describe("Création de dossier", () => {
  test("un non-associé crée deux dossiers : l'associé reçoit UNE notification regroupée, le créateur aucune", async () => {
    const collab = await creer("collaborateur"), destinataire = await creer("associe");
    await pool.query("UPDATE notifications SET lue_le = now() WHERE lue_le IS NULL");
    const cl = await request(app).post("/api/clients").set(auth(associe)).send({ type: "morale", denomination: "Client regroupement " + Date.now() });
    for (let i = 0; i < 2; i++) {
      const r = await request(app).post("/api/dossiers").set(auth(collab)).send({
        client_id: cl.body.id, responsable_id: associe.id, intitule: "Dossier regroupé", pole: "contentieux", matiere: "Droit civil",
        mode_honoraires: "forfait", urgence: "moyenne" });
      expect(r.status).toBe(201);
    }
    const l = (await liste(destinataire)).filter((n) => n.type === "dossier_cree");
    expect(l).toHaveLength(1);
    expect(l[0].nombre).toBe(2);
    expect(await liste(collab)).toHaveLength(0);
  });
});

describe("Délais de procédure", () => {
  test("jalon J-7 : responsable + associés, niveau action ; terminé → plus « à traiter »", async () => {
    const resp = await creer("collaborateur");
    const cl = await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', 'Client délai test') RETURNING id");
    const num = "DLT-" + Math.random().toString(36).slice(2, 7).toUpperCase();
    const d = await pool.query(
      `INSERT INTO dossiers (numero, intitule, client_id, pole, responsable_id)
       VALUES ($1,'Dossier délai',$2,(SELECT unnest(enum_range(NULL::pole_cabinet)) LIMIT 1),$3) RETURNING id`, [num, cl.rows[0].id, resp.id]);
    const ev = await pool.query(
      `INSERT INTO evenements (dossier_id, type, titre, date_echeance, responsable_id, alerte_j30, alerte_j15)
       VALUES ($1,'delai_procedure','Appel', now() + interval '5 days', $2, TRUE, TRUE) RETURNING id`, [d.rows[0].id, resp.id]);
    await executerJobAlertesDelais(pool);
    const n = (await liste(resp)).find((m) => m.type === "delai_procedure");
    expect(n.texte).toMatch(new RegExp(`dans [45] jours? — dossier ${num}`));
    expect(n.niveau).toBe("action");
    expect((await liste(associe)).some((m) => m.type === "delai_procedure" && m.texte.includes(num))).toBe(true);
    expect(envoyerEmail).not.toHaveBeenCalled(); // interrupteur général éteint par défaut
    await pool.query("UPDATE evenements SET statut = 'traite' WHERE id = $1", [ev.rows[0].id]);
    await executerJobAlertesDelais(pool);
    expect((await liste(resp)).find((m) => m.type === "delai_procedure").a_traiter).toBe(false);
  });
});

describe("E-mail de repli", () => {
  const mercredi = new Date("2026-11-11T12:00:00Z");
  test("interrupteur éteint : aucun e-mail", async () => {
    const u = await creer("collaborateur");
    await notif.notifier({ type: "tache_assignee", destinataires: [u.id], ref: "rp0", aTraiter: true });
    await pool.query("UPDATE notifications SET cree_le = '2026-11-10T00:00:00Z' WHERE destinataire_id = $1", [u.id]);
    expect(await executerJobNotificationsRepli(pool, mercredi)).toMatchObject({ actif: false });
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  test("allumé : un seul e-mail groupé par personne, seulement pour le non lu échu ; jamais deux fois", async () => {
    const u = await creer("collaborateur"), v = await creer("collaborateur");
    await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = TRUE WHERE id = 1");
    // isolement : les notifications des autres tests de la base ne comptent pas ici
    await pool.query("UPDATE notifications SET lue_le = now() WHERE lue_le IS NULL");
    await notif.notifier({ type: "tache_assignee", destinataires: [u.id, v.id], ref: "rp1", aTraiter: true });
    await notif.notifier({ type: "diligence_assignee", destinataires: [u.id], ref: "rp2", aTraiter: true, charge: { dossier: "X-1" } });
    await notif.notifier({ type: "diligence_modifiee", destinataires: [u.id], charge: { statut: "annule" } }); // pas de repli pour ce type
    await pool.query("UPDATE notifications SET cree_le = '2026-11-10T00:00:00Z' WHERE destinataire_id = ANY($1::uuid[])", [[u.id, v.id]]);
    // v a déjà lu la sienne : pas d'e-mail pour lui
    await pool.query("UPDATE notifications SET lue_le = now() WHERE destinataire_id = $1", [v.id]);
    const r = await executerJobNotificationsRepli(pool, mercredi);
    expect(r.envoyes).toBe(1);
    expect(envoyerEmail).toHaveBeenCalledTimes(1);
    const mail = envoyerEmail.mock.calls[0][0];
    expect(mail.to).toBe(u.email);
    expect(mail.subject).toMatch(/2 notifications/);
    expect(mail.html).not.toMatch(/Notif/); // pas de nom
    expect((await executerJobNotificationsRepli(pool, mercredi)).envoyes).toBe(0);
    // pas d'e-mail le week-end
    expect(await executerJobNotificationsRepli(pool, new Date("2026-11-14T12:00:00Z"))).toMatchObject({ week_end: true, envoyes: 0 });
    await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = FALSE WHERE id = 1");
  });
});
