// JURIA — retours manquants (audiences/diligences sans résultat/statut
// définitif après leur date), 24/09/2026. Voir CLAUDE.md/HISTORY.md pour
// la synthèse de conception complète (tuile Tableau de bord + surlignage
// Rôle d'audience + escalade e-mail quotidienne, question directe de
// l'utilisateur : « quelle solution existe-t-il lorsqu'une audience n'a
// pas eu de retour »).
// 24/09/2026 (complément) — mailer mocké pour pouvoir inspecter le HTML
// envoyé (mention de l'audiencier), même patron que motDePasseOublie.test.js.
jest.mock("../src/mailer", () => ({ envoyerEmail: jest.fn().mockResolvedValue({ envoye: true }) }));
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { executerJobAlertesRetoursManquants } = require("../src/jobs/alertesRetoursManquants");
const { envoyerEmail } = require("../src/mailer");

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
  const email = `test.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestRetour123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Retour',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`R${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test Retour" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: t };
}

async function creerDossierAvecClient() {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client retour manquant ${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: "Dossier test retour manquant", pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

async function creerAudience(dossierId, joursDecalage, avocatId) {
  const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
    .send({ dossier_id: dossierId, date_prevue: "2027-01-05", juridiction: "TGI Bamako", type: "mise_en_etat", avocat_id: avocatId || null });
  await pool.query(
    "UPDATE audiences SET date_audience = current_date + ($2 || ' days')::interval WHERE id = $1",
    [creation.body.audience_id, joursDecalage]
  );
  return creation.body.audience_id;
}

describe("Job alertesRetoursManquants — fenêtre glissante de 7 jours", () => {
  test("audience à -3 jours sans résultat entre dans la fenêtre, à -10 jours en sort", async () => {
    const dossierId = await creerDossierAvecClient();
    const avant = (await executerJobAlertesRetoursManquants(pool)).occurrences;

    await creerAudience(dossierId, -10); // hors fenêtre (trop ancien)
    const apresHorsFenetre = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    expect(apresHorsFenetre).toBe(avant);

    await creerAudience(dossierId, -3); // dans la fenêtre
    const apresDansFenetre = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    expect(apresDansFenetre).toBe(avant + 1);
  });

  test("audience du jour même (pas encore \"passée\") n'est jamais comptée", async () => {
    const dossierId = await creerDossierAvecClient();
    const avant = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    await creerAudience(dossierId, 0);
    const apres = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    expect(apres).toBe(avant);
  });

  test("audience avec résultat déjà saisi n'est jamais comptée, même en retard", async () => {
    const dossierId = await creerDossierAvecClient();
    const audienceId = await creerAudience(dossierId, -2);
    const avant = (await executerJobAlertesRetoursManquants(pool)).occurrences;

    await request(app).post(`/api/roles-audience/audiences/${audienceId}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });

    const apres = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    expect(apres).toBe(avant - 1);
  });

  test("diligence 'a_faire' en retard compte, 'fait' ne compte pas", async () => {
    const dossierId = await creerDossierAvecClient();
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_diligence: "2027-01-05", objet: "Test retour manquant" });
    await pool.query("UPDATE diligences SET date_diligence = current_date - INTERVAL '2 days' WHERE id = $1", [creation.body.id]);

    const avant = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    // Toujours "a_faire" par défaut : doit déjà compter.
    const apresAFaire = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    expect(apresAFaire).toBe(avant);

    await request(app).put(`/api/diligences/${creation.body.id}/statut`).set("Authorization", `Bearer ${token}`).send({ statut: "fait" });
    const apresFait = (await executerJobAlertesRetoursManquants(pool)).occurrences;
    expect(apresFait).toBe(avant - 1);
  });

  test("destinataires : associé/avocat stagiaire/collaborateur/juriste/assistante/admin général/admin IT inclus, fondateur/Of Counsel exclus", async () => {
    // Garantit au moins 1 occurrence pour que "destinataires" soit calculé sur un passage significatif.
    const dossierId = await creerDossierAvecClient();
    await creerAudience(dossierId, -2);

    const avant = (await executerJobAlertesRetoursManquants(pool)).destinataires;

    await creerUtilisateurRole("associe_fondateur");
    await creerUtilisateurRole("of_counsel");
    const apresExclus = (await executerJobAlertesRetoursManquants(pool)).destinataires;
    expect(apresExclus).toBe(avant);

    await creerUtilisateurRole("juriste");
    const apresJuriste = (await executerJobAlertesRetoursManquants(pool)).destinataires;
    expect(apresJuriste).toBe(avant + 1);

    await creerUtilisateurRole("associe");
    const apresAssocie = (await executerJobAlertesRetoursManquants(pool)).destinataires;
    expect(apresAssocie).toBe(avant + 2);

    // Complément demandé par l'utilisateur le même jour, après coup
    // (« j'ai oublié... ») : assistante juridique, admin général, admin IT.
    await creerUtilisateurRole("assistante");
    await creerUtilisateurRole("admin_general");
    await creerUtilisateurRole("admin_it");
    const apresComplement = (await executerJobAlertesRetoursManquants(pool)).destinataires;
    expect(apresComplement).toBe(avant + 5);
  });
});

describe("E-mail — mention de l'audiencier (24/09/2026, complément)", () => {
  test("le HTML mentionne l'audiencier affecté à l'audience, en italique/petit", async () => {
    envoyerEmail.mockClear();
    const dossierId = await creerDossierAvecClient();
    const audienceId = await creerAudience(dossierId, -2, userId); // userId = compte "associe" du test, prénom/nom connus
    const utilisateur = (await pool.query("SELECT prenom, nom FROM utilisateurs WHERE id = $1", [userId])).rows[0];
    const nomComplet = `${utilisateur.prenom} ${utilisateur.nom}`;

    await executerJobAlertesRetoursManquants(pool);
    expect(envoyerEmail).toHaveBeenCalled();
    const html = envoyerEmail.mock.calls[0][0].html;
    expect(html).toContain(`(audiencier : ${nomComplet})`);
    expect(html).toContain("font-style:italic");

    // Clôturée pour ne pas polluer les 2 tests suivants (occurrence qui
    // resterait sinon "sans résultat" — donc encore dans la fenêtre — pour
    // le reste de ce fichier).
    await request(app).post(`/api/roles-audience/audiences/${audienceId}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "delibere" });
  });

  test("aucune mention d'audiencier si l'audience n'a personne d'assigné", async () => {
    envoyerEmail.mockClear();
    const dossierId = await creerDossierAvecClient();
    await creerAudience(dossierId, -2); // pas d'avocat_id
    await executerJobAlertesRetoursManquants(pool);
    expect(envoyerEmail).toHaveBeenCalled();
    const html = envoyerEmail.mock.calls[0][0].html;
    expect(html).not.toContain("audiencier :");
  });

  test("une diligence en retard ne mentionne jamais d'audiencier (réservé aux audiences)", async () => {
    envoyerEmail.mockClear();
    const dossierId = await creerDossierAvecClient();
    const creation = await request(app).post("/api/diligences").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_diligence: "2027-01-05", membre_id: userId, objet: "Test audiencier diligence" });
    await pool.query("UPDATE diligences SET date_diligence = current_date - INTERVAL '2 days' WHERE id = $1", [creation.body.id]);

    await executerJobAlertesRetoursManquants(pool);
    expect(envoyerEmail).toHaveBeenCalled();
    const html = envoyerEmail.mock.calls[0][0].html;
    expect(html).not.toContain("audiencier :");
  });
});

describe("Tableau de bord — tuile 'Retours en attente'", () => {
  test("compte + aperçu incluent une audience en retard, gardés par audiences.consulter", async () => {
    const dossierId = await creerDossierAvecClient();
    await creerAudience(dossierId, -2);

    const agg = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${token}`);
    expect(agg.body.retours_manquants_n).toBeGreaterThanOrEqual(1);

    const detail = await request(app).get("/api/dashboard/detail/retours_manquants").set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.some((l) => l.dossier_id === dossierId && l.type === "audience")).toBe(true);
  });

  // Comptable : sans audiences.consulter en production (l'associé-fondateur,
  // utilisé à l'origine, a retrouvé ce droit — audit du 25/09/2026).
  test("null/403 pour un rôle sans audiences.consulter (comptable)", async () => {
    const fondateur = await creerUtilisateurRole("comptable");
    const agg = await request(app).get("/api/dashboard").set("Authorization", `Bearer ${fondateur.token}`);
    expect(agg.body.retours_manquants_n).toBeNull();

    const detail = await request(app).get("/api/dashboard/detail/retours_manquants").set("Authorization", `Bearer ${fondateur.token}`);
    expect(detail.status).toBe(403);
  });
});
