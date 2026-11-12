// JURIA — revue des notifications du 12/11/2026 : moteur (remplacer / maj / décompte), « Marquer comme traitée », relances,
// bulle neutre, intégrité du catalogue, jobs (veille, cabinet en retard, stock, vignettes), aucun e-mail de repli.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { SECRET } = require("../src/auth");
const notif = require("../src/notifications");
const { executerJobNotificationsRelances } = require("../src/jobs/notificationsRelances");
const { assurerUtilisateurTest, pool } = require("./setup");

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
async function creer(role, nom = "Rev") {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestRev123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test',$2,$3,$4,$5::role_utilisateur,TRUE,now()) RETURNING id`,
    [`V${sfx.slice(0, 7)}`, nom, `test.rv.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, nom: "Test " + nom, token: jwt.sign({ sub: rows[0].id, role, nom: "Test " + nom }, SECRET, { expiresIn: "1h" }) };
}
const liste = async (u, q = "") => (await request(app).get("/api/notifications" + q).set(auth(u))).body;
const de = async (u, type) => (await liste(u)).filter((n) => n.type === type);
const mercredi = new Date("2026-11-11T08:00:00Z");

beforeAll(async () => { await assurerUtilisateurTest(); });
beforeEach(() => envoyerEmail.mockClear());
afterAll(async () => { await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = FALSE WHERE id = 1"); await pool.end(); });

describe("Catalogue : intégrité", () => {
  test("aucun e-mail de repli automatique ; chaque type a un niveau et un lien", () => {
    for (const [type, def] of Object.entries(notif.CATALOGUE)) {
      expect(["information", "action", "critique"]).toContain(def.niveau);
      expect(def.repliHeures).toBeUndefined();
      expect(typeof def.lien).toBe("function");
      expect(typeof def.texte).toBe("function");
      if (def.bulle) expect(def.texteBulle).toBeTruthy();
      expect(type).not.toBe("depense_contestee"); // notification 18 supprimée
    }
  });

  test("bulle du système : texte NEUTRE (aucun chiffre, aucun montant), seulement pour les situations graves", () => {
    const avecBulle = Object.entries(notif.CATALOGUE).filter(([, d]) => d.bulle).map(([t]) => t).sort();
    expect(avecBulle).toEqual(["conflit_a_decider", "delai_procedure", "depense_soumise", "tache_retard_escalade"]);
    for (const t of avecBulle) {
      const texte = notif.composerTexteBulle({ type: t, charge: { montant: 12500, dossier: "CX-CIV-2026-0001", jours: 3 }, nombre: 3 });
      expect(texte).not.toMatch(/\d/);
      expect(texte).not.toMatch(/FCFA|dossier/i);
    }
    expect(notif.composerTexteBulle({ type: "etat_clos", charge: {}, nombre: 1 })).toBeNull(); // pas de bulle pour une information
  });

  test("nomAffiche : « Me X » pour un avocat, le nom seul sinon", () => {
    expect(notif.nomAffiche({ nom: "Test Rev", role: "associe" })).toBe("Me Test Rev");
    expect(notif.nomAffiche({ nom: "Aïcha Dem", role: "admin_general" })).toBe("Aïcha Dem");
    expect(notif.nomAffiche({ nom: "Me Test Rev", role: "collaborateur" })).toBe("Me Test Rev");
  });
});

describe("Moteur : remplacer, maj, décompte, traitée", () => {
  test("remplacer : une relance REMPLACE la ligne même déjà lue (remise en non lue, remontée en tête), jamais une 2e ligne", async () => {
    const u = await creer("associe");
    await notif.notifier({ type: "tache_assignee", destinataires: [u.id], ref: "m1", cle: "action:m1", mode: "remplacer", aTraiter: true, charge: { par: "Me X" } });
    const [l1] = await de(u, "tache_assignee");
    await pool.query("UPDATE notifications SET lue_le = now(), cree_le = now() - interval '2 days' WHERE id = $1", [l1.id]);
    await notif.notifier({ type: "relance_action", destinataires: [u.id], ref: "m1", cle: "action:m1", mode: "remplacer", aTraiter: true, charge: { cible: "tache", par: "Me X" } });
    const toutes = await liste(u);
    expect(toutes.filter((n) => ["tache_assignee", "relance_action"].includes(n.type))).toHaveLength(1);
    const [l2] = await de(u, "relance_action");
    expect(l2.id).toBe(l1.id);
    expect(l2.lue_le).toBeNull();
    expect(new Date(l2.cree_le).getTime()).toBeGreaterThan(Date.now() - 60000);
  });

  test("maj : met à jour la ligne ouverte SANS la remettre en non lue ni la remonter ; sans ligne, ne crée rien", async () => {
    const u = await creer("associe");
    expect(await notif.notifier({ type: "etat_soumis", destinataires: [u.id], cle: "etat_soumis:zz", mode: "maj", charge: { mois: "2026-11", total: 3, decidees: 1 } })).toHaveLength(0);
    await notif.notifier({ type: "etat_soumis", destinataires: [u.id], cle: "etat_soumis:zz", mode: "remplacer", aTraiter: true, charge: { mois: "2026-11", total: 3, decidees: 0 } });
    const [l] = await de(u, "etat_soumis");
    await pool.query("UPDATE notifications SET lue_le = now() WHERE id = $1", [l.id]);
    await notif.notifier({ type: "etat_soumis", destinataires: [u.id], cle: "etat_soumis:zz", mode: "maj", charge: { mois: "2026-11", total: 3, decidees: 2 } });
    const [m] = await de(u, "etat_soumis");
    expect(m.lue_le).not.toBeNull();
    expect(m.texte).toMatch(/2 lignes sur 3 décidées/);
  });

  test("décompte : « N … » mis à jour par personne, chaque personne a son propre compte, fermé à zéro", async () => {
    const a = await creer("associe"), b = await creer("associe");
    const compteur = (n) => async (id) => ({ n: id === a.id ? n : n + 1 });
    await notif.decompte({ type: "depense_soumise", cle: "dec-test", destinataires: [a.id, b.id], compteur: compteur(2) });
    expect((await de(a, "depense_soumise"))[0].texte).toBe("2 dépenses attendent votre décision.");
    expect((await de(b, "depense_soumise"))[0].texte).toBe("3 dépenses attendent votre décision.");
    await notif.decompte({ type: "depense_soumise", cle: "dec-test", destinataires: [a.id, b.id], compteur: async () => ({ n: 0 }) });
    expect((await de(a, "depense_soumise"))[0].a_traiter).toBe(false);
    expect((await de(b, "depense_soumise"))[0].a_traiter).toBe(false);
  });

  test("traiter() avec « déjà … par » : la ligne se transforme, « par vous » pour celui qui a agi", async () => {
    const a = await creer("associe"), b = await creer("associe");
    await notif.notifier({ type: "conflit_a_decider", destinataires: [a.id, b.id], ref: "cf1", cle: "conflit:cf1", aTraiter: true });
    await notif.traiter("conflit_a_decider", "cf1", undefined, { par: "Me Test Rev", par_id: a.id, decision: "refuse" });
    expect((await de(a, "conflit_a_decider"))[0].texte).toBe("Tranché par vous : refusé.");
    expect((await de(b, "conflit_a_decider"))[0].texte).toBe("Déjà tranché par Me Test Rev : refusé.");
  });

  test("« Marquer comme traitée » : seulement une notification d'ACTION à soi ; jamais le niveau critique, ni celle d'un autre", async () => {
    const a = await creer("associe"), autre = await creer("associe");
    await notif.notifier({ type: "tache_veille", destinataires: [a.id], ref: "mt1", aTraiter: true });
    await notif.notifier({ type: "tache_retard_escalade", destinataires: [a.id], ref: "mt2", aTraiter: true });
    const [action] = await de(a, "tache_veille"), [critique] = await de(a, "tache_retard_escalade");
    expect((await request(app).post(`/api/notifications/${action.id}/traitee`).set(auth(autre))).status).toBe(404);
    expect((await request(app).post(`/api/notifications/${critique.id}/traitee`).set(auth(a))).status).toBe(409);
    expect((await request(app).post(`/api/notifications/${action.id}/traitee`).set(auth(a))).status).toBe(200);
    expect((await de(a, "tache_veille"))[0].a_traiter).toBe(false);
    expect((await de(a, "tache_retard_escalade"))[0].a_traiter).toBe(true);
  });
});

describe("Tâches : nom de celui qui confie, relance qui remplace, e-mail à la demande", () => {
  test("tâche confiée : « Me X vous confie une tâche » ; la relance remplace la ligne ; e-mail seulement si demandé ET interrupteur allumé", async () => {
    const chef = await creer("associe", "Chef"), x = await creer("collaborateur");
    const t = await request(app).post("/api/taches").set(auth(chef)).send({ titre: "À rendre", responsable_id: x.id });
    expect((await de(x, "tache_assignee"))[0].texte).toBe("Me Test Chef vous confie une tâche.");
    // interrupteur éteint : la case e-mail ne fait rien
    expect((await request(app).post(`/api/taches/${t.body.id}/relancer`).set(auth(chef)).send({ email: true })).status).toBe(200);
    expect(envoyerEmail).not.toHaveBeenCalled();
    const apres = await liste(x);
    expect(apres.filter((n) => ["tache_assignee", "relance_action"].includes(n.type))).toHaveLength(1);
    expect(apres.find((n) => n.type === "relance_action").texte).toMatch(/^Me Test Chef vous relance sur une tâche/);
    // interrupteur allumé : e-mail générique, sans nom ni contenu
    await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = TRUE WHERE id = 1");
    await pool.query("DELETE FROM journal_audit WHERE action = 'relancer_action' AND entite_id = $1", [t.body.id]);
    expect((await request(app).post(`/api/taches/${t.body.id}/relancer`).set(auth(chef)).send({ email: true })).status).toBe(200);
    expect(envoyerEmail).toHaveBeenCalledTimes(1);
    expect(envoyerEmail.mock.calls[0][0].html).not.toMatch(/Chef/);
    await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = FALSE WHERE id = 1");
  });
});

describe("Conflit : « Relancer les associés »", () => {
  test("créateur seul, tant qu'en attente ; la relance remplace la ligne ; une relance toutes les 4 h", async () => {
    const decideur = await creer("associe"), demandeur = await creer("collaborateur"), tiers = await creer("collaborateur");
    const nom = "KORVEX" + Math.random().toString(36).slice(2, 6).toUpperCase();
    await pool.query("INSERT INTO clients (type, denomination) VALUES ('morale', $1)", [nom]);
    const c = await request(app).post("/api/conflict-checks").set(auth(demandeur)).send({ intitule_projet: "Relance", noms: nom });
    expect(c.body.resultat).toBe("potentiel");
    await pool.query("UPDATE notifications SET lue_le = now() WHERE destinataire_id = $1", [decideur.id]);
    expect((await request(app).post(`/api/conflict-checks/${c.body.id}/relancer-associes`).set(auth(tiers)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/conflict-checks/${c.body.id}/relancer-associes`).set(auth(demandeur)).send({})).status).toBe(200);
    const l = await de(decideur, "conflit_a_decider");
    expect(l).toHaveLength(1); // jamais plus d'une ligne par objet et par personne
    expect(l[0].lue_le).toBeNull();
    expect(l[0].texte).toBe("Un contrôle de conflit d'intérêts attend votre décision."); // texte générique, sans noms
    expect((await request(app).post(`/api/conflict-checks/${c.body.id}/relancer-associes`).set(auth(demandeur)).send({})).status).toBe(429);
    await request(app).post(`/api/conflict-checks/${c.body.id}/decision`).set(auth(decideur)).send({ decision: "refuse" });
    expect((await request(app).post(`/api/conflict-checks/${c.body.id}/relancer-associes`).set(auth(demandeur)).send({})).status).toBe(409); // déjà tranché
    const resultat = (await de(demandeur, "conflit_tranche"))[0];
    expect(resultat.texte).toBe("Me Test Rev a tranché : refusé.");
    expect(resultat.lien).toBe(`/conflits?id=${c.body.id}`); // refusé : registre des conflits (contrôle précis)
  });
});

