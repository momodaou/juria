// JURIA — Discipline de facturation (18/09/2026). Voir CLAUDE.md/HISTORY.md
// pour la synthèse complète de conception. Couvre les Blocs A (mode
// d'honoraires obligatoire, montant convenu confidentiel, lettre de
// mission automatique + exemptions, suivi du retour signé), B (statut de
// facturation calculé — Rôle d'audience, liste des dossiers, Tableau de
// bord) et C (escalade par courriel — impayé + jamais facturé), plus la
// non-régression du fix apporté à DELETE /api/dossiers/:id.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { executerJobAlertesFacturationDiscipline } = require("../src/jobs/alertesFacturationDiscipline");

let token; // compte "associe"

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
  const email = `test.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestDisc123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Discipline',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`D${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test Discipline" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: t };
}

async function creerClient(overrides = {}) {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client discipline ${Date.now()}-${Math.random()}`, ...overrides });
  return res.body.id;
}

function creerDossier(tokenAppelant, payload) {
  return request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${tokenAppelant}`)
    .send({
      numero: `DISC-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test discipline facturation",
      pole: "contentieux",
      ...payload,
    });
}

describe("Mode d'honoraires obligatoire à la création", () => {
  test("refusé (400) sans mode_honoraires", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(token, { client_id: clientId, responsable_id: associe.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/honoraires/i);
  });

  test("refusé (400) : « autre » sans précision", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "autre",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/précision/i);
  });

  test("accepté (201) : « autre » avec précision, enregistrée", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "autre",
      mode_honoraires_precision: "Urgence — honoraires à convenir sous 48h",
    });
    expect(res.status).toBe(201);
    const relu = await request(app).get(`/api/dossiers/${res.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.mode_honoraires_precision).toBe("Urgence — honoraires à convenir sous 48h");
  });
});

describe("Montant convenu — verrouillé aux modes forfait / consultation / abonnement", () => {
  test("refusé (400) sur un dossier au temps passé", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const res = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "temps_passe", montant_convenu: 500000,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/non applicable/i);
  });

  test("accepté sur un dossier au forfait, visible du responsable", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(associe.token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait", montant_convenu: 500000,
    });
    expect(creation.status).toBe(201);
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${associe.token}`);
    expect(Number(relu.body.montant_convenu_xof)).toBe(500000);
  });

  test("refusé (400) via PUT si le mode effectif (déjà en base) ne le permet pas", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "temps_passe",
    });
    const res = await request(app)
      .put(`/api/dossiers/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ montant_convenu: 300000 });
    expect(res.status).toBe(400);
  });
});

describe("Confidentialité du montant convenu — responsable/intervenants + factures.consulter uniquement", () => {
  test("masqué pour un collaborateur non affecté, visible pour le responsable, un intervenant et un compte factures.consulter", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const intervenant = await creerUtilisateurRole("collaborateur");
    const nonAffecte = await creerUtilisateurRole("collaborateur");
    const comptable = await creerUtilisateurRole("comptable");

    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait", montant_convenu: 750000,
      intervenants: [{ utilisateur_id: intervenant.id }],
    });
    expect(creation.status).toBe(201);
    const id = creation.body.id;

    const vuParNonAffecte = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${nonAffecte.token}`);
    expect(vuParNonAffecte.body.montant_convenu_xof).toBeNull();

    const vuParResponsable = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${associe.token}`);
    expect(Number(vuParResponsable.body.montant_convenu_xof)).toBe(750000);

    const vuParIntervenant = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${intervenant.token}`);
    expect(Number(vuParIntervenant.body.montant_convenu_xof)).toBe(750000);

    const vuParComptable = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${comptable.token}`);
    expect(Number(vuParComptable.body.montant_convenu_xof)).toBe(750000);
  });
});

