// JURIA — Interconnexion Registre du courrier / Rôle d'audience / Dossiers
// (11/09/2026, gap comblé — voir HISTORY.md) : pièce jointe GED sur un
// courrier, diligences enfin exposées, historique des audiences sur la
// fiche dossier, garde-fou de suppression étendu à `audiences`.
const request = require("supertest");
const app = require("../server");
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

async function creerClientEtDossier() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client interco ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test interconnexion", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

describe("Courrier -> GED (courriers.document_id)", () => {
  test("refuse le téléversement si le courrier n'a pas de dossier", async () => {
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Un expéditeur sans dossier" });
    expect(courrier.status).toBe(201);
    const res = await request(app).post(`/api/courriers/${courrier.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("contenu"), { filename: "scan.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  test("accepte le téléversement quand le courrier est rattaché à un dossier, met à jour document_id", async () => {
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Un expéditeur", dossier_id: dossierId });
    const upload = await request(app).post(`/api/courriers/${courrier.body.id}/document`).set("Authorization", `Bearer ${token}`)
      .attach("fichier", Buffer.from("contenu du scan"), { filename: "scan.txt", contentType: "text/plain" });
    expect(upload.status).toBe(201);
    expect(upload.body.document_id).toBeTruthy();

    const relu = await request(app).get(`/api/courriers?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    const ligne = relu.body.find((c) => c.id === courrier.body.id);
    expect(ligne.document_id).toBe(upload.body.document_id);
  });
});

// 24/09/2026 — gap signalé par l'utilisateur (« faut-il prévoir une ligne
// 'type de courrier' ? ») : le champ existait déjà (formulaire + colonne),
// mais aucun filtre par type — comblé ici.
describe("GET /api/courriers?type= — filtre par type de courrier", () => {
  test("ne renvoie que les courriers du type demandé", async () => {
    const dossierId = await creerClientEtDossier();
    const lettre = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "lettre", correspondant: "Correspondant lettre", dossier_id: dossierId });
    const decision = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "decision_justice", correspondant: "Correspondant décision", dossier_id: dossierId });

    const filtre = await request(app).get(`/api/courriers?dossier_id=${dossierId}&type=decision_justice`)
      .set("Authorization", `Bearer ${token}`);
    expect(filtre.body.some((c) => c.id === decision.body.id)).toBe(true);
    expect(filtre.body.some((c) => c.id === lettre.body.id)).toBe(false);
  });
});

// 14/10/2026 — gap signalé par l'utilisateur : le type "Autre" n'avait aucun
// champ de saisie du libellé réel, contrairement à "Procédure"/type_audience
// (même jour, Rôle d'audience) qui ont déjà ce patron.
describe("courriers.type_precision — libellé libre pour le type 'Autre'", () => {
  test("se persiste à la création et se relit via GET /api/courriers", async () => {
    const creation = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "autre", type_precision: "Carte de vœux du confrère", correspondant: "Un confrère" });
    expect(creation.status).toBe(201);
    expect(creation.body.type_precision).toBe("Carte de vœux du confrère");

    const relu = await request(app).get("/api/courriers").set("Authorization", `Bearer ${token}`);
    const ligne = relu.body.find((c) => c.id === creation.body.id);
    expect(ligne.type_precision).toBe("Carte de vœux du confrère");
  });

  test("corrigeable via PUT /:id, sans effacement si non fourni (COALESCE)", async () => {
    const creation = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "autre", type_precision: "Premier libellé", correspondant: "Un correspondant" });

    const maj = await request(app).put(`/api/courriers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`).send({ type_precision: "Libellé corrigé" });
    expect(maj.status).toBe(200);
    expect(maj.body.type_precision).toBe("Libellé corrigé");

    const majSansPrecision = await request(app).put(`/api/courriers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`).send({ objet: "Objet corrigé" });
    expect(majSansPrecision.body.type_precision).toBe("Libellé corrigé");
  });
});

