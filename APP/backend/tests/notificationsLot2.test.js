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
// Les notifications « décompte » comptent toutes les dépenses en attente de la base : on isole chaque test de ce qui reste des autres.
const isoler = async () => {
  await pool.query("UPDATE depenses SET statut = 'rejetee'::statut_depense WHERE statut = 'soumise'");
  await pool.query("UPDATE depenses SET statut = 'decaissee'::statut_depense WHERE statut = 'validee'");
};
beforeEach(() => envoyerEmail.mockClear());
afterAll(async () => { await pool.end(); });

describe("Dépenses", () => {
  test("soumise → décideurs (jamais l'auteur) ; décidée avec ordre de paiement → déposant (motif dans la cloche) + à décaisser ; décaissée → déposant", async () => {
    await isoler();
    const adminG = await creer("admin_general"), assoc1 = await creer("associe"), assoc2 = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Fournitures L2", montant: 25000 });
    expect(r.status).toBe(201);
    const n1 = (await de(assoc1, "depense_soumise"))[0];
    expect(n1.a_traiter).toBe(true);
    expect(n1.texte).toBe("Une dépense attend votre décision.");
    expect(n1.texte).not.toMatch(/25000|Fournitures/);
    expect(n1.lien).toBe(`/depenses?depense=${r.body.id}`); // arrivée précise sur la dépense
    expect(await de(adminG, "depense_soumise")).toHaveLength(0);

    const d = await request(app).post(`/api/depenses/${r.body.id}/decision`).set(auth(assoc1)).send({ statut: "validee", mode_paiement: "especes" });
    expect(d.status).toBe(200);
    expect(n1.texte_bulle).toBe("Des dépenses attendent votre décision."); // bulle neutre : ni montant ni libellé
    // les autres décideurs : « Déjà décidée par Me X » ; celui qui a décidé : « Décidée par vous »
    const autre = (await de(assoc2, "depense_soumise"))[0];
    expect(autre.a_traiter).toBe(false);
    expect(autre.texte).toBe("Déjà décidée par Me Test L2.");
    expect((await de(assoc1, "depense_soumise"))[0].texte).toBe("Décidée par vous.");
    // le soumetteur : statut seul, SANS le nom du décideur
    expect((await de(adminG, "depense_decidee"))[0].texte).toBe("Votre dépense a été validée.");
    // « à décaisser » : administration générale et comptable seulement (première notification), jamais l'associé
    expect((await de(adminG, "depenses_a_decaisser"))[0].a_traiter).toBe(true);
    expect(await de(assoc2, "depenses_a_decaisser")).toHaveLength(0);

    const dec = await request(app).post(`/api/depenses/${r.body.id}/decaisser`).set(auth(assoc2)).send({ mode_paiement: "especes" });
    expect(dec.status).toBe(200);
    expect((await de(adminG, "depenses_a_decaisser"))[0].a_traiter).toBe(false);
    const decaissee = (await de(adminG, "depense_decaissee"));
    expect(decaissee).toHaveLength(1);
    expect(decaissee[0].texte).toBe("Me Test L2 a décaissé votre dépense.");
  });

  test("rejet avec motif : le motif est dans la cloche, jamais dans l'e-mail", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "À rejeter L2", montant: 1000 });
    await request(app).post(`/api/depenses/${r.body.id}/decision`).set(auth(assoc)).send({ statut: "rejetee", motif_rejet: "Hors budget" });
    const rej = (await de(adminG, "depense_decidee"))[0];
    expect(rej.texte).toBe("Votre dépense a été rejetée : « Hors budget »."); // le motif reste lisible, le décideur n'est pas nommé
    expect(rej.rouge).toBe(true); // pastille rouge pour un rejet
    const { rows: [n] } = await pool.query("SELECT * FROM notifications WHERE destinataire_id = $1 AND type = 'depense_decidee'", [adminG.id]);
    const { composerTexte } = require("../src/notifications");
    expect(composerTexte(n)).toMatch(/Hors budget/);
    // texte de l'e-mail de repli : générique
    const repli = require("../src/jobs/notificationsRepli");
    expect(repli).toBeDefined();
  });

  test("retrait d'une dépense soumise : le décompte retombe, la ligne se ferme à zéro", async () => {
    await isoler();
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "À retirer L2", montant: 500 });
    expect((await de(assoc, "depense_soumise"))[0].a_traiter).toBe(true);
    expect((await request(app).delete(`/api/depenses/${r.body.id}`).set(auth(adminG))).status).toBe(204);
    expect((await de(assoc, "depense_soumise"))[0].a_traiter).toBe(false);
  });

  test("décompte : deux dépenses → UNE ligne « 2 dépenses attendent votre décision » ; relancer les associés remplace la ligne (remise en non lue)", async () => {
    await isoler();
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r1 = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "D1", montant: 500 });
    await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "D2", montant: 700 });
    const l = await de(assoc, "depense_soumise");
    expect(l).toHaveLength(1);
    expect(l[0].texte).toBe("2 dépenses attendent votre décision.");
    expect(l[0].lien).toBe("/depenses?statut=soumise");
    // le soumetteur seul relance ; une relance toutes les 4 h au plus ; la ligne déjà lue est remise en non lue, en tête
    await pool.query("UPDATE notifications SET lue_le = now() WHERE id = $1", [l[0].id]);
    expect((await request(app).post(`/api/depenses/${r1.body.id}/relancer-associes`).set(auth(assoc)).send({})).status).toBe(403);
    expect((await request(app).post(`/api/depenses/${r1.body.id}/relancer-associes`).set(auth(adminG)).send({})).status).toBe(200);
    const apres = await de(assoc, "depense_soumise");
    expect(apres).toHaveLength(1); // jamais plus d'une ligne par objet et par personne
    expect(apres[0].id).toBe(l[0].id);
    expect(apres[0].lue_le).toBeNull();
    expect((await request(app).post(`/api/depenses/${r1.body.id}/relancer-associes`).set(auth(adminG)).send({})).status).toBe(429);
  });
});

