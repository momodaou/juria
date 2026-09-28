// JURIA — 28/09/2026 : audit systématique des routes GET du backend
// (déclenché après la découverte du bug de confidentialité sur
// `GET /api/cabinet/conges`, corrigé la veille) pour trouver d'autres
// fuites du même type. Trouvé : `GET /api/temps?dossier_id=` exposait le
// taux_horaire (rémunération individuelle) de TOUT le cabinet sur
// n'importe quel dossier, sans aucun contrôle — corrigé en masquant
// `taux_horaire` sauf pour l'auteur de la ligne ou le cercle déjà habilité
// à voir des données financières (factures.creer/consulter, nécessaire
// pour construire une facture depuis « Facturer un dossier », qui affiche
// ce taux). Durée/description/facturable restent visibles pour tous —
// comportement historique inchangé, déjà accepté (gestion collaborative
// du dossier, cf. Axe A de la RLS différée le 18/08/2026).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // associe (Test Régression) — a factures.consulter/creer
let userId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestPermAudit123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','PermAudit',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`Y${suffixe.slice(0, 7)}`, `test.permaudit.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test PermAudit" }, SECRET, { expiresIn: "1h" }) };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

async function creerClient() {
  const res = await request(app).post("/api/clients").set(auth(token))
    .send({ type: "morale", denomination: `Client PermAudit ${Date.now()}` });
  return res.body.id;
}

async function creerDossier(clientId) {
  const res = await request(app).post("/api/dossiers").set(auth(token))
    .send({
      intitule: "Dossier PermAudit", client_id: clientId, pole: "conseil",
      responsable_id: userId, mode_honoraires: "forfait",
    });
  return res.body.id;
}

describe("GET /api/temps?dossier_id= — taux_horaire masqué hors cercle financier (28/09/2026)", () => {
  test("un rôle sans factures.creer/consulter voit son propre taux mais pas celui d'un collègue sur le même dossier", async () => {
    // `stagiaire` (non-avocat) — vérifié n'avoir ni factures.creer ni
    // factures.consulter en production (contrairement à `collaborateur`,
    // qui a factures.creer=TRUE et verrait donc légitimement les deux taux).
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const a = await creerUtilisateurRole("stagiaire");
    const b = await creerUtilisateurRole("collaborateur");

    await request(app).post("/api/temps").set(auth(a.token))
      .send({ dossier_id: dossierId, duree_minutes: 60, taux_horaire: 15000, description: "Recherche" });
    await request(app).post("/api/temps").set(auth(b.token))
      .send({ dossier_id: dossierId, duree_minutes: 30, taux_horaire: 20000, description: "Relecture" });

    const vueA = await request(app).get(`/api/temps?dossier_id=${dossierId}`).set(auth(a.token));
    expect(vueA.status).toBe(200);
    const ligneA = vueA.body.find((t) => t.utilisateur_id === a.id);
    const ligneB = vueA.body.find((t) => t.utilisateur_id === b.id);
    expect(Number(ligneA.taux_horaire)).toBe(15000); // son propre taux, visible
    expect(ligneB.taux_horaire).toBeNull(); // taux d'un collègue, masqué
    // durée/description restent visibles pour la gestion collaborative du dossier
    expect(ligneB.duree_minutes).toBe(30);
    expect(ligneB.description).toBe("Relecture");
  });

  test("factures.consulter (associé) voit les taux de tout le monde sur le dossier", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const a = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/temps").set(auth(a.token))
      .send({ dossier_id: dossierId, duree_minutes: 45, taux_horaire: 18000 });

    const vueAssocie = await request(app).get(`/api/temps?dossier_id=${dossierId}`).set(auth(token));
    expect(vueAssocie.status).toBe(200);
    const ligne = vueAssocie.body.find((t) => t.utilisateur_id === a.id);
    expect(Number(ligne.taux_horaire)).toBe(18000);
  });

  test("sans dossier_id (mes saisies) : le taux reste toujours visible, comportement inchangé", async () => {
    const clientId = await creerClient();
    const dossierId = await creerDossier(clientId);
    const a = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/temps").set(auth(a.token))
      .send({ dossier_id: dossierId, duree_minutes: 20, taux_horaire: 12000 });

    const soi = await request(app).get("/api/temps").set(auth(a.token));
    expect(soi.status).toBe(200);
    expect(Number(soi.body[0].taux_horaire)).toBe(12000);
  });
});
