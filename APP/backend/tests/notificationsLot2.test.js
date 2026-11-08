// JURIA — centre de notifications, lot 2 (07/11/2026) : dépenses, petite caisse, états de charges, relances à 48 h ouvrées.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { SECRET } = require("../src/auth");
const { executerJobNotificationsRelances } = require("../src/jobs/notificationsRelances");
const { assurerUtilisateurTest, pool } = require("./setup");

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestL2123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','L2',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`L${sfx.slice(0, 7)}`, `test.l2.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test L2" }, SECRET, { expiresIn: "1h" }) };
}
const liste = async (u, q = "") => (await request(app).get("/api/notifications" + q).set(auth(u))).body;
const de = async (u, type) => (await liste(u)).filter((n) => n.type === type);
const mercredi = new Date("2026-11-11T08:00:00Z");
const NOMS_MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
// Mois lointain et aléatoire : les tests restent rejouables sur une base déjà utilisée (un état par mois, alertes « une fois »).
function moisAleatoire() {
  const annee = 2100 + Math.floor(Math.random() * 800), m = Math.floor(Math.random() * 12);
  let jour = 25;
  while ([0, 6].includes(new Date(Date.UTC(annee, m, jour)).getUTCDay())) jour++;
  return { iso: `${annee}-${String(m + 1).padStart(2, "0")}`, label: `${NOMS_MOIS[m]} ${annee}`, fin: new Date(Date.UTC(annee, m, jour, 8)) };
}

beforeAll(async () => { await assurerUtilisateurTest(); });
beforeEach(() => envoyerEmail.mockClear());
afterAll(async () => { await pool.end(); });

describe("Dépenses", () => {
  test("soumise → décideurs (jamais l'auteur) ; décidée → déposant (motif dans la cloche) + à décaisser ; décaissée → déposant", async () => {
    const adminG = await creer("admin_general"), assoc1 = await creer("associe"), assoc2 = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Fournitures L2", montant: 25000 });
    expect(r.status).toBe(201);
    const n1 = (await de(assoc1, "depense_soumise"))[0];
    expect(n1.a_traiter).toBe(true);
    expect(n1.texte).toBe("Une dépense attend votre décision.");
    expect(n1.texte).not.toMatch(/25000|Fournitures/);
    expect(n1.lien).toBe(`/depenses?depense=${r.body.id}`); // arrivée précise sur la dépense
    expect(await de(adminG, "depense_soumise")).toHaveLength(0);

    const d = await request(app).post(`/api/depenses/${r.body.id}/decision`).set(auth(assoc1)).send({ statut: "validee" });
    expect(d.status).toBe(200);
    expect((await de(assoc2, "depense_soumise"))[0].a_traiter).toBe(false);
    expect((await de(adminG, "depense_decidee"))[0].texte).toBe("Votre dépense a été validée.");
    expect((await de(assoc2, "depense_a_decaisser"))[0].a_traiter).toBe(true);
    expect(await de(assoc1, "depense_a_decaisser")).toHaveLength(0); // celui qui a validé n'est pas prévenu

    const dec = await request(app).post(`/api/depenses/${r.body.id}/decaisser`).set(auth(assoc2)).send({ mode_paiement: "especes" });
    expect(dec.status).toBe(200);
    expect((await de(assoc2, "depense_a_decaisser"))[0].a_traiter).toBe(false);
    expect((await de(adminG, "depense_decaissee"))).toHaveLength(1);
  });

  test("rejet avec motif : le motif est dans la cloche, jamais dans l'e-mail", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "À rejeter L2", montant: 1000 });
    await request(app).post(`/api/depenses/${r.body.id}/decision`).set(auth(assoc)).send({ statut: "rejetee", motif_rejet: "Hors budget" });
    expect((await de(adminG, "depense_decidee"))[0].texte).toBe("Votre dépense a été rejetée : « Hors budget ».");
    const { rows: [n] } = await pool.query("SELECT * FROM notifications WHERE destinataire_id = $1 AND type = 'depense_decidee'", [adminG.id]);
    const { composerTexte } = require("../src/notifications");
    expect(composerTexte(n)).toMatch(/Hors budget/);
    // texte de l'e-mail de repli : générique
    const repli = require("../src/jobs/notificationsRepli");
    expect(repli).toBeDefined();
  });

  test("retrait d'une dépense soumise : plus « à traiter »", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "À retirer L2", montant: 500 });
    expect((await de(assoc, "depense_soumise"))[0].a_traiter).toBe(true);
    expect((await request(app).delete(`/api/depenses/${r.body.id}`).set(auth(adminG))).status).toBe(204);
    expect((await de(assoc, "depense_soumise"))[0].a_traiter).toBe(false);
  });
});