describe("Lettre de mission générée automatiquement à l'ouverture", () => {
  test("générée pour un dossier au forfait", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait",
    });
    expect(creation.status).toBe(201);
    expect(creation.body.lettre_mission_document_id).toBeTruthy();
    const { rows } = await pool.query("SELECT categorie, statut FROM documents WHERE id = $1", [creation.body.lettre_mission_document_id]);
    expect(rows[0].categorie).toBe("correspondance");
    expect(rows[0].statut).toBe("brouillon");
  });

  test("NON générée pour un dossier en abonnement (convention-cadre déjà signée)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "abonnement",
    });
    expect(creation.status).toBe(201);
    expect(creation.body.lettre_mission_document_id).toBeNull();
  });

  test("NON générée pour un success fee quand le client a déjà un dossier en abonnement", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "abonnement" });
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "success_fee",
    });
    expect(creation.status).toBe(201);
    expect(creation.body.lettre_mission_document_id).toBeNull();
  });

  test("générée pour un success fee autonome (client sans abonnement)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "success_fee",
    });
    expect(creation.status).toBe(201);
    expect(creation.body.lettre_mission_document_id).toBeTruthy();
  });
});

describe("Suivi du retour signé — purement informatif", () => {
  test("PUT /:id/lettre-mission-retour enregistre la date", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait",
    });
    const res = await request(app)
      .put(`/api/dossiers/${creation.body.id}/lettre-mission-retour`)
      .set("Authorization", `Bearer ${token}`)
      .send({ retour_le: "2026-09-20" });
    expect(res.status).toBe(200);
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(String(relu.body.lettre_mission_retour_le).slice(0, 10)).toBe("2026-09-20");
  });
});

// Discipline de facturation — Bloc B : visibilité continue (18/09/2026).
// statut_facturation calculé côté serveur (facturationDiscipline.js),
// réutilisé par dossiers.js (liste/fiche), audiences.js (Rôle d'audience)
// et dashboard.js (tuile Tableau de bord) — un seul calcul, testé ici sous
// ses 3 angles. `date_ouverture` manipulée directement en base (l'API ne
// permet pas de la choisir librement) pour simuler un dossier ancien.
async function reculerOuverture(dossierId, jours) {
  await pool.query("UPDATE dossiers SET date_ouverture = current_date - $1::int WHERE id = $2", [jours, dossierId]);
}

