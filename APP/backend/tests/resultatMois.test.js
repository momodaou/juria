// JURIA — Tableau de bord : « Résultat du mois » (11/09/2026, suite d'une
// question de l'utilisateur sur la convergence recettes/dépenses — aucune
// vue cabinet entier de ce type n'existait, seulement une marge par
// dossier). recettes_mois = encaissé du mois (paiements), depenses_mois =
// dépenses décaissées du mois, resultat_mois = la différence.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestResultat123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Resultat',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`R${suffixe.slice(0, 7)}`, `test.resultat.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return jwt.sign({ sub: rows[0].id, role, nom: "Test Resultat" }, SECRET, { expiresIn: "1h" });
}

describe("Résultat du mois — permission", () => {
  test("null pour un rôle sans factures.consulter (avocat stagiaire)", async () => {
    const stagiaireToken = await creerUtilisateurRole("avocat_stagiaire");
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${stagiaireToken}`);
    expect(res.status).toBe(200);
    expect(res.body.resultat_mois).toBeNull();
    expect(res.body.recettes_mois).toBeNull();
    expect(res.body.depenses_mois).toBeNull();
  });

  test("renseigné pour un associé (factures.consulter)", async () => {
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.resultat_mois).not.toBeNull();
    expect(res.body.recettes_mois).not.toBeNull();
    expect(res.body.depenses_mois).not.toBeNull();
  });
});

describe("Résultat du mois — cohérence du calcul", () => {
  test("resultat_mois = recettes_mois - depenses_mois (toujours, quelles que soient les données)", async () => {
    // Ajoute une dépense décaissée du jour, montant distinctif, pour
    // confirmer qu'elle est bien prise en compte -- pas d'égalité exacte
    // testée sur les montants absolus (d'autres tests de la suite créent
    // aussi des dépenses/paiements du mois courant, sur la même base
    // partagée) : seule la relation arithmétique est vérifiée, robuste à
    // ce bruit.
    const avant = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    const depensesAvant = Number(avant.body.depenses_mois);

    await pool.query(
      `INSERT INTO depenses (type, categorie, libelle, montant, date_depense, statut, soumis_par, valide_par, valide_le, decaisse_par, decaisse_le, cree_par)
       VALUES ('ponctuelle','charges_fiscales_sociales','Test résultat du mois',777777,current_date,'decaissee',
               (SELECT id FROM utilisateurs WHERE email = $1),(SELECT id FROM utilisateurs WHERE email = $1),now(),
               (SELECT id FROM utilisateurs WHERE email = $1),now(),(SELECT id FROM utilisateurs WHERE email = $1))`,
      [EMAIL_TEST]
    );

    const apres = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(Number(apres.body.depenses_mois)).toBe(depensesAvant + 777777);
    expect(Number(apres.body.resultat_mois)).toBe(Number(apres.body.recettes_mois) - Number(apres.body.depenses_mois));
  });
});