describe("Petite caisse", () => {
  test("engagée → un autre associé valide après coup ; contestée → l'engageur est informé avec le motif", async () => {
    const adminG = await creer("admin_general"), assoc1 = await creer("associe"), assoc2 = await creer("associe");
    await request(app).put("/api/parametres/honoraires").set(auth(assoc1)).send({ petite_caisse_plafond_depense: 50000 });
    const mois = new Date().toISOString().slice(0, 8) + "01";
    await request(app).post("/api/depenses/petite-caisse").set(auth(assoc1)).send({ mois, montant_alloue: 100000000 });
    const e = await request(app).post("/api/depenses/engager").set(auth(adminG))
      .send({ libelle: "Eau L2", montant: 12000, mode_paiement: "orange_money", references: { id_transaction: "MP260101.0099" } });
    expect(e.status).toBe(201);
    expect((await de(assoc1, "depense_apres_coup"))[0].a_traiter).toBe(true);
    expect(await de(adminG, "depense_apres_coup")).toHaveLength(0);
    const c = await request(app).post(`/api/depenses/${e.body.id}/valider-apres-coup`).set(auth(assoc1)).send({ decision: "contestee", motif: "Pas de justificatif" });
    expect(c.status).toBe(200);
    expect((await de(assoc1, "depense_apres_coup"))[0].a_traiter).toBe(false);
    expect((await de(adminG, "depense_apres_coup_traitee"))[0].texte).toBe("Votre dépense engagée est contestée : « Pas de justificatif ».");
    expect((await de(assoc2, "depense_contestee"))).toHaveLength(1);
  });

  test("écart au rapprochement → les autres décideurs, jamais l'auteur", async () => {
    const assoc1 = await creer("associe"), assoc2 = await creer("associe");
    const r = await request(app).post("/api/depenses/petite-caisse/rapprochement").set(auth(assoc1)).send({ solde_reel: 1 });
    expect(r.status).toBe(201);
    expect((await de(assoc2, "caisse_alerte"))[0].texte).toBe("Un écart a été constaté au rapprochement de la petite caisse.");
    expect(await de(assoc1, "caisse_alerte")).toHaveLength(0);
  });
});

describe("États de charges", () => {
  test("soumis → décideurs ; lignes décidées regroupées pour le préparateur ; clos → préparateur ; rouvert → traité", async () => {
    const prep = await creer("admin_general"), assoc = await creer("associe"), assoc2 = await creer("associe");
    const M = moisAleatoire();
    const etat = await request(app).post("/api/charges/etats").set(auth(prep)).send({ mois: M.iso });
    expect(etat.status).toBe(201);
    const id = etat.body.id;
    const l1 = (await request(app).post(`/api/charges/etats/${id}/lignes`).set(auth(prep)).send({ libelle: "Peinture", categorie: "entretien", montant: 1000 })).body;
    const l2 = (await request(app).post(`/api/charges/etats/${id}/lignes`).set(auth(prep)).send({ libelle: "Ménage", categorie: "entretien", montant: 2000 })).body;
    // Retire les charges habituelles que le catalogue d'une base déjà utilisée a ajoutées d'office (test rejouable).
    for (const l of (await request(app).get(`/api/charges/etats/${id}`).set(auth(prep))).body.lignes) {
      if (![l1.id, l2.id].includes(l.id)) await request(app).delete(`/api/charges/etats/${id}/lignes/${l.id}`).set(auth(prep));
    }
    const s = await request(app).post(`/api/charges/etats/${id}/soumettre`).set(auth(prep));
    expect(s.status).toBe(200);
    const n = (await de(assoc, "etat_soumis"))[0];
    expect(n.texte).toBe(`L'état de charges de ${M.label} est soumis : des lignes attendent votre décision.`);
    expect(n.a_traiter).toBe(true);
    expect(n.lien).toBe(`/depenses/etat-charges?etat=${id}`); // arrivée précise sur l'état
    expect(await de(prep, "etat_soumis")).toHaveLength(0);

    await request(app).post(`/api/charges/etats/${id}/lignes/${l1.id}/decision`).set(auth(assoc)).send({ decision: "rejetee", motif: "Trop cher" });
    await request(app).post(`/api/charges/etats/${id}/lignes/${l2.id}/decision`).set(auth(assoc)).send({ decision: "reportee" });
    const regroupee = await de(prep, "etat_lignes_decidees");
    expect(regroupee).toHaveLength(1);
    expect(regroupee[0].nombre).toBe(2);
    expect(regroupee[0].texte).toBe(`2 lignes de l'état de charges de ${M.label} ont été décidées.`);

    // Base déjà utilisée : d'éventuelles charges habituelles restées en attente sont rejetées pour pouvoir clore.
    for (const l of (await request(app).get(`/api/charges/etats/${id}`).set(auth(assoc))).body.lignes) {
      if (l.decision === "en_attente") await request(app).post(`/api/charges/etats/${id}/lignes/${l.id}/decision`).set(auth(assoc)).send({ decision: "rejetee", motif: "x" });
    }
    const clos = await request(app).post(`/api/charges/etats/${id}/cloturer`).set(auth(assoc));
    expect(clos.body.error || clos.status).toBe(200);
    expect((await de(prep, "etat_clos"))).toHaveLength(1);
    expect((await de(assoc2, "etat_soumis"))[0].a_traiter).toBe(false);
  });

  test("réouverture avant décision : plus « à traiter » et les décideurs en sont informés", async () => {
    const prep = await creer("admin_general"), assoc = await creer("associe");
    const M = moisAleatoire();
    const id = (await request(app).post("/api/charges/etats").set(auth(prep)).send({ mois: M.iso })).body.id;
    await request(app).post(`/api/charges/etats/${id}/lignes`).set(auth(prep)).send({ libelle: "Eau", categorie: "entretien", montant: 100 });
    await request(app).post(`/api/charges/etats/${id}/soumettre`).set(auth(prep));
    expect((await request(app).post(`/api/charges/etats/${id}/rouvrir`).set(auth(prep))).status).toBe(200);
    expect((await de(assoc, "etat_soumis"))[0].a_traiter).toBe(false);
    expect((await de(assoc, "etat_rouvert"))[0].texte).toBe(`L'état de charges de ${M.label} a été rouvert par son préparateur.`);
  });
});

