// JURIA — Échéancier : types « diligence »/« autre » + échéances
// administratives du cabinet (11/09/2026, gap comblé — voir HISTORY.md).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { calculerProchaineEcheance } = require("../src/routes/echeances-administratives");

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
    // Les 7 échéances pré-seedées (TVA, INPS, ITS, IS, patente, Ordre,
    // assurance) doivent apparaître dès l'installation du schéma — l'IS
    // est scindé en 3 lignes annuelles depuis le 11/09/2026 (voir plus
    // bas), donc 9 lignes au total (7 - 1 + 3).
    expect(res.body.length).toBeGreaterThanOrEqual(9);
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

// Formule auto-calculée (11/09/2026, suite de la conversation avec
// l'utilisateur) — tests unitaires sur des dates FIGÉES (pas la date
// d'exécution réelle des tests), pour un résultat déterministe et stable
// dans le temps. Remplace l'ancien comportement ("traiter" avançait une
// date stockée de +1 intervalle à l'aveugle, source de dérive si personne
// ne cliquait pendant plusieurs mois).
describe("calculerProchaineEcheance — formule pure (dates figées)", () => {
  test("mensuelle, jamais traitée, avant le jour du mois -> ce mois-ci", () => {
    const r = calculerProchaineEcheance({ periodicite: "mensuelle", jour_echeance: 15, mois_echeance: null, dernier_traite_le: null }, "2026-09-11");
    expect(r).toBe("2026-09-15");
  });

  test("mensuelle, jamais traitée, après le jour du mois -> reste sur ce mois-ci (en retard, pas masqué)", () => {
    // Volontaire : une échéance jamais traitée et déjà passée ce mois-ci
    // doit apparaître EN RETARD, pas silencieusement sautée au mois
    // suivant comme si de rien n'était (compliance fiscale/sociale — un
    // mois de TVA manqué reste un problème réel tant que non traité).
    const r = calculerProchaineEcheance({ periodicite: "mensuelle", jour_echeance: 15, mois_echeance: null, dernier_traite_le: null }, "2026-09-20");
    expect(r).toBe("2026-09-15");
  });

  test("mensuelle, dernier_traite_le = ce mois-ci -> avance au mois suivant", () => {
    const r = calculerProchaineEcheance({ periodicite: "mensuelle", jour_echeance: 15, mois_echeance: null, dernier_traite_le: "2026-09-15" }, "2026-09-20");
    expect(r).toBe("2026-10-15");
  });

  test("mensuelle, jour_echeance=31 un mois de 30 jours -> clampé au dernier jour, pas de débordement", () => {
    const r = calculerProchaineEcheance({ periodicite: "mensuelle", jour_echeance: 31, mois_echeance: null, dernier_traite_le: null }, "2026-04-05");
    expect(r).toBe("2026-04-30");
  });

  test("annuelle, ancrée sur un mois précis, jamais traitée et déjà passée cette année -> reste sur cette année (en retard, pas masquée)", () => {
    const r = calculerProchaineEcheance({ periodicite: "annuelle", jour_echeance: 30, mois_echeance: 4, dernier_traite_le: null }, "2026-09-11");
    expect(r).toBe("2026-04-30");
  });

  test("annuelle, dernier_traite_le de l'an dernier, l'échéance de cette année n'est pas encore passée -> reste sur cette année", () => {
    const r = calculerProchaineEcheance({ periodicite: "annuelle", jour_echeance: 1, mois_echeance: 1, dernier_traite_le: "2025-01-01" }, "2026-09-11");
    expect(r).toBe("2026-01-01");
  });

  test("ponctuelle -> pas de formule (null), l'appelant retombe sur la date stockée", () => {
    const r = calculerProchaineEcheance({ periodicite: "ponctuelle", jour_echeance: 15, mois_echeance: null, dernier_traite_le: null }, "2026-09-11");
    expect(r).toBeNull();
  });
});