describe("statut_facturation — calcul et exemptions (Bloc B)", () => {
  test("NULL avant 30 jours, 'en_attente' à 30 jours, 'toujours_pas' à 60 jours", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    const id = creation.body.id;

    const frais = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${token}`);
    expect(frais.body.statut_facturation).toBeNull();

    await reculerOuverture(id, 31);
    const apres31j = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${token}`);
    expect(apres31j.body.statut_facturation).toBe("en_attente");

    await reculerOuverture(id, 61);
    const apres61j = await request(app).get(`/api/dossiers/${id}`).set("Authorization", `Bearer ${token}`);
    expect(apres61j.body.statut_facturation).toBe("toujours_pas");
  });

  test("NULL dès qu'une facture existe, même après 60 jours", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 90);
    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: creation.body.id, mode: "forfait", montant_ht: 100000 });
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.statut_facturation).toBeNull();
  });

  test.each(["success_fee", "abonnement"])("exempté pour le mode %s, même à 90 jours sans facture", async (mode) => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: mode });
    await reculerOuverture(creation.body.id, 90);
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.statut_facturation).toBeNull();
  });

  test("exempté pour un dossier pro bono, même à 90 jours (autre mécanisme, statut_honoraires)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(associe.token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait", pro_bono: true,
    });
    expect(creation.status).toBe(201);
    await reculerOuverture(creation.body.id, 90);
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.statut_facturation).toBeNull();
  });

  test("exempté pour un dossier clos, même à 90 jours sans facture", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 90);
    await request(app).put(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`).send({ statut: "clos" });
    const relu = await request(app).get(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(relu.body.statut_facturation).toBeNull();
  });

  test("visible sur la liste (GET /api/dossiers)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 61);
    const liste = await request(app).get("/api/dossiers").set("Authorization", `Bearer ${token}`);
    const ligne = liste.body.find((d) => d.id === creation.body.id);
    expect(ligne.statut_facturation).toBe("toujours_pas");
  });
});

describe("statut_facturation — Rôle d'audience (Bloc B, mention forte + responsable dossier)", () => {
  test("la ligne du rôle porte le statut_facturation et le nom du responsable dossier", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 61);

    const ligne = await request(app)
      .post("/api/roles-audience/lignes")
      .set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: creation.body.id, date_prevue: new Date().toISOString().slice(0, 10), type: "mise_en_etat" });
    expect(ligne.status).toBe(201);

    const role = await request(app).get("/api/roles-audience").set("Authorization", `Bearer ${token}`);
    const l = role.body.lignes.find((x) => x.dossier_id === creation.body.id);
    expect(l.statut_facturation).toBe("toujours_pas");
    expect(l.responsable_dossier_nom).toMatch(/Test Discipline/);
  });
});

describe("statut_facturation — tuile Tableau de bord (Bloc B)", () => {
  test("compté dans l'agrégat et présent dans le détail pour un compte factures.consulter", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 31);

    const agg = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(agg.body.dossiers_en_attente_facturation).toBeGreaterThanOrEqual(1);

    const detail = await request(app).get("/api/dashboard/detail/en_attente_facturation").set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.some((l) => l.dossier_id === creation.body.id)).toBe(true);
  });

  test("null/403 pour un rôle sans factures.consulter", async () => {
    const avocatStagiaire = await creerUtilisateurRole("avocat_stagiaire");
    const agg = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${avocatStagiaire.token}`);
    expect(agg.body.dossiers_en_attente_facturation).toBeNull();

    const detail = await request(app).get("/api/dashboard/detail/en_attente_facturation").set("Authorization", `Bearer ${avocatStagiaire.token}`);
    expect(detail.status).toBe(403);
  });
});

describe("Bloc C — escalade par courriel : alerte impayé", () => {
  test("factures.alerte_impaye_j60 à >60j, j90 en plus à >90j, idempotent", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: creation.body.id, mode: "forfait", montant_ht: 100000 });
    expect(facture.status).toBe(201);
    await pool.query("UPDATE factures SET date_echeance = current_date - INTERVAL '65 days' WHERE id = $1", [facture.body.id]);

    await executerJobAlertesFacturationDiscipline(pool);
    let f = (await pool.query("SELECT alerte_impaye_j60, alerte_impaye_j90 FROM factures WHERE id = $1", [facture.body.id])).rows[0];
    expect(f.alerte_impaye_j60).toBe(true);
    expect(f.alerte_impaye_j90).toBe(false);

    // Idempotent : un second passage à J65 ne change rien de plus.
    await executerJobAlertesFacturationDiscipline(pool);
    f = (await pool.query("SELECT alerte_impaye_j60, alerte_impaye_j90 FROM factures WHERE id = $1", [facture.body.id])).rows[0];
    expect(f.alerte_impaye_j90).toBe(false);

    // Passage à J95 : les deux paliers marqués en un seul passage.
    await pool.query("UPDATE factures SET date_echeance = current_date - INTERVAL '95 days' WHERE id = $1", [facture.body.id]);
    await executerJobAlertesFacturationDiscipline(pool);
    f = (await pool.query("SELECT alerte_impaye_j60, alerte_impaye_j90 FROM factures WHERE id = $1", [facture.body.id])).rows[0];
    expect(f.alerte_impaye_j60).toBe(true);
    expect(f.alerte_impaye_j90).toBe(true);
  });

  test("une facture réglée à temps n'est jamais concernée", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    const facture = await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: creation.body.id, mode: "forfait", montant_ht: 100000 });
    await pool.query("UPDATE factures SET date_echeance = current_date - INTERVAL '95 days', statut = 'payee' WHERE id = $1", [facture.body.id]);

    await executerJobAlertesFacturationDiscipline(pool);
    const f = (await pool.query("SELECT alerte_impaye_j60, alerte_impaye_j90 FROM factures WHERE id = $1", [facture.body.id])).rows[0];
    expect(f.alerte_impaye_j60).toBe(false);
    expect(f.alerte_impaye_j90).toBe(false);
  });
});

