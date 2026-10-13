// JURIA — 13/10/2026, réflexion de l'utilisateur sur les nouveaux dossiers :
// (1) débloquer les conflits à distance (registre GET /api/conflict-checks
// + e-mail immédiat aux titulaires de conflits.decision, le vrai bug
// trouvé étant qu'aucun chemin asynchrone n'existait — la décision n'était
// reachable que depuis l'écran du collaborateur bloqué lui-même) ;
// (2) notification générale à TOUT dossier créé par un non-associé, par
// principe d'accountability (jamais bloquant). Complété le même jour :
// l'administrateur général reçoit ce 2ᵉ volet (suivi transverse
// facturation/réclamations) mais JAMAIS le 1ᵉʳ volet conflits — précision
// explicite de l'utilisateur (« pas les notif d'autorisation de
// création »), déjà vraie par construction (conflits.decision = FALSE
// pour admin_general dans la Matrice), non retestée ici.
// ⚠️ Même jour, complément ultérieur : l'associé-fondateur est SUSPENDU
// des deux volets (demande explicite, motif externe non précisé, « on
// verra après le déblocage ») — `conflits.decision` repassée à FALSE pour
// ce rôle en production (déjà FALSE dans schema.sql, c'est la production
// qui avait dérivé), et `notifierAssociesNouveauDossier()` ne le pousse
// plus jamais dans ses destinataires (voir dossiers.js). Ne PAS réactiver
// sans demande explicite future.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { envoyerEmail } = require("../src/mailer");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // compte associé de référence (déjà seedé par setup.js)
let associeId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});

beforeEach(() => {
  envoyerEmail.mockClear();
});

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestNotif123!", 10);
  const email = `test.notif.${suffixe}@jfcavocats-mali.com`;
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Notif',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`N${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const jeton = jwt.sign({ sub: rows[0].id, role, nom: "Test Notif" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jeton, email };
}

async function creerClient(tokenAppelant, denomination) {
  const res = await request(app).post("/api/clients").set("Authorization", `Bearer ${tokenAppelant}`)
    .send({ type: "morale", denomination });
  return res.body;
}

function creerDossier(tokenAppelant, payload) {
  return request(app).post("/api/dossiers").set("Authorization", `Bearer ${tokenAppelant}`)
    .send({
      intitule: "Dossier test notification", pole: "contentieux", matiere: "Droit civil",
      mode_honoraires: "forfait", urgence: "moyenne", ...payload,
    });
}