describe("Petite caisse", () => {
  test("engagée → un autre associé valide après coup ; contestée → l'engageur est informé avec le motif", async () => {
    const adminG = await creer("admin_general"), assoc1 = await creer("associe"), assoc2 = await creer("associe");
    await request(app).put("/api/parametres/honoraires").set(auth(assoc1)).send({ petite_caisse_plafond_depense: 50000 });
    await pool.query("UPDATE depenses SET apres_coup_statut = 'validee' WHERE apres_coup_statut = 'a_valider'"); // isolement du décompte
    const mois = new Date().toISOString().slice(0, 8) + "01";
    await request(app).post("/api/depenses/petite-caisse").set(auth(assoc1)).send({ mois, montant_alloue: 100000000 });
    const e = await request(app).post("/api/depenses/engager").set(auth(adminG))
      .send({ libelle: "Eau L2", montant: 12000, categorie: "fournitures", beneficiaire: "Papeterie L2 " + Date.now(), mode_paiement: "orange_money", references: { id_transaction: "MP260101.0099" } });
    expect(e.status).toBe(201);
    const ligne = (await de(assoc1, "depense_apres_coup"))[0];
    expect(ligne.a_traiter).toBe(true);
    expect(ligne.niveau).toBe("action");
    expect(ligne.texte_bulle).toBeNull(); // Action sans bulle du système
    expect(ligne.texte).toMatch(/a engagé 12[\s  ]000 FCFA \(.+\) sur la petite caisse/); // engageur et montant nommés pour les associés
    expect(await de(adminG, "depense_apres_coup")).toHaveLength(0);
    const c = await request(app).post(`/api/depenses/${e.body.id}/valider-apres-coup`).set(auth(assoc1)).send({ decision: "contestee", motif: "Pas de justificatif" });
    expect(c.status).toBe(200);
    expect((await de(assoc1, "depense_apres_coup"))[0].a_traiter).toBe(false);
    expect((await de(assoc2, "depense_apres_coup"))[0].texte).toBe("Déjà validée par Me Test L2."); // la ligne des autres se transforme
    // l'engageur : statut seul (jamais le nom de l'associé), motif lisible, pastille rouge ; plus de notification aux autres associés
    const contestee = (await de(adminG, "depense_apres_coup_traitee"))[0];
    expect(contestee.texte).toMatch(/^Votre dépense de 12[\s  ]000 FCFA \(.+\) est contestée : « Pas de justificatif »\.$/);
    expect(contestee.niveau).toBe("action");
    expect(contestee.rouge).toBe(true);
    expect((await de(assoc2, "depense_contestee"))).toHaveLength(0); // notification 18 supprimée
  });

  test("écart au rapprochement → les autres décideurs, jamais l'auteur", async () => {
    const assoc1 = await creer("associe"), assoc2 = await creer("associe");
    const r = await request(app).post("/api/depenses/petite-caisse/rapprochement").set(auth(assoc1)).send({ solde_reel: 1 });
    expect(r.status).toBe(201);
    const alerte = (await de(assoc2, "caisse_alerte"))[0];
    expect(alerte.texte).toMatch(/^Écart de -?[\d\s\u202f\u00a0]+ FCFA au rapprochement de .+ de la petite caisse\.$/); // chiffre et caisse dans le texte
    expect(alerte.niveau).toBe("action");
    expect((await de(assoc1, "caisse_alerte"))).toHaveLength(1); // celui qui a saisi le rapprochement le reçoit aussi
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
    expect(n.texte).toMatch(new RegExp(`^L'état de charges de ${M.label} est soumis : 2 lignes, 3.000 FCFA, attendent votre décision\\.$`));
    expect(n.a_traiter).toBe(true);
    expect(n.lien).toBe(`/depenses/etat-charges?etat=${id}`); // arrivée précise sur l'état
    expect(await de(prep, "etat_soumis")).toHaveLength(0);

    await request(app).post(`/api/charges/etats/${id}/lignes/${l1.id}/decision`).set(auth(assoc)).send({ decision: "rejetee", motif: "Trop cher" });
    await request(app).post(`/api/charges/etats/${id}/lignes/${l2.id}/decision`).set(auth(assoc)).send({ decision: "reportee" });
    const regroupee = await de(prep, "etat_lignes_decidees");
    expect(regroupee).toHaveLength(1);
    expect(regroupee[0].nombre).toBe(1); // une seule ligne, mise à jour (jamais empilée)
    expect(regroupee[0].texte).toMatch(/: 2 lignes décidées sur 2 \(0 approuvée, 1 rejetée, 1 reportée\)|Toutes les lignes .* sont décidées/); // avancement, sans le nom de l'associé
    expect(regroupee[0].niveau).toBe("action"); // tout est décidé : l'état peut être clos

    // Base déjà utilisée : d'éventuelles charges habituelles restées en attente sont rejetées pour pouvoir clore.
    for (const l of (await request(app).get(`/api/charges/etats/${id}`).set(auth(assoc))).body.lignes) {
      if (l.decision === "en_attente") await request(app).post(`/api/charges/etats/${id}/lignes/${l.id}/decision`).set(auth(assoc)).send({ decision: "rejetee", motif: "x" });
    }
    const clos = await request(app).post(`/api/charges/etats/${id}/cloturer`).set(auth(assoc));
    expect(clos.body.error || clos.status).toBe(200);
    const clos1 = await de(prep, "etat_clos");
    expect(clos1).toHaveLength(1);
    expect(clos1[0].texte).toMatch(/est clos : 0 ligne approuvée, \d+ rejetée/); // bilan, sans le nom de qui clôt
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
    expect((await de(assoc, "etat_rouvert"))[0].texte).toBe(`L'état de charges de ${M.label} a été rouvert pour modification : il n'est plus à décider pour le moment.`);
  });
});