describe("Diligences (planning des rendez-vous/démarches de terrain)", () => {
  test("création sans dossier acceptée (formalité générale)", async () => {
    const res = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ type_diligence: "formalite", date_diligence: "2026-12-01", objet: "Dépôt au greffe" });
    expect(res.status).toBe(201);
    expect(res.body.statut).toBe("a_faire");
  });

  test("création avec dossier + type 'autre' et precision, puis relecture", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ type_diligence: "autre", type_precision: "Constat d'huissier", dossier_id: dossierId, date_diligence: "2026-12-05", objet: "Constat" });
    expect(creation.status).toBe(201);
    const liste = await request(app).get(`/api/diligences?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(liste.status).toBe(200);
    const ligne = liste.body.find((d) => d.id === creation.body.id);
    expect(ligne.type_precision).toBe("Constat d'huissier");
    expect(ligne.dossier_id).toBe(dossierId);
  });

  test("mise à jour du statut (fait), et le déclencheur automatique de courrier alimente bien la table", async () => {
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ date_diligence: "2026-12-01" });
    const maj = await request(app).put(`/api/diligences/${creation.body.id}/statut`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "fait" });
    expect(maj.status).toBe(200);
    expect(maj.body.statut).toBe("fait");

    // Déclencheur : un courrier de type 'convocation' sur un dossier crée
    // automatiquement une diligence (voir courriers.js, appliquerDeclencheurs).
    const dossierId = await creerClientEtDossier();
    const courrier = await request(app).post("/api/courriers").set("Authorization", `Bearer ${token}`)
      .send({ sens: "arrivee", type: "convocation", correspondant: "Juridiction X", dossier_id: dossierId });
    expect(courrier.body.declenchement?.type).toBe("diligence");
    const liste = await request(app).get(`/api/diligences?dossier_id=${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(liste.body.some((d) => d.courrier_id === courrier.body.id)).toBe(true);
  });
});

describe("Historique des audiences sur la fiche dossier", () => {
  test("GET /api/dossiers/:id/audiences renvoie les audiences du dossier", async () => {
    const dossierId = await creerClientEtDossier();
    await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-10", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const res = await request(app).get(`/api/dossiers/${dossierId}/audiences`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].juridiction).toBe("TGI Bamako");
  });

  test("un dossier avec une audience ne peut plus être supprimé silencieusement (409)", async () => {
    const dossierId = await creerClientEtDossier();
    await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-11", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const suppression = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(409);
    // 09/10/2026 — le message est désormais en français (libellé lisible,
    // plus le nom de table brut) ; on vérifie la structure `blocages`.
    expect(suppression.body.blocages.some((b) => b.table === "audiences")).toBe(true);
  });
});

// 26/09/2026 — gap comblé (constat de l'utilisateur : « il est possible
// d'avoir des dossiers en doublon dans le rôle d'audience... je n'ai vu
// nulle part la possibilité de supprimer le dossier intrus »). Le bug
// corrigé le 24/09/2026 (un second POST /retour dupliquait l'audience
// suivante) avait pu en laisser en production avant le correctif, sans
// aucune route pour les retirer.
describe("DELETE /api/roles-audience/audiences/:id — retirer une ligne en doublon/erronée", () => {
  test("retire l'audience et sa ligne de rôle", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-20", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const suppression = await request(app).delete(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(204);
    const role = await request(app).get("/api/roles-audience?semaine=2026-12-14").set("Authorization", `Bearer ${token}`);
    expect(role.body.lignes.some((l) => l.id === creation.body.id)).toBe(false);
    // le dossier n'a plus d'activité "audiences" — la suppression redevient possible
    const suppressionDossier = await request(app).delete(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(suppressionDossier.status).toBe(204);
  });

  test("refuse si un retour a déjà été saisi (409)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-21", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "plaide" });
    const suppression = await request(app).delete(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(409);
  });

  test("refuse si une autre audience est déjà chaînée sur celle-ci (audience_prec_id) même sans résultat (409)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-22", juridiction: "TGI Bamako", type: "mise_en_etat" });
    // Simule une audience "suite" déjà chaînée sur l'audience d'origine
    // (ex. laissée par le bug corrigé le 24/09/2026), sans passer par
    // /retour — pour vérifier la 2e garde isolément de la 1re (résultat).
    await pool.query(
      "INSERT INTO audiences (dossier_id, date_audience, type, audience_prec_id) VALUES ($1,'2027-01-05','mise_en_etat',$2)",
      [dossierId, creation.body.audience_id]
    );
    const suppression = await request(app).delete(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(suppression.status).toBe(409);
  });
});