describe("Jobs : veille, tâches du cabinet en retard, stock, un seul rappel", () => {
  test("tâche : rappel la veille de l'échéance (une fois) ; tâches du cabinet en retard : UNE ligne d'information par associé", async () => {
    const chef = await creer("associe"), x = await creer("collaborateur");
    const t = await request(app).post("/api/taches").set(auth(chef)).send({ titre: "Demain", responsable_id: x.id, echeance: "2026-11-12" });
    expect(t.status).toBe(201);
    await executerJobNotificationsRelances(pool, mercredi);
    await executerJobNotificationsRelances(pool, mercredi);
    const veille = await de(x, "tache_veille");
    expect(veille).toHaveLength(1);
    expect(veille[0].texte).toBe("Une tâche arrive à échéance demain.");
    const retard = await request(app).post("/api/taches").set(auth(chef)).send({ titre: "Vieille", responsable_id: x.id, echeance: "2026-11-02" });
    expect(retard.status).toBe(201);
    await executerJobNotificationsRelances(pool, mercredi);
    await executerJobNotificationsRelances(pool, mercredi);
    const cab = await de(chef, "taches_cabinet_retard");
    expect(cab).toHaveLength(1);
    expect(cab[0].niveau).toBe("information");
    expect(cab[0].texte).toMatch(/en retard depuis plus de 48 heures\.$/);
    expect(cab[0].lien).toBe("/plan-action?filtre=retard");
    expect(await de(x, "taches_cabinet_retard")).toHaveLength(0); // réservé aux associés
  }, 60000);

  test("dépenses à décaisser sans suite après 3 jours ouvrés : rappel regroupé aux exécutants ET aux associés", async () => {
    await pool.query("UPDATE depenses SET statut = 'decaissee'::statut_depense WHERE statut = 'validee'");
    await pool.query("UPDATE depenses SET statut = 'rejetee'::statut_depense WHERE statut = 'soumise'");
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Ancienne à décaisser", montant: 4000 });
    await request(app).post(`/api/depenses/${r.body.id}/decision`).set(auth(assoc)).send({ statut: "validee", mode_paiement: "especes" });
    await pool.query("UPDATE depenses SET ordre_paiement_le = now() - interval '10 days' WHERE id = $1", [r.body.id]);
    await executerJobNotificationsRelances(pool, mercredi);
    const exec = await de(adminG, "depenses_a_decaisser");
    const suppleant = await de(assoc, "depenses_a_decaisser");
    expect(exec).toHaveLength(1);
    expect(suppleant).toHaveLength(1);
    expect(exec[0].texte).toMatch(/depuis \d+ jours?\.$/);
    expect(exec[0].niveau).toBe("action");
  }, 60000);

  test("e-mail : le job de relances n'envoie jamais d'e-mail, même interrupteur allumé", async () => {
    await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = TRUE WHERE id = 1");
    await executerJobNotificationsRelances(pool, mercredi);
    expect(envoyerEmail).not.toHaveBeenCalled();
    await pool.query("UPDATE parametres_cabinet SET notifications_email_actif = FALSE WHERE id = 1");
  });
});
