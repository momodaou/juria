// JURIA — 10-11/10/2026, Bloc B du diagnostic "instruction avocat ->
// collaborateur" (voir CLAUDE.md/HISTORY.md) : tuile "Tâches que j'ai
// confiées" (symétrique de "Mes tâches" côté donneur d'instruction) +
// job d'alerte quotidien sur les tâches en retard. Le job a été revu le
// lendemain (11/10/2026) : la version individualisée (un e-mail personnel
// par destinataire) a été remplacée par une diffusion collective à deux
// volets (technique/administratif), l'objectif réel étant l'assiduité de
// l'exécutant via une visibilité partagée — voir jobs/alertesTachesRetard.js.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { executerJobAlertesTachesRetard } = require("../src/jobs/alertesTachesRetard");
const { envoyerEmail } = require("../src/mailer");

let token, userId;

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
  const email = `test.blocb.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestBlocB123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','BlocB',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`B${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test BlocB" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, email, token: t };
}

function appelsVers(email) {
  return envoyerEmail.mock.calls.filter((c) => c[0].to === email);
}

describe("Tableau de bord — tuile « Tâches que j'ai confiées »", () => {
  test("une tâche confiée à quelqu'un d'autre apparaît dans le compte et l'aperçu", async () => {
    const assigne = await creerUtilisateurRole("collaborateur");
    const avant = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche confiée à un collaborateur", responsable_id: assigne.id });
    expect(creation.status).toBe(201);

    const apres = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(apres.body.taches_confiees_n).toBe(avant.body.taches_confiees_n + 1);
    expect(apres.body.taches_confiees_apercu.some((t) => t.id === creation.body.id)).toBe(true);

    const detail = await request(app).get("/api/dashboard/detail/taches_confiees").set("Authorization", `Bearer ${token}`);
    const ligne = detail.body.find((t) => t.id === creation.body.id);
    expect(ligne).toBeTruthy();
    expect(ligne.responsable).toBe("Test BlocB");
  });

  test("une tâche auto-assignée n'apparaît PAS dans « Tâches que j'ai confiées »", async () => {
    const avant = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    const creation = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`)
      .send({ titre: "Tâche auto-assignée", responsable_id: userId });
    expect(creation.status).toBe(201);

    const apres = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(apres.body.taches_confiees_n).toBe(avant.body.taches_confiees_n);
  });
});

// Le fichier accumule des tâches au fil des tests (base partagée, jamais
// réinitialisée entre deux tests) — les assertions portent donc sur le
// CONTENU (présence/absence d'un titre unique) plutôt que sur "0 e-mail
// envoyé à X", qui ne serait plus fiable dès qu'un autre test a déjà créé
// une tâche en retard concernant ce même rôle.
function contenuPour(email) {
  const appels = appelsVers(email);
  return appels.length ? appels[0][0].html : "";
}
function titreApparaitQuelquePart(titre) {
  return envoyerEmail.mock.calls.some((c) => c[0].html.includes(titre));
}
async function creerTacheEnRetard({ titre, type, statut = "a_faire", joursRetard = 3, responsableId }) {
  await pool.query(
    `INSERT INTO taches (titre, type, statut, echeance, responsable_id, cree_par)
     VALUES ($1, $2::type_tache, $3, current_date - $4::int, $5, $5)`,
    [titre, type, statut, joursRetard, responsableId]
  );
}

describe("Job alertesTachesRetard — diffusion collective à deux volets (technique/administratif)", () => {
  test("une tâche technique (dépôt) est signalée aux avocats et aux juristes", async () => {
    envoyerEmail.mockClear();
    const avocat = await creerUtilisateurRole("collaborateur");
    const juriste = await creerUtilisateurRole("juriste");
    const titre = `Dépôt au greffe ${Date.now()}`;
    await creerTacheEnRetard({ titre, type: "depot", responsableId: avocat.id });

    const resultat = await executerJobAlertesTachesRetard(pool);
    expect(resultat.techniques).toBeGreaterThanOrEqual(1);

    expect(contenuPour(avocat.email)).toContain(titre);
    expect(contenuPour(avocat.email)).toContain("Tâches techniques");
    expect(contenuPour(juriste.email)).toContain(titre);
  });

  test("une tâche technique n'est signalée ni à l'administrateur général ni à l'assistante (dépôt = technique, pas administratif)", async () => {
    envoyerEmail.mockClear();
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const assistante = await creerUtilisateurRole("assistante");
    const titre = `Rédaction de conclusions ${Date.now()}`;
    await creerTacheEnRetard({ titre, type: "redaction", responsableId: adminGeneral.id });

    await executerJobAlertesTachesRetard(pool);
    expect(contenuPour(adminGeneral.email)).not.toContain(titre);
    expect(contenuPour(assistante.email)).not.toContain(titre);
  });

  test("une tâche administrative (facturation) est signalée aux associés, à l'administrateur général et à l'assistante", async () => {
    envoyerEmail.mockClear();
    const associe = await creerUtilisateurRole("associe");
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const assistante = await creerUtilisateurRole("assistante");
    const titre = `Relance paiement ${Date.now()}`;
    await creerTacheEnRetard({ titre, type: "relance", responsableId: associe.id });

    const resultat = await executerJobAlertesTachesRetard(pool);
    expect(resultat.administratives).toBeGreaterThanOrEqual(1);

    expect(contenuPour(associe.email)).toContain(titre);
    expect(contenuPour(associe.email)).toContain("administratives/gestion");
    expect(contenuPour(adminGeneral.email)).toContain(titre);
    expect(contenuPour(assistante.email)).toContain(titre);
  });

  test("une tâche administrative n'est PAS signalée à un avocat collaborateur (non-associé) ni à un juriste", async () => {
    envoyerEmail.mockClear();
    const collaborateur = await creerUtilisateurRole("collaborateur");
    const juriste = await creerUtilisateurRole("juriste");
    const titre = `Collecte de pièces ${Date.now()}`;
    await creerTacheEnRetard({ titre, type: "collecte_pieces", responsableId: collaborateur.id });

    await executerJobAlertesTachesRetard(pool);
    expect(contenuPour(collaborateur.email)).not.toContain(titre);
    expect(contenuPour(juriste.email)).not.toContain(titre);
  });

  test("un associé concerné par les 2 volets ne reçoit qu'un seul e-mail avec les 2 sections", async () => {
    envoyerEmail.mockClear();
    const associe = await creerUtilisateurRole("associe");
    const titreTech = `Recherche jurisprudence ${Date.now()}`;
    const titreAdmin = `Autre tâche admin ${Date.now()}`;
    await creerTacheEnRetard({ titre: titreTech, type: "recherche", responsableId: associe.id });
    await creerTacheEnRetard({ titre: titreAdmin, type: "autre", responsableId: associe.id });

    await executerJobAlertesTachesRetard(pool);
    expect(appelsVers(associe.email).length).toBe(1);
    const html = contenuPour(associe.email);
    expect(html).toContain(titreTech);
    expect(html).toContain(titreAdmin);
    expect(html).toContain("Tâches techniques");
    expect(html).toContain("administratives/gestion");
  });

  test("une tâche dont l'échéance n'est pas encore passée n'apparaît dans aucun e-mail", async () => {
    envoyerEmail.mockClear();
    const futur = await creerUtilisateurRole("collaborateur");
    const titre = `Tâche future ${Date.now()}`;
    await creerTacheEnRetard({ titre, type: "recherche", responsableId: futur.id, joursRetard: -5 });

    await executerJobAlertesTachesRetard(pool);
    expect(titreApparaitQuelquePart(titre)).toBe(false);
  });

  test("une tâche terminée en retard n'apparaît dans aucun e-mail", async () => {
    envoyerEmail.mockClear();
    const termine = await creerUtilisateurRole("collaborateur");
    const titre = `Tâche terminée ${Date.now()}`;
    await creerTacheEnRetard({ titre, type: "redaction", statut: "termine", responsableId: termine.id });

    await executerJobAlertesTachesRetard(pool);
    expect(titreApparaitQuelquePart(titre)).toBe(false);
  });

  test("un profil hors des 2 groupes (comptable) ne reçoit jamais rien", async () => {
    envoyerEmail.mockClear();
    const comptable = await creerUtilisateurRole("comptable");
    const associe = await creerUtilisateurRole("associe");
    await creerTacheEnRetard({ titre: `Tâche admin comptable ${Date.now()}`, type: "facturation", responsableId: associe.id });

    await executerJobAlertesTachesRetard(pool);
    expect(appelsVers(comptable.email).length).toBe(0);
  });
});