// 21/09/2026 — gap comblé (constat de l'utilisateur : « impossible de
// modifier les informations du rôle ou d'une audience à venir »). Route
// unique ancrée sur audiences.id, appelable depuis le Rôle d'audience
// comme depuis le panneau (désormais éditable) de la fiche dossier —
// demande explicite de l'utilisateur (« les 2 possibilités à la fois »).
describe("PUT /api/roles-audience/audiences/:id — correction d'une audience", () => {
  test("modifie juridiction/date/heure/type/avocat et propage à role_audience_lignes", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-15", juridiction: "TGI Bamako", type: "mise_en_etat", heure: "09:00" });
    expect(creation.status).toBe(201);

    const maj = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ juridiction: "Tribunal du Commerce de Bamako", date_audience: "2026-12-16", heure: "11:00", type: "plaidoirie" });
    expect(maj.status).toBe(200);
    expect(maj.body.juridiction).toBe("Tribunal du Commerce de Bamako");
    expect(maj.body.type).toBe("plaidoirie");

    // Vue Rôle d'audience (role_audience_lignes) reflète la correction.
    const role = await request(app).get("/api/roles-audience?semaine=2026-12-14").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.audience_id === creation.body.audience_id);
    expect(ligne.juridiction).toBe("Tribunal du Commerce de Bamako");
    expect(ligne.type).toBe("plaidoirie");

    // Vue fiche dossier (audiences) reflète aussi la correction.
    const fiche = await request(app).get(`/api/dossiers/${dossierId}/audiences`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body[0].juridiction).toBe("Tribunal du Commerce de Bamako");
    expect(fiche.body[0].heure).toBe("11:00:00");
  });

  test("ne touche jamais resultat/motif_renvoi/prochaine_date — réservés à /retour", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2026-12-17", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });

    const maj = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`).send({ juridiction: "TGI Commune V" });
    expect(maj.status).toBe(200);
    expect(maj.body.resultat).toBe("delibere");
  });

  test("404 sur une audience inexistante", async () => {
    const res = await request(app).put("/api/roles-audience/audiences/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`).send({ juridiction: "Test" });
    expect(res.status).toBe(404);
  });
});

// 14/10/2026 — gap signalé par l'utilisateur sur "Programmer une audience" :
// le type "Autre" n'avait aucun champ de saisie du libellé réel (contrairement
// à "Procédure", qui a déjà ce patron type/precision).
describe("type_precision — libellé libre pour le type d'audience 'Autre'", () => {
  test("se persiste à la création et s'affiche sur le Rôle d'audience", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-01", juridiction: "TGI Bamako", type: "autre", type_precision: "Audition d'un témoin" });
    expect(creation.status).toBe(201);

    const role = await request(app).get("/api/roles-audience?semaine=2027-03-01").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.audience_id === creation.body.audience_id);
    expect(ligne.type).toBe("autre");
    expect(ligne.type_precision).toBe("Audition d'un témoin");
  });

  test("corrigeable via PUT /audiences/:id, sans effacer si non fourni (COALESCE)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-02", juridiction: "TGI Bamako", type: "autre", type_precision: "Premier libellé" });

    const maj = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`).send({ type_precision: "Libellé corrigé" });
    expect(maj.status).toBe(200);
    expect(maj.body.type_precision).toBe("Libellé corrigé");

    // Un PUT qui ne fournit pas type_precision ne l'efface pas.
    const majSansPrecision = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`).send({ juridiction: "TGI Commune V" });
    expect(majSansPrecision.body.type_precision).toBe("Libellé corrigé");
  });

  test("reporté sur l'audience suite d'un renvoi (même type conservé)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-03", juridiction: "TGI Bamako", type: "autre", type_precision: "Audition d'un témoin" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-03-17" });
    expect(retour.status).toBe(200);

    const suite = await pool.query("SELECT type, type_precision FROM audiences WHERE id = $1", [retour.body.prochaine_inscrite.audience_id]);
    expect(suite.rows[0].type).toBe("autre");
    expect(suite.rows[0].type_precision).toBe("Audition d'un témoin");
  });

  test("NON reporté sur l'audience de prononcé d'un délibéré vidé (le type change)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-04", juridiction: "TGI Bamako", type: "autre", type_precision: "Audition d'un témoin" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere", prochaine_date: "2027-03-18" });
    expect(retour.status).toBe(200);

    const suite = await pool.query("SELECT type, type_precision FROM audiences WHERE id = $1", [retour.body.prochaine_inscrite.audience_id]);
    expect(suite.rows[0].type).toBe("prononce");
    expect(suite.rows[0].type_precision).toBeNull();
  });
});