describe("Conflits d'intérêts — registre + e-mail immédiat (13/10/2026)", () => {
  test("GET /api/conflict-checks refusé sans conflits.decision (collaborateur)", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const res = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${collab.token}`);
    expect(res.status).toBe(403);
  });

  test("contrôle 'potentiel' : e-mail envoyé à l'associé, apparaît dans le registre, disparaît après décision", async () => {
    const denomination = `Rapprochement Conflit ${Date.now()}`;
    await creerClient(token, denomination);

    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${token}`)
      .send({ intitule_projet: "Projet test conflit", noms: denomination });
    expect(check.status).toBe(201);
    expect(check.body.resultat).toBe("potentiel");

    // E-mail envoyé (hors chemin critique, mais awaité — voir conflicts.js).
    const appels = envoyerEmail.mock.calls.filter((c) => c[0].subject.includes("Conflit d'intérêts"));
    expect(appels.length).toBeGreaterThan(0);

    const registre = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${token}`);
    expect(registre.status).toBe(200);
    expect(registre.body.find((c) => c.id === check.body.id)).toBeDefined();

    await request(app).post(`/api/conflict-checks/${check.body.id}/decision`)
      .set("Authorization", `Bearer ${token}`).send({ decision: "accepte", motif: "Vérifié, pas de conflit réel." });

    const registreApres = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${token}`);
    expect(registreApres.body.find((c) => c.id === check.body.id)).toBeUndefined();
  });

  test("contrôle 'absence' : aucun e-mail envoyé", async () => {
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${token}`)
      .send({ intitule_projet: "Projet sans conflit", noms: `Inconnu${Date.now()}` });
    expect(check.body.resultat).toBe("absence");
    const appels = envoyerEmail.mock.calls.filter((c) => c[0].subject.includes("Conflit d'intérêts"));
    expect(appels.length).toBe(0);
  });
});

describe("Notification générale à la création d'un dossier (13/10/2026)", () => {
  // Destinataires filtrés par `to` exact (pas juste un comptage) : la base
  // de test partagée entre fichiers peut déjà contenir d'autres comptes
  // associé/admin_general créés par d'autres suites dans le même run.
  function appelsVers(email) {
    return envoyerEmail.mock.calls.filter(
      (c) => c[0].subject.includes("Nouveau dossier créé") && c[0].to === email
    );
  }

  test("dossier créé par un collaborateur → e-mail à l'associé ET à l'administrateur général", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const client = await creerClient(token, `Client notif ${Date.now()}`);
    const res = await creerDossier(collab.token, { client_id: client.id, responsable_id: associeId });
    expect(res.status).toBe(201);

    expect(appelsVers(EMAIL_TEST).length).toBeGreaterThan(0);
    expect(appelsVers(EMAIL_TEST)[0][0].html).toContain(res.body.numero);
    expect(appelsVers(adminGeneral.email).length).toBeGreaterThan(0);
  });

  test("dossier créé par un associé lui-même → l'administrateur général est notifiée, pas les autres associés (pas d'auto-notification)", async () => {
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const client = await creerClient(token, `Client notif associe ${Date.now()}`);
    const res = await creerDossier(token, { client_id: client.id, responsable_id: associeId });
    expect(res.status).toBe(201);

    expect(appelsVers(EMAIL_TEST).length).toBe(0);
    expect(appelsVers(adminGeneral.email).length).toBeGreaterThan(0);
  });

  test("dossier créé par l'administrateur général elle-même → les associés sont notifiés, pas elle (pas d'auto-notification, « pas les notif d'autorisation de création »)", async () => {
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const client = await creerClient(token, `Client notif admin général ${Date.now()}`);
    const res = await creerDossier(adminGeneral.token, { client_id: client.id, responsable_id: associeId });
    expect(res.status).toBe(201);

    expect(appelsVers(EMAIL_TEST).length).toBeGreaterThan(0);
    expect(appelsVers(adminGeneral.email).length).toBe(0);
  });

  test("associé-fondateur SUSPENDU : ne reçoit jamais cette notification, même pour un dossier créé par un collaborateur", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const fondateur = await creerUtilisateurRole("associe_fondateur");
    const client = await creerClient(token, `Client notif fondateur ${Date.now()}`);
    const res = await creerDossier(collab.token, { client_id: client.id, responsable_id: associeId });
    expect(res.status).toBe(201);

    expect(appelsVers(EMAIL_TEST).length).toBeGreaterThan(0); // l'associé classique continue de recevoir
    expect(appelsVers(fondateur.email).length).toBe(0); // le fondateur, suspendu, ne reçoit rien
  });

  test("associé-fondateur SUSPENDU : un dossier qu'il crée lui-même reste muet pour les associés (comportement inchangé)", async () => {
    const fondateur = await creerUtilisateurRole("associe_fondateur");
    const client = await creerClient(token, `Client notif fondateur createur ${Date.now()}`);
    const res = await creerDossier(fondateur.token, { client_id: client.id, responsable_id: associeId });
    expect(res.status).toBe(201);
    expect(appelsVers(EMAIL_TEST).length).toBe(0);
  });
});

describe("Associé-fondateur SUSPENDU de conflits.decision (13/10/2026)", () => {
  test("403 sur GET /api/conflict-checks pour un compte associé-fondateur", async () => {
    const fondateur = await creerUtilisateurRole("associe_fondateur");
    const res = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${fondateur.token}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/conflict-checks/:id — consulter un contrôle précis (13/10/2026, bug « actualiser réinitialise »)", () => {
  test("le créateur peut relire SON contrôle même sans conflits.decision", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const denomination = `Rapprochement Restaure ${Date.now()}`;
    await creerClient(token, denomination);
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${collab.token}`)
      .send({ intitule_projet: "Projet restauration", noms: denomination });
    expect(check.body.resultat).toBe("potentiel");

    const relecture = await request(app).get(`/api/conflict-checks/${check.body.id}`).set("Authorization", `Bearer ${collab.token}`);
    expect(relecture.status).toBe(200);
    expect(relecture.body.decision).toBe("en_attente");
    expect(relecture.body.noms_recherches).toBe(denomination);
  });

  test("un tiers (ni créateur, ni conflits.decision) reçoit 403", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const autre = await creerUtilisateurRole("collaborateur");
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${collab.token}`)
      .send({ intitule_projet: "Projet tiers", noms: `Tiers${Date.now()}` });

    const res = await request(app).get(`/api/conflict-checks/${check.body.id}`).set("Authorization", `Bearer ${autre.token}`);
    expect(res.status).toBe(403);
  });

  test("après décision, la relecture reflète l'état réel (pas 'en_attente')", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const denomination = `Rapprochement Decide ${Date.now()}`;
    await creerClient(token, denomination);
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${collab.token}`)
      .send({ intitule_projet: "Projet décidé", noms: denomination });

    await request(app).post(`/api/conflict-checks/${check.body.id}/decision`)
      .set("Authorization", `Bearer ${token}`).send({ decision: "accepte", motif: "Vérifié, homonyme." });

    const relecture = await request(app).get(`/api/conflict-checks/${check.body.id}`).set("Authorization", `Bearer ${collab.token}`);
    expect(relecture.status).toBe(200);
    expect(relecture.body.decision).toBe("accepte");
    expect(relecture.body.message).toContain("accepte");
  });

  test("contrôle inexistant → 404", async () => {
    const res = await request(app).get("/api/conflict-checks/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/conflict-checks — filtre 'resultat' + tri (13/10/2026 après-midi, bug « dossiers anciens affichés »)", () => {
  test("un contrôle 'absence' n'apparaît JAMAIS dans le registre (aucune décision n'a jamais été attendue)", async () => {
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${token}`)
      .send({ intitule_projet: "Projet sans conflit registre", noms: `Inconnu${Date.now()}` });
    expect(check.body.resultat).toBe("absence");

    const registre = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${token}`);
    expect(registre.body.find((c) => c.id === check.body.id)).toBeUndefined();
  });

  test("le plus récent contrôle 'potentiel' apparaît en premier (tri DESC)", async () => {
    const denomination = `Rapprochement Tri ${Date.now()}`;
    await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination });

    const ancien = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${token}`)
      .send({ intitule_projet: "Ancien", noms: denomination });
    const recent = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${token}`)
      .send({ intitule_projet: "Recent", noms: denomination });

    const registre = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${token}`);
    const iAncien = registre.body.findIndex((c) => c.id === ancien.body.id);
    const iRecent = registre.body.findIndex((c) => c.id === recent.body.id);
    expect(iRecent).toBeLessThan(iAncien); // le plus récent est avant (indice plus petit = plus haut dans la liste)
  });
});

describe("DELETE /api/conflict-checks/:id — retirer une entrée sans décision (13/10/2026 après-midi)", () => {
  test("supprime l'entrée, sans toucher à aucun dossier, réservé à conflits.decision", async () => {
    const denomination = `Rapprochement Suppr ${Date.now()}`;
    await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination });
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${token}`)
      .send({ intitule_projet: "A supprimer", noms: denomination });

    const dossiersAvant = await request(app).get("/api/dossiers").set("Authorization", `Bearer ${token}`);

    const suppr = await request(app).delete(`/api/conflict-checks/${check.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(suppr.status).toBe(204);

    const registre = await request(app).get("/api/conflict-checks").set("Authorization", `Bearer ${token}`);
    expect(registre.body.find((c) => c.id === check.body.id)).toBeUndefined();

    const dossiersApres = await request(app).get("/api/dossiers").set("Authorization", `Bearer ${token}`);
    expect(dossiersApres.body.length).toBe(dossiersAvant.body.length); // aucun dossier touché

    const audit = await request(app).get("/api/acces/audit").query({ action: "supprimer_conflit" })
      .set("Authorization", `Bearer ${token}`);
    expect(audit.body.find((a) => a.entite_id === check.body.id)).toBeDefined();
  });

  test("403 pour un compte sans conflits.decision", async () => {
    const collab = await creerUtilisateurRole("collaborateur");
    const denomination = `Rapprochement Suppr Collab ${Date.now()}`;
    await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination });
    const check = await request(app).post("/api/conflict-checks").set("Authorization", `Bearer ${collab.token}`)
      .send({ intitule_projet: "Collab", noms: denomination });

    const res = await request(app).delete(`/api/conflict-checks/${check.body.id}`).set("Authorization", `Bearer ${collab.token}`);
    expect(res.status).toBe(403);
  });

  test("404 sur un id inexistant", async () => {
    const res = await request(app).delete("/api/conflict-checks/00000000-0000-0000-0000-000000000000")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
