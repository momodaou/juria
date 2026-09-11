// JURIA — Échéancier : types « diligence »/« autre » + échéances
// administratives du cabinet (11/09/2026, gap comblé — voir HISTORY.md).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // compte "associe"
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
  const hash = await bcrypt.hash("TestEchAdmin123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','EchAdmin',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`E${suffixe.slice(0, 7)}`, `test.echadmin.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return jwt.sign({ sub: rows[0].id, role, nom: "Test EchAdmin" }, SECRET, { expiresIn: "1h" });
}

async function creerClientEtDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client échéancier ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test échéancier", pole: "contentieux",
      matiere: "Droit commercial", mode_honoraires: "forfait", urgence: "moyenne",
      responsable_id: userId,
    });
  return dossier.body.id;
}

describe("Type 'diligence' et 'autre' + precision sur un délai de dossier", () => {
  test("type='diligence' accepté", async () => {
    const dossierId = await creerClientEtDossier();
    const res = await request(app).post("/api/evenements").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, type: "diligence", titre: "Signification", date_echeance: "2026-12-01" });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("diligence");
  });

  test("type='autre' + precision accepté et relu correctement", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/evenements").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, type: "autre", titre: "Démarche particulière", precision: "Dépôt de garantie bancaire", date_echeance: "2026-12-01" });
    expect(creation.status).toBe(201);
    const liste = await request(app).get(`/api/evenements?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(liste.status).toBe(200);
    const ligne = liste.body.find((e) => e.id === creation.body.id);
    expect(ligne.precision).toBe("Dépôt de garantie bancaire");
  });
});

describe("Échéances administratives du cabinet — permissions", () => {
  test("consultation ouverte à un rôle courant (associe)", async () => {
    const res = await request(app).get("/api/echeances-administratives").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Les 7 échéances pré-seedées (TVA, INPS, ITS, IS, patente, Ordre, assurance)
    // doivent apparaître dès l'installation du schéma.
    expect(res.body.length).toBeGreaterThanOrEqual(7);
  });

  test("création refusée (403) à un collaborateur, autorisée (201) à un associé", async () => {
    const collabToken = await creerUtilisateurRole("collaborateur");
    const refus = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${collabToken}`)
      .send({ libelle: "Test refusé", prochaine_date: "2026-12-01" });
    expect(refus.status).toBe(403);

    const ok = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ categorie: "assurance", libelle: "Renouvellement test", periodicite: "annuelle", prochaine_date: "2026-12-01" });
    expect(ok.status).toBe(201);
    expect(ok.body.libelle).toBe("Renouvellement test");
  });
});

describe("Échéances administratives du cabinet — traitement (avance ou clôture)", () => {
  test("périodique : 'traiter' avance à la prochaine occurrence (mensuelle -> +1 mois) et repasse 'a_faire'", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ categorie: "fiscale", libelle: "Test mensuel", periodicite: "mensuelle", prochaine_date: "2026-01-15" });
    const traite = await request(app).post(`/api/echeances-administratives/${creation.body.id}/traiter`).set("Authorization", `Bearer ${token}`);
    expect(traite.status).toBe(200);
    expect(traite.body.statut).toBe("a_faire");
    expect(traite.body.prochaine_date.slice(0, 10)).toBe("2026-02-15");
  });

  test("ponctuelle : 'traiter' passe directement à 'paye', pas d'avance de date", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test ponctuel", periodicite: "ponctuelle", prochaine_date: "2026-01-15" });
    const traite = await request(app).post(`/api/echeances-administratives/${creation.body.id}/traiter`).set("Authorization", `Bearer ${token}`);
    expect(traite.status).toBe(200);
    expect(traite.body.statut).toBe("paye");
    expect(traite.body.prochaine_date.slice(0, 10)).toBe("2026-01-15");
  });

  test("traiter sur une échéance inexistante -> 404", async () => {
    const res = await request(app).post("/api/echeances-administratives/00000000-0000-0000-0000-000000000000/traiter")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