// 14/10/2026 — gap signalé par l'utilisateur sur "Retour d'audience" : le
// résultat "Autre" (18 valeurs possibles) n'avait aucun champ de saisie du
// libellé réel, contrairement au motif de renvoi (motif_renvoi_id/
// motif_renvoi_precision) qui a déjà ce patron.
describe("resultat_precision — libellé libre pour le résultat 'Autre'", () => {
  test("se persiste à la 1re saisie du retour et se relit via GET /roles-audience", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-05", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "autre", resultat_precision: "Rabat d'audience sur incident" });
    expect(retour.status).toBe(200);
    expect(retour.body.audience.resultat_precision).toBe("Rabat d'audience sur incident");

    const role = await request(app).get("/api/roles-audience?semaine=2027-03-05").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.audience_id === creation.body.audience_id);
    expect(ligne.resultat).toBe("autre");
    expect(ligne.resultat_precision).toBe("Rabat d'audience sur incident");

    // Exposée aussi sur la fiche dossier (GET /api/dossiers/:id/audiences).
    const fiche = await request(app).get(`/api/dossiers/${dossierId}/audiences`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body[0].resultat_precision).toBe("Rabat d'audience sur incident");
  });

  test("corrigeable via PUT /audiences/:id/retour, sans effacer si non fourni (COALESCE)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-03-06", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "autre", resultat_precision: "Premier libellé" });

    const maj = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat_precision: "Libellé corrigé" });
    expect(maj.status).toBe(200);
    expect(maj.body.audience.resultat_precision).toBe("Libellé corrigé");

    const majSansPrecision = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ observations: "Observation corrigée" });
    expect(majSansPrecision.body.audience.resultat_precision).toBe("Libellé corrigé");
  });
});

// 24/09/2026 — gap signalé par l'utilisateur (« aucune action... de sorte à
// ce que les rôles des semaines qui suivent aient matérialisé ces
// informations ») : "prochaine_date" devient obligatoire pour un renvoi, et
// un retour déjà saisi devient corrigeable (PUT dédié) sans dupliquer
// l'audience suivante déjà créée.
describe("POST/PUT /api/roles-audience/audiences/:id/retour — obligation + correction", () => {
  test("renvoi sans prochaine_date refusé (400)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-04", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi" });
    expect(retour.status).toBe(400);
  });

  test("renvoi avec prochaine_date inscrit l'audience suivante sur le rôle de la semaine cible", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-05", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-02-15" });
    expect(retour.status).toBe(200);
    expect(retour.body.prochaine_inscrite).toBeTruthy();

    const roleFutur = await request(app).get("/api/roles-audience?semaine=2027-02-15").set("Authorization", `Bearer ${token}`);
    const ligne = roleFutur.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne).toBeTruthy();
    expect(ligne.date_prevue.slice(0, 10)).toBe("2027-02-15");
  });

  test("un second POST /retour sur la même audience est refusé (409) — corrige la duplication silencieuse", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-06", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });
    const second = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "plaide" });
    expect(second.status).toBe(409);
  });

  test("PUT /retour refusé si aucun retour n'a encore été saisi (409)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-07", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const res = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });
    expect(res.status).toBe(409);
  });

  test("PUT /retour corrige la prochaine date en DÉPLAÇANT l'audience suivante (pas de doublon)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-08", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-02-16" });

    const correction = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ prochaine_date: "2027-03-22" });
    expect(correction.status).toBe(200);

    const ancienRole = await request(app).get("/api/roles-audience?semaine=2027-02-16").set("Authorization", `Bearer ${token}`);
    expect(ancienRole.body.lignes.find((l) => l.dossier_id === dossierId)).toBeFalsy();

    const nouveauRole = await request(app).get("/api/roles-audience?semaine=2027-03-22").set("Authorization", `Bearer ${token}`);
    const lignes = nouveauRole.body.lignes.filter((l) => l.dossier_id === dossierId);
    expect(lignes.length).toBe(1); // pas de doublon
    expect(lignes[0].date_prevue.slice(0, 10)).toBe("2027-03-22");

    // Historique du dossier reflète aussi le déplacement (une seule audience future).
    const fiche = await request(app).get(`/api/dossiers/${dossierId}/audiences`).set("Authorization", `Bearer ${token}`);
    const futures = fiche.body.filter((a) => a.date_audience && a.date_audience.slice(0, 10) === "2027-03-22");
    expect(futures.length).toBe(1);
  });

  test("PUT /retour refuse de repasser en renvoi sans prochaine date (400)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-09", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });

    const correction = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi" });
    expect(correction.status).toBe(400);
  });

  // 10/10/2026 — gap signalé par l'utilisateur : la tuile "Retour
  // d'audience" ne portait que la date de la prochaine audience, jamais son
  // heure. `prochaine_heure` est posée sur l'audience d'origine (miroir de
  // prochaine_date, pour la fiche dossier/le pré-remplissage de la
  // correction) ET sur l'audience "suite" elle-même (heure réelle, lue via
  // suite_heure dans la liste du rôle).
  test("renvoi avec prochaine_heure : posée sur l'audience d'origine ET sur l'audience suite (suite_heure)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-10", juridiction: "TGI Bamako", type: "mise_en_etat" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-02-17", prochaine_heure: "09:30" });
    expect(retour.status).toBe(200);
    expect(retour.body.audience.prochaine_heure.slice(0, 5)).toBe("09:30");

    const roleFutur = await request(app).get("/api/roles-audience?semaine=2027-01-10").set("Authorization", `Bearer ${token}`);
    const ligne = roleFutur.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.suite_heure.slice(0, 5)).toBe("09:30");
  });

  test("PUT /retour : changer seulement la date garde l'heure déjà connue sur l'audience suite (pas effacée)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-11", juridiction: "TGI Bamako", type: "mise_en_etat" });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-02-18", prochaine_heure: "10:00" });

    const correction = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ prochaine_date: "2027-03-23" });
    expect(correction.status).toBe(200);
    expect(correction.body.audience.prochaine_heure.slice(0, 5)).toBe("10:00"); // inchangée

    const roleFutur = await request(app).get("/api/roles-audience?semaine=2027-01-11").set("Authorization", `Bearer ${token}`);
    const ligne = roleFutur.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.suite_heure.slice(0, 5)).toBe("10:00"); // déplacée avec la date, pas effacée
  });
});

