// JURIA — Audit doublons, phase 5 : tuile Tableau de bord "Doublons
// potentiels" (26/09/2026). Voir CLAUDE.md/HISTORY.md pour la synthèse
// complète (phases 1 à 5, la tuile est le filet de sécurité de la phase 5).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // compte "associe" (a parametres.cabinet.modifier)
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

async function creerDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client doublons ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test doublons", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("GET /api/dashboard — doublons_n", () => {
  test("renseigné (non null) pour un rôle avec parametres.cabinet.modifier", async () => {
    const res = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.doublons_n).not.toBeNull();
    expect(typeof res.body.doublons_n).toBe("number");
  });
});

describe("GET /api/dashboard/detail/doublons — détection par catégorie", () => {
  test("2 parties identiques (même dossier/rôle/nom) sont détectées", async () => {
    const dossierId = await creerDossier();
    const nom = `Société Doublon ${Date.now()}`;
    await request(app).post(`/api/dossiers/${dossierId}/parties`).set("Authorization", `Bearer ${token}`)
      .send({ role: "adverse", denomination: nom });
    await request(app).post(`/api/dossiers/${dossierId}/parties`).set("Authorization", `Bearer ${token}`)
      .send({ role: "adverse", denomination: nom });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    const trouve = detail.body.find((d) => d.categorie === "Partie de dossier" && d.description.includes(nom));
    expect(trouve).toBeDefined();
    expect(Number(trouve.nb)).toBe(2);
  });

  test("2 comptes bancaires de même intitulé sont détectés (aucune contrainte en base)", async () => {
    const intitule = `Compte doublon test ${Date.now()}`;
    await request(app).post("/api/parametres/comptes-bancaires").set("Authorization", `Bearer ${token}`)
      .send({ intitule, type: "fonctionnement" });
    await request(app).post("/api/parametres/comptes-bancaires").set("Authorization", `Bearer ${token}`)
      .send({ intitule, type: "fonctionnement" });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    const trouve = detail.body.find((d) => d.categorie === "Compte bancaire" && d.description === intitule);
    expect(trouve).toBeDefined();
    expect(Number(trouve.nb)).toBe(2);
  });

  // 26/09/2026 — régression du faux positif trouvé en vérifiant visuellement :
  // 2 échéances au même libellé/catégorie mais à des ancrages jour/mois
  // réellement différents (ex. les 3 acomptes IS, voir CLAUDE.md 11/09/2026)
  // ne doivent PAS être signalées comme doublon.
  test("2 échéances au même libellé/catégorie mais à des dates d'ancrage différentes ne sont PAS signalées", async () => {
    const libelle = `Acomptes test ${Date.now()}`;
    await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle, categorie: "fiscale", periodicite: "annuelle", prochaine_date: "2026-07-31" });
    await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle, categorie: "fiscale", periodicite: "annuelle", prochaine_date: "2026-11-30" });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    const trouve = detail.body.find((d) => d.categorie === "Échéance administrative" && d.description.includes(libelle));
    expect(trouve).toBeUndefined();
  });

  test("2 échéances au même libellé/catégorie ET au même ancrage sont signalées", async () => {
    const libelle = `Acomptes doublon ${Date.now()}`;
    await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle, categorie: "fiscale", periodicite: "annuelle", prochaine_date: "2027-03-15" });
    await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle, categorie: "fiscale", periodicite: "annuelle", prochaine_date: "2027-03-15" });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${token}`);
    const trouve = detail.body.find((d) => d.categorie === "Échéance administrative" && d.description.includes(libelle));
    expect(trouve).toBeDefined();
    expect(Number(trouve.nb)).toBe(2);
  });
});

describe("Confidentialité de la tuile « Doublons potentiels »", () => {
  test("403 sur le détail pour un rôle sans parametres.cabinet.modifier", async () => {
    const bcrypt = require("bcryptjs");
    const email = `test.doublons.${Date.now()}@jfcavocats-mali.com`;
    const hash = await bcrypt.hash("TestDoublons123!", 10);
    await pool.query(
      `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
       VALUES ('TDBL','Test','Doublons',$1,$2,'collaborateur',TRUE,now())`,
      [email, hash]
    );
    const login = await request(app).post("/auth/login").send({ email, mot_de_passe: "TestDoublons123!" });
    const detail = await request(app).get("/api/dashboard/detail/doublons").set("Authorization", `Bearer ${login.body.token}`);
    expect(detail.status).toBe(403);
    const dash = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${login.body.token}`);
    expect(dash.body.doublons_n).toBeNull();
  });
});