describe("Relances (job quotidien, cloche seulement)", () => {
  test("rien le week-end", async () => {
    expect(await executerJobNotificationsRelances(pool, new Date("2026-11-14T08:00:00Z"))).toEqual({ week_end: true });
  });

  test("dépense en attente depuis plus de 48 h ouvrées → récapitulatif remplacé chaque jour (jamais empilé) ; aucun e-mail", async () => {
    await isoler();
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Ancienne L2", montant: 700 });
    await pool.query("UPDATE depenses SET cree_le = now() - interval '10 days' WHERE id = $1", [r.body.id]);
    await executerJobNotificationsRelances(pool, mercredi);
    await executerJobNotificationsRelances(pool, mercredi);
    const l = await de(assoc, "depenses_en_attente");
    expect(l).toHaveLength(1);
    expect(l[0].niveau).toBe("action"); // allégé de critique à action : ni bannière, ni alerte du navigateur
    expect(l[0].texte).toMatch(/attend(ent)? votre décision depuis plus de 48 heures \(la plus ancienne depuis \d+ jours?\)/);
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
    expect(l[0].texte).toMatch(new RegExp(`^L'état de charges de ${M.label} (n'est pas encore préparé|est en préparation \\(\\d+ lignes?\\) : à soumettre aux associés)\\.$`));
  }, 60000);
});