describe("Bloc C — escalade par courriel : alerte 'en attente de facturation'", () => {
  test("dossiers.alerte_facturation_j30 à 31j, j60 en plus à 61j", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 31);

    await executerJobAlertesFacturationDiscipline(pool);
    let d = (await pool.query("SELECT alerte_facturation_j30, alerte_facturation_j60 FROM dossiers WHERE id = $1", [creation.body.id])).rows[0];
    expect(d.alerte_facturation_j30).toBe(true);
    expect(d.alerte_facturation_j60).toBe(false);

    await reculerOuverture(creation.body.id, 61);
    await executerJobAlertesFacturationDiscipline(pool);
    d = (await pool.query("SELECT alerte_facturation_j30, alerte_facturation_j60 FROM dossiers WHERE id = $1", [creation.body.id])).rows[0];
    expect(d.alerte_facturation_j60).toBe(true);
  });

  test("un dossier exempté (success fee) n'est jamais concerné, même à 90 jours", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "success_fee" });
    await reculerOuverture(creation.body.id, 90);
    await executerJobAlertesFacturationDiscipline(pool);
    const d = (await pool.query("SELECT alerte_facturation_j30, alerte_facturation_j60 FROM dossiers WHERE id = $1", [creation.body.id])).rows[0];
    expect(d.alerte_facturation_j30).toBe(false);
    expect(d.alerte_facturation_j60).toBe(false);
  });

  test("un dossier déjà facturé n'est jamais concerné, même à 90 jours", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, { client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait" });
    await reculerOuverture(creation.body.id, 90);
    await request(app)
      .post("/api/factures")
      .set("Authorization", `Bearer ${token}`)
      .send({ client_id: clientId, dossier_id: creation.body.id, mode: "forfait", montant_ht: 50000 });
    await executerJobAlertesFacturationDiscipline(pool);
    const d = (await pool.query("SELECT alerte_facturation_j30, alerte_facturation_j60 FROM dossiers WHERE id = $1", [creation.body.id])).rows[0];
    expect(d.alerte_facturation_j30).toBe(false);
  });
});

describe("Bloc C — destinataires : tout avocat sauf fondateur/Of Counsel + admin général + comptable", () => {
  test("le nombre de destinataires augmente pour un nouvel associé, pas pour un fondateur ni un Of Counsel", async () => {
    const avant = (await executerJobAlertesFacturationDiscipline(pool)).destinataires;

    await creerUtilisateurRole("associe_fondateur");
    await creerUtilisateurRole("of_counsel");
    const apresExclus = (await executerJobAlertesFacturationDiscipline(pool)).destinataires;
    expect(apresExclus).toBe(avant);

    await creerUtilisateurRole("associe");
    const apresInclus = (await executerJobAlertesFacturationDiscipline(pool)).destinataires;
    expect(apresInclus).toBe(avant + 1);
  });
});

describe("Non-régression : suppression d'un dossier fraîchement créé toujours possible", () => {
  test("DELETE reste en 204 malgré la lettre de mission auto-générée", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait",
    });
    expect(creation.body.lettre_mission_document_id).toBeTruthy();
    const res = await request(app).delete(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
  });

  test("mais un VRAI document déposé en plus bloque toujours la suppression (409)", async () => {
    const clientId = await creerClient();
    const associe = await creerUtilisateurRole("associe");
    const creation = await creerDossier(token, {
      client_id: clientId, responsable_id: associe.id, mode_honoraires: "forfait",
    });
    await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage) VALUES ($1,'Pièce réelle','autre','brouillon','x/y.txt')`,
      [creation.body.id]
    );
    const res = await request(app).delete(`/api/dossiers/${creation.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(409);
  });
});