describe("Échéances administratives du cabinet — création : jour/mois déduits automatiquement de la date", () => {
  test("periodicite='annuelle' : jour_echeance/mois_echeance déduits de prochaine_date, pas des champs séparés à saisir", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ categorie: "assurance", libelle: "Test formule annuelle", periodicite: "annuelle", prochaine_date: "2026-04-30" });
    expect(creation.status).toBe(201);
    // GET renvoie la date calculée (formule), pas nécessairement la date
    // brute saisie — mais avant tout traitement, jamais traitée, la
    // formule doit retomber exactement sur la même date que celle saisie
    // (avril n'est pas encore passé début septembre... si si passé, donc
    // on attend l'an prochain) : on vérifie juste que jour/mois collent en
    // relisant via une échéance non encore dépassée.
    const liste = await request(app).get("/api/echeances-administratives").set("Authorization", `Bearer ${token}`);
    const ligne = liste.body.find((e) => e.id === creation.body.id);
    expect(new Date(ligne.prochaine_date).getUTCDate()).toBe(30);
    expect(new Date(ligne.prochaine_date).getUTCMonth() + 1).toBe(4);
  });
});

describe("Échéances administratives du cabinet — traitement + lien Dépenses & caisse", () => {
  test("périodique : 'traiter' enregistre dernier_traite_le et repasse 'a_faire' (plus d'avance à l'aveugle)", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ categorie: "fiscale", libelle: "Test mensuel", periodicite: "mensuelle", prochaine_date: "2026-01-15" });
    const traite = await request(app).post(`/api/echeances-administratives/${creation.body.id}/traiter`).set("Authorization", `Bearer ${token}`);
    expect(traite.status).toBe(200);
    expect(traite.body.statut).toBe("a_faire");
    // prochaine_date renvoyée = la PROCHAINE occurrence après clôture,
    // toujours dans le futur par construction (calculée depuis aujourd'hui).
    expect(new Date(traite.body.prochaine_date) > new Date()).toBe(true);
  });

  test("ponctuelle : 'traiter' passe directement à 'paye', prochaine_date = null (pas de formule)", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test ponctuel", periodicite: "ponctuelle", prochaine_date: "2026-01-15" });
    const traite = await request(app).post(`/api/echeances-administratives/${creation.body.id}/traiter`).set("Authorization", `Bearer ${token}`);
    expect(traite.status).toBe(200);
    expect(traite.body.statut).toBe("paye");
    expect(traite.body.prochaine_date).toBeNull();
  });

  test("traiter avec montant_decaisse crée la dépense (catégorie dédiée, déjà décaissée) et la lie", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test lien dépense", periodicite: "ponctuelle", prochaine_date: "2026-01-15" });
    const traite = await request(app).post(`/api/echeances-administratives/${creation.body.id}/traiter`).set("Authorization", `Bearer ${token}`)
      .send({ montant_decaisse: 123456 });
    expect(traite.status).toBe(200);
    expect(traite.body.depense_id).toBeTruthy();

    const depense = await request(app).get("/api/depenses").set("Authorization", `Bearer ${token}`);
    const ligne = depense.body.find((d) => d.id === traite.body.depense_id);
    expect(ligne.montant).toBe("123456");
    expect(ligne.categorie).toBe("charges_fiscales_sociales");
    expect(ligne.statut).toBe("decaissee");

    const liste = await request(app).get("/api/echeances-administratives").set("Authorization", `Bearer ${token}`);
    const echeance = liste.body.find((e) => e.id === creation.body.id);
    expect(echeance.depense_id).toBe(traite.body.depense_id);
    expect(Number(echeance.depense_montant)).toBe(123456);
  });

  test("traiter sans montant_decaisse ne crée aucune dépense", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test sans montant", periodicite: "ponctuelle", prochaine_date: "2026-01-15" });
    const traite = await request(app).post(`/api/echeances-administratives/${creation.body.id}/traiter`).set("Authorization", `Bearer ${token}`);
    expect(traite.body.depense_id).toBeNull();
  });

  test("traiter sur une échéance inexistante -> 404", async () => {
    const res = await request(app).post("/api/echeances-administratives/00000000-0000-0000-0000-000000000000/traiter")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("IS scindé en 3 échéances annuelles (migration du 11/09/2026)", () => {
  test("3 lignes IS distinctes présentes, aucune 'trimestrielle' restante", async () => {
    const liste = await request(app).get("/api/echeances-administratives").set("Authorization", `Bearer ${token}`);
    const isLignes = liste.body.filter((e) => e.libelle === "Acomptes provisionnels Impôt sur les Sociétés (IS)");
    expect(isLignes.length).toBe(3);
    expect(isLignes.every((e) => e.periodicite === "annuelle")).toBe(true);
    const joursMois = isLignes.map((e) => `${e.mois_echeance}-${e.jour_echeance}`).sort();
    expect(joursMois).toEqual(["11-30", "3-31", "7-31"]);
  });
});

describe("Échéances administratives du cabinet — correction manuelle (PUT) et suppression (DELETE)", () => {
  test("PUT : modifie un champ simple (libelle) sans toucher à la formule", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ categorie: "sociale", libelle: "Test PUT simple", periodicite: "mensuelle", prochaine_date: "2026-03-15" });
    const maj = await request(app).put(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test PUT simple corrigé" });
    expect(maj.status).toBe(200);
    expect(maj.body.libelle).toBe("Test PUT simple corrigé");
    expect(maj.body.periodicite).toBe("mensuelle");
    expect(maj.body.jour_echeance).toBe(15);
  });

  test("PUT : periodicite sans prochaine_date -> 400 (doivent être fournis ensemble)", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test PUT incomplet", periodicite: "mensuelle", prochaine_date: "2026-03-15" });
    const res = await request(app).put(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ periodicite: "trimestrielle" });
    expect(res.status).toBe(400);
  });

  test("PUT : cas réel — corrige une échéance 'mensuelle' en 'trimestrielle' (ex. INPS selon l'effectif), jour/mois recalculés", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ categorie: "sociale", libelle: "Test INPS", periodicite: "mensuelle", prochaine_date: "2026-01-15" });
    const maj = await request(app).put(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ periodicite: "trimestrielle", prochaine_date: "2026-04-15" });
    expect(maj.status).toBe(200);
    expect(maj.body.periodicite).toBe("trimestrielle");
    expect(maj.body.jour_echeance).toBe(15);
    expect(maj.body.mois_echeance).toBe(4);
  });

  test("PUT : refusé (403) à un collaborateur", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test PUT permission", periodicite: "ponctuelle", prochaine_date: "2026-03-15" });
    const collabToken = await creerUtilisateurRole("collaborateur");
    const res = await request(app).put(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${collabToken}`)
      .send({ libelle: "Tentative refusée" });
    expect(res.status).toBe(403);
  });

  test("PUT sur une échéance inexistante -> 404", async () => {
    const res = await request(app).put("/api/echeances-administratives/00000000-0000-0000-0000-000000000000").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "X" });
    expect(res.status).toBe(404);
  });

  test("DELETE : désactive l'échéance, qui disparaît de la liste ; refusé (403) à un collaborateur ; 404 si déjà supprimée", async () => {
    const creation = await request(app).post("/api/echeances-administratives").set("Authorization", `Bearer ${token}`)
      .send({ libelle: "Test DELETE", periodicite: "ponctuelle", prochaine_date: "2026-03-15" });

    const collabToken = await creerUtilisateurRole("collaborateur");
    const refus = await request(app).delete(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${collabToken}`);
    expect(refus.status).toBe(403);

    const suppression = await request(app).delete(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(204);

    const liste = await request(app).get("/api/echeances-administratives").set("Authorization", `Bearer ${token}`);
    expect(liste.body.some((e) => e.id === creation.body.id)).toBe(false);

    const doubleSuppression = await request(app).delete(`/api/echeances-administratives/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(doubleSuppression.status).toBe(404);
  });
});
