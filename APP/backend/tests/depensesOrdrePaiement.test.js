// JURIA — Dépenses, lot A (11/11/2026) : les associés ORDONNENT le paiement (moyen + compte), l'administration générale et
// le comptable EXÉCUTENT (références seulement) ; masquage du moyen et du compte ; blocage ; garde des comptes.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { assurerUtilisateurTest, pool } = require("./setup");

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestOrd123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Ordre',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`O${sfx.slice(0, 7)}`, `test.ord.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Ordre" }, SECRET, { expiresIn: "1h" }) };
}
const post = (u, url, body = {}) => request(app).post(url).set(auth(u)).send(body);
const liste = async (u) => (await request(app).get("/api/depenses").set(auth(u))).body;
const ligne = async (u, id) => (await liste(u)).find((d) => d.id === id);
const notifs = async (u, type) => (await request(app).get("/api/notifications").set(auth(u))).body.filter((n) => n.type === type);
let compteMobile;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const { rows: [c] } = await pool.query("INSERT INTO comptes_bancaires (intitule, type, operateur) VALUES ('Orange test lot A','mobile_money','orange_money') RETURNING id");
  compteMobile = c.id;
});
afterAll(async () => { await pool.end(); });

async function deposer(u, extra = {}) {
  const r = await post(u, "/api/depenses", { type: "ponctuelle", libelle: "Dépense lot A", montant: 40000, ...extra });
  expect(r.status).toBe(201);
  return r.body.id;
}

describe("Soumission et masquage", () => {
  test("l'administration générale soumet sans moyen ni compte (ignorés), ne voit rien ; l'associé voit tout", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const id = await deposer(adminG, { mode_paiement: "orange_money", compte_id: compteMobile });
    const vueAdmin = await ligne(adminG, id);
    expect(vueAdmin.mode_paiement).toBeNull();
    expect(vueAdmin.compte).toBeNull();
    expect((await ligne(assoc, id)).mode_paiement).toBeNull(); // le moyen soumis par un non-décideur a bien été ignoré
    // un associé qui dépose peut orienter
    const id2 = await deposer(assoc, { mode_paiement: "orange_money", compte_id: compteMobile });
    expect((await ligne(assoc, id2)).mode_paiement).toBe("orange_money");
    expect((await ligne(adminG, id2)).mode_paiement).toBeNull(); // pas d'ordre : rien de visible pour l'exécutant
  });

  test("le rejet exige un motif", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const id = await deposer(adminG);
    expect((await post(assoc, `/api/depenses/${id}/decision`, { statut: "rejetee" })).status).toBe(400);
    expect((await post(assoc, `/api/depenses/${id}/decision`, { statut: "rejetee", motif_rejet: "Hors budget" })).status).toBe(200);
  });
});

