// JURIA — nouvelles natures « Travaux, équipements et installations » (12/11/2026) : acceptées au circuit normal des dépenses et
// dans l'état mensuel des charges, jamais sur les caisses.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { LIBELLES_CATEGORIES, CATALOGUE_PETITE_CAISSE, CATALOGUE_PROCEDURE } = require("../src/categoriesDepense");
const { assurerUtilisateurTest, pool } = require("./setup");

const TRAVAUX = ["climatisation", "travaux_electricite", "travaux_reseau_telecom", "plomberie", "amenagement_locaux", "securite_surete",
  "mobilier_agencement", "materiel_informatique", "energie_secours", "honoraires_techniques", "vehicule_reparations"];

const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestTrv123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Trv',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`V${sfx.slice(0, 7)}`, `test.trv.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Trv" }, SECRET, { expiresIn: "1h" }) };
}
let assoc, adminG;
beforeAll(async () => { await assurerUtilisateurTest(); assoc = await creer("associe"); adminG = await creer("admin_general"); });
afterAll(async () => { await pool.end(); });

describe("Travaux, équipements et installations", () => {
  test("les 11 valeurs existent en base, ont un libellé, et ne figurent dans aucun catalogue de caisse", async () => {
    const { rows } = await pool.query("SELECT unnest(enum_range(NULL::categorie_depense))::text AS c");
    const valeurs = rows.map((r) => r.c);
    for (const c of TRAVAUX) {
      expect(valeurs).toContain(c);
      expect(LIBELLES_CATEGORIES[c]).toBeTruthy();
      expect(CATALOGUE_PETITE_CAISSE).not.toContain(c);
      expect(CATALOGUE_PROCEDURE).not.toContain(c);
    }
  });

  test("chaque nature est acceptée au circuit normal (soumise)", async () => {
    for (const c of TRAVAUX) {
      const r = await request(app).post("/api/depenses").set(auth(adminG)).send({ type: "ponctuelle", libelle: "Travaux " + c, montant: 1500000, categorie: c });
      expect(r.status).toBe(201);
      expect(r.body.categorie).toBe(c);
      expect(r.body.statut).toBe("soumise");
    }
  });

  test("refusées sur la petite caisse (circuit normal exigé)", async () => {
    await request(app).post("/api/depenses/petite-caisse").set(auth(assoc)).send({ mois: new Date().toISOString().slice(0, 8) + "01", montant_alloue: 500000000 });
    const r = await request(app).post("/api/depenses/engager").set(auth(adminG))
      .send({ libelle: "Climatiseur", montant: 20000, categorie: "climatisation", beneficiaire: "Frigo Mali", mode_paiement: "especes" });
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/circuit normal/);
  });

  test("disponibles aussi dans l'état mensuel des charges (ligne ajoutée à l'état)", async () => {
    const annee = 2100 + Math.floor(Math.random() * 800);
    const etat = await request(app).post("/api/charges/etats").set(auth(assoc)).send({ mois: `${annee}-05` });
    expect(etat.status).toBe(201);
    const ligne = await request(app).post(`/api/charges/etats/${etat.body.id}/lignes`).set(auth(assoc)).send({ libelle: "Pose de climatiseurs", categorie: "climatisation", montant: 2400000 });
    expect(ligne.status).toBe(201);
  });
});