describe("Relances (job quotidien, cloche seulement)", () => {
  test("rien le week-end", async () => {
    expect(await executerJobNotificationsRelances(pool, new Date("2026-11-14T08:00:00Z"))).toEqual({ week_end: true });
  });

  test("dépense en attente depuis plus de 48 h ouvrées → récapitulatif remplacé chaque jour (jamais empilé) ; aucun e-mail", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Ancienne L2", montant: 700 });
    await pool.query("UPDATE depenses SET cree_le = now() - interval '10 days' WHERE id = $1", [r.body.id]);
    await executerJobNotificationsRelances(pool, mercredi);
    await executerJobNotificationsRelances(pool, mercredi);
    const l = await de(assoc, "depenses_en_attente");
    expect(l).toHaveLength(1);
    expect(l[0].niveau).toBe("critique");
    expect(l[0].texte).toMatch(/attend(ent)? votre décision depuis plus de 48 heures/);
    expect(envoyerEmail).not.toHaveBeenCalled();
  });

  test("tâche en retard : cloche au responsable (une fois), escalade à celui qui l'a confiée après 48 h ouvrées (une fois)", async () => {
    const chef = await creer("associe"), x = await creer("collaborateur");
    const t = await request(app).post("/api/taches").set(auth(chef)).send({ titre: "En retard L2", responsable_id: x.id, echeance: "2026-01-05" });
    expect(t.status).toBe(201);
    await executerJobNotificationsRelances(pool, mercredi);
    await executerJobNotificationsRelances(pool, mercredi);
    expect(await de(x, "tache_retard")).toHaveLength(1);
    const esc = await de(chef, "tache_escalade".replace("tache_escalade", "tache_retard_escalade"));
    expect(esc).toHaveLength(1);
    expect(esc[0].texte).toMatch(/en retard depuis plus de 48 heures/);
    // la tâche terminée n'est plus « à traiter »
    await request(app).put(`/api/taches/${t.body.id}`).set(auth(x)).send({ statut: "termine" });
    expect((await de(x, "tache_retard"))[0].a_traiter).toBe(false);
    expect((await de(chef, "tache_retard_escalade"))[0].a_traiter).toBe(false);
  });

  test("état de charges à soumettre à partir du 25 : une fois par mois pour l'administration générale", async () => {
    const adminG = await creer("admin_general");
    // Base de test : les anciens comptes de test « administration générale » sont mis de côté (le job les prévient tous).
    await pool.query("UPDATE utilisateurs SET actif = FALSE WHERE role = 'admin_general' AND id <> $1", [adminG.id]);
    const M = moisAleatoire();
    await executerJobNotificationsRelances(pool, M.fin);
    await executerJobNotificationsRelances(pool, M.fin);
    const l = await de(adminG, "etat_a_soumettre");
    expect(l).toHaveLength(1);
    expect(l[0].texte).toBe(`L'état de charges de ${M.label} est à soumettre aux associés.`);
  }, 60000);
});