// 24/09/2026 — suite de la même discussion : (i) en-tête "au [rien]" sur une
// semaine encore vide (semaine_fin manquante dans le repli du GET), (ii)
// "Suite programmée" (aperçu inline) alimentée pour un renvoi ET une mise en
// délibéré avec date de prononcé (le backend chaîne déjà l'audience suivante
// pour tout résultat dès que prochaine_date est fournie — seul le formulaire
// écran restreignait jusqu'ici l'affichage du champ au seul renvoi).
describe("GET /api/roles-audience — semaine_fin toujours présente + Suite programmée", () => {
  test("semaine_fin calculée même sur une semaine sans aucun rôle créé", async () => {
    const res = await request(app).get("/api/roles-audience?semaine=2028-06-05").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.semaine_debut).toBe("2028-06-05"); // déjà un lundi
    expect(res.body.semaine_fin).toBe("2028-06-09"); // + 4 jours (vendredi, 10/10/2026 — 5 jours ouvrés, plus le dimanche)
  });

  test("renvoi : la ligne d'origine expose suite_date/suite_juridiction/suite_avocat_code (reportés depuis l'audience d'origine)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-10", juridiction: "TGI Bamako", type: "mise_en_etat", avocat_id: userId });
    await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "renvoi", prochaine_date: "2027-02-08" });

    const role = await request(app).get("/api/roles-audience?semaine=2027-01-04").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.suite_date.slice(0, 10)).toBe("2027-02-08");
    expect(ligne.suite_juridiction).toBe("TGI Bamako");
    expect(ligne.suite_avocat_code).toBeTruthy(); // reporté depuis l'audience d'origine (même audiencier tant que non redispatché)
  });

  test("mise en délibéré avec date de prononcé : même mécanique de chaînage qu'un renvoi", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-11", juridiction: "TGI Bamako", type: "plaidoirie" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere", prochaine_date: "2027-02-09" });
    expect(retour.status).toBe(200); // facultative pour "delibere" : acceptée même si techniquement pas "requise"
    expect(retour.body.prochaine_inscrite).toBeTruthy();

    const role = await request(app).get("/api/roles-audience?semaine=2027-01-11").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.resultat).toBe("delibere");
    expect(ligne.suite_date.slice(0, 10)).toBe("2027-02-09");

    const roleFutur = await request(app).get("/api/roles-audience?semaine=2027-02-08").set("Authorization", `Bearer ${token}`);
    expect(roleFutur.body.lignes.find((l) => l.dossier_id === dossierId)).toBeTruthy();
  });

  test("mise en délibéré SANS date de prononcé reste acceptée (facultative, pas de chaînage)", async () => {
    const dossierId = await creerClientEtDossier();
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-01-12", juridiction: "TGI Bamako", type: "plaidoirie" });
    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });
    expect(retour.status).toBe(200);
    expect(retour.body.prochaine_inscrite).toBeNull();

    const role = await request(app).get("/api/roles-audience?semaine=2027-01-11").set("Authorization", `Bearer ${token}`);
    const ligne = role.body.lignes.find((l) => l.dossier_id === dossierId);
    expect(ligne.suite_date).toBeNull();
  });
});