describe("Ordre de paiement et exécution", () => {
  test("validée sans ordre : exécution impossible, pas de notification « à décaisser » ; l'ordre la débloque", async () => {
    const adminG = await creer("admin_general"), comptable = await creer("comptable"), assoc = await creer("associe");
    const id = await deposer(adminG);
    const v = await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee" });
    expect(v.status).toBe(200);
    expect(v.body.ordre_donne).toBe(false);
    expect(await notifs(adminG, "depense_a_decaisser")).toHaveLength(0);
    expect(await notifs(comptable, "depense_a_decaisser")).toHaveLength(0);
    const refus = await post(adminG, `/api/depenses/${id}/decaisser`, { mode_paiement: "especes" });
    expect(refus.status).toBe(409);
    expect(refus.body.error).toMatch(/ordre de paiement/);
    expect((await ligne(adminG, id)).mode_paiement).toBeNull();
    // l'administrateur n'a pas le droit de donner l'ordre
    expect((await post(adminG, `/api/depenses/${id}/ordre-paiement`, { mode_paiement: "especes" })).status).toBe(403);
    // moyen sans compte obligatoire refusé
    expect((await post(assoc, `/api/depenses/${id}/ordre-paiement`, { mode_paiement: "orange_money" })).status).toBe(400);
    const o = await post(assoc, `/api/depenses/${id}/ordre-paiement`, { mode_paiement: "orange_money", compte_id: compteMobile });
    expect(o.status).toBe(200);
    expect((await notifs(adminG, "depense_a_decaisser"))[0].a_traiter).toBe(true);
    expect((await notifs(comptable, "depense_a_decaisser"))).toHaveLength(1);
    // l'exécutant voit maintenant le moyen et l'intitulé du compte (jamais les références avant paiement)
    const vue = await ligne(adminG, id);
    expect(vue.mode_paiement).toBe("orange_money");
    expect(vue.compte).toBe("Orange test lot A");
    expect(vue.references_paiement).toEqual({});
    // il ne peut pas changer le moyen : seules les références comptent ; référence obligatoire du moyen
    expect((await post(adminG, `/api/depenses/${id}/decaisser`, { mode_paiement: "especes" })).status).toBe(400);
    const ok = await post(adminG, `/api/depenses/${id}/decaisser`, { mode_paiement: "especes", references: { id_transaction: "MP261111.0001" } });
    expect(ok.status).toBe(200);
    const fin = await ligne(assoc, id);
    expect(fin.statut).toBe("decaissee");
    expect(fin.mode_paiement).toBe("orange_money"); // le moyen de l'ordre a été conservé
    expect(fin.references_paiement.id_transaction).toBe("MP261111.0001");
    expect((await notifs(comptable, "depense_a_decaisser"))[0].a_traiter).toBe(false);
  });

  test("validation avec ordre d'un coup : les exécutants sont prévenus tout de suite", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const id = await deposer(adminG);
    const v = await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee", mode_paiement: "especes" });
    expect(v.body.ordre_donne).toBe(true);
    expect(await notifs(adminG, "depense_a_decaisser")).toHaveLength(1);
    expect((await post(adminG, `/api/depenses/${id}/decaisser`, {})).status).toBe(200);
  });

  test("l'associé fait tout d'un seul geste (valider puis décaisser avec moyen), l'ordre est enregistré", async () => {
    const assoc = await creer("associe");
    const id = await deposer(assoc);
    expect((await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee" })).status).toBe(200);
    expect((await post(assoc, `/api/depenses/${id}/decaisser`, { mode_paiement: "especes" })).status).toBe(200);
    const { rows: [d] } = await pool.query("SELECT ordre_paiement_le, statut FROM depenses WHERE id = $1", [id]);
    expect(d.statut).toBe("decaissee");
    expect(d.ordre_paiement_le).not.toBeNull();
  });

  test("ancienne dépense validée (ordre réputé donné, sans moyen) : l'exécutant choisit comme avant", async () => {
    const adminG = await creer("admin_general"), assoc = await creer("associe");
    const id = await deposer(adminG);
    await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee" });
    await pool.query("UPDATE depenses SET ordre_paiement_le = now() WHERE id = $1", [id]);
    expect((await post(adminG, `/api/depenses/${id}/decaisser`, { mode_paiement: "especes" })).status).toBe(200);
  });
});

describe("Blocage", () => {
  test("l'exécutant signale un blocage : les associés sont prévenus, l'exécution est suspendue jusqu'à un nouvel ordre", async () => {
    const comptable = await creer("comptable"), adminG = await creer("admin_general"), assoc = await creer("associe");
    const id = await deposer(adminG);
    await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee", mode_paiement: "especes" });
    expect((await post(comptable, `/api/depenses/${id}/blocage`, {})).status).toBe(400); // motif requis
    expect((await post(comptable, `/api/depenses/${id}/blocage`, { motif: "Caisse vide" })).status).toBe(200);
    const n = (await notifs(assoc, "depense_blocage"))[0];
    expect(n.a_traiter).toBe(true);
    expect(n.texte).toMatch(/Caisse vide/);
    expect((await ligne(comptable, id)).blocage_le).not.toBeNull();
    expect((await post(comptable, `/api/depenses/${id}/decaisser`, {})).status).toBe(409);
    // nouvel ordre : blocage levé, alerte traitée, exécutants prévenus à nouveau
    expect((await post(assoc, `/api/depenses/${id}/ordre-paiement`, { mode_paiement: "especes" })).status).toBe(200);
    expect((await notifs(assoc, "depense_blocage"))[0].a_traiter).toBe(false);
    expect((await ligne(comptable, id)).blocage_le).toBeNull();
    expect((await post(comptable, `/api/depenses/${id}/decaisser`, {})).status).toBe(200);
  });
});

describe("Comptes : garde de consultation", () => {
  test("un rôle sans droit lié aux paiements reçoit 403 ; un associé ne reçoit que l'identité des comptes", async () => {
    const archiviste = await creer("archiviste"), assoc = await creer("associe");
    expect((await request(app).get("/api/depenses/comptes").set(auth(archiviste))).status).toBe(403);
    expect((await request(app).get("/api/depenses/moyens-paiement/orange_money/comptes").set(auth(archiviste))).status).toBe(403);
    const r = await request(app).get("/api/depenses/comptes").set(auth(assoc));
    expect(r.status).toBe(200);
    expect(Object.keys(r.body[0]).sort()).toEqual(["id", "intitule", "type"]);
    expect((await request(app).get("/api/depenses/moyens-paiement/orange_money/comptes").set(auth(assoc))).status).toBe(200);
  });
});

describe("Pièces à toute étape (lot C)", () => {
  const joindre = (u, id, type, nom = "piece.pdf") =>
    request(app).post(`/api/depenses/${id}/pieces`).set(auth(u)).field("type", type).attach("fichier", Buffer.from(nom), { filename: nom, contentType: "application/pdf" });

  test("le déposant, l'exécutant et l'associé joignent des pièces après le paiement ; un tiers non ; retrait après décision réservé à l'associé ou à l'auteur", async () => {
    const adminG = await creer("admin_general"), comptable = await creer("comptable"), assoc = await creer("associe"), archiviste = await creer("archiviste");
    const id = await deposer(adminG);
    await post(assoc, `/api/depenses/${id}/decision`, { statut: "validee", mode_paiement: "especes" });
    expect((await post(comptable, `/api/depenses/${id}/decaisser`, {})).status).toBe(200);
    // après paiement : devis, facture, preuve acceptés
    expect((await joindre(adminG, id, "devis")).status).toBe(201);
    expect((await joindre(adminG, id, "facture", "facture.pdf")).status).toBe(201);
    const preuve = await joindre(comptable, id, "preuve_paiement", "preuve.pdf");
    expect(preuve.status).toBe(201);
    expect((await joindre(archiviste, id, "facture")).status).toBe(403);
    // l'exécutant retire sa propre pièce, pas celle d'un autre ; l'associé retire tout
    const pieces = (await request(app).get(`/api/depenses/${id}/pieces`).set(auth(assoc))).body;
    const dAdmin = pieces.find((p) => p.type === "facture");
    expect((await request(app).delete(`/api/depenses/${id}/pieces/${dAdmin.id}`).set(auth(comptable))).status).toBe(404);
    expect((await request(app).delete(`/api/depenses/${id}/pieces/${preuve.body.id}`).set(auth(comptable))).status).toBe(204);
    expect((await request(app).delete(`/api/depenses/${id}/pieces/${dAdmin.id}`).set(auth(assoc))).status).toBe(204);
  });
});
