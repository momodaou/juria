// JURIA — vignettes de plaidoirie : ancrage sur l'instance, numéro, lien
// facturation (08/10/2026, voir CLAUDE.md/HISTORY.md pour l'analyse
// complète menée avec l'utilisateur). Une vignette marque l'entrée en
// procédure du cabinet sur UNE instance précise (jamais l'audience, jamais
// le dossier en général) — une seule fois par instance. Condition de
// décaissement uniforme (classique/abonnement/pro bono) : le mode
// d'honoraires du dossier doit être renseigné, pas de facture exigée.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; // compte "associe" (a depenses.vignettes.mouvement)
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

// Même patron que honoraires.test.js : un utilisateur frais par test pour
// ne jamais percuter le quota pro bono mensuel du compte partagé.
async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const email = `test.${suffixe}@jfcavocats-mali.com`;
  const hash = await bcrypt.hash("TestVignette123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Vignette',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`V${suffixe.slice(0, 7)}`, email, hash, role]
  );
  const t = jwt.sign({ sub: rows[0].id, role, nom: "Test Vignette" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: t };
}

async function creerClient() {
  const res = await request(app)
    .post("/api/clients")
    .set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client vignette ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

async function creerDossier(overrides = {}) {
  const clientId = await creerClient();
  const res = await request(app)
    .post("/api/dossiers")
    .set("Authorization", `Bearer ${token}`)
    .send({
      numero: `VIG-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      intitule: "Dossier test vignette",
      client_id: clientId,
      pole: "contentieux",
      responsable_id: userId,
      mode_honoraires: "forfait",
      ...overrides,
    });
  return res.body.id;
}

async function creerInstance(dossierId, degre = "premiere_instance") {
  const res = await request(app)
    .post(`/api/dossiers/${dossierId}/instances`)
    .set("Authorization", `Bearer ${token}`)
    .send({ degre });
  return res.body.id;
}

async function achat(payload) {
  return request(app).post("/api/depenses/vignettes").set("Authorization", `Bearer ${token}`).send(payload);
}

describe("Vignettes de plaidoirie — ancrage instance + facturation (08/10/2026)", () => {
  test("refuse la consommation si le stock est épuisé (409)", async () => {
    const dossierId = await creerDossier();
    const instanceId = await creerInstance(dossierId);
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 1 });
    expect(res.status).toBe(409);
  });

  test("achat (quantité simple, sans plage) alimente le stock", async () => {
    const avant = await request(app).get("/api/depenses/vignettes/stock").set("Authorization", `Bearer ${token}`);
    const res = await achat({ quantite: 5 });
    expect(res.status).toBe(201);
    const apres = await request(app).get("/api/depenses/vignettes/stock").set("Authorization", `Bearer ${token}`);
    expect(apres.body.stock).toBe(avant.body.stock + 5);
  });

  test("achat avec plage numero_debut/numero_fin alimente le pool de numéros disponibles et déduit la quantité", async () => {
    const res = await achat({ numero_debut: 10000, numero_fin: 10004 });
    expect(res.status).toBe(201);
    expect(res.body.quantite).toBe(5);
    const dispo = await request(app).get("/api/depenses/vignettes/numeros-disponibles").set("Authorization", `Bearer ${token}`);
    expect(dispo.body).toEqual(expect.arrayContaining([10000, 10001, 10002, 10003, 10004]));
  });

  test("achat d'un lot NON continu (plages + numéros isolés, 7 chiffres) : seuls les vrais numéros entrent au pool", async () => {
    const base = 4000000 + Math.floor(Math.random() * 400000);
    const p = (n) => String(n).padStart(7, "0");
    const texte = `${p(base)}-${p(base + 2)}, ${p(base + 50)}; ${p(base + 90)}`;
    const res = await achat({ numeros: texte });
    expect(res.status).toBe(201);
    expect(res.body.quantite).toBe(5);
    const dispo = await request(app).get("/api/depenses/vignettes/numeros-disponibles").set("Authorization", `Bearer ${token}`);
    for (const n of [base, base + 1, base + 2, base + 50, base + 90]) expect(dispo.body).toContain(n);
    // Un numéro situé entre deux plages n'a jamais été acheté : absent du pool.
    expect(dispo.body).not.toContain(base + 10);
    // Un numéro déjà enregistré est refusé (409), sans rien ajouter.
    const doublon = await achat({ numeros: p(base + 50) });
    expect(doublon.status).toBe(409);
  });

  test("achat : un numéro qui n'a pas exactement 7 chiffres est refusé (400)", async () => {
    expect((await achat({ numeros: "123456" })).status).toBe(400);
    expect((await achat({ numeros: "12345678" })).status).toBe(400);
    expect((await achat({ numeros: "1000001-1000000" })).status).toBe(400);
    expect((await achat({ numeros: "1000001, 1000001" })).status).toBe(400);
  });

  test("numero_fin < numero_debut est refusé (400)", async () => {
    const res = await achat({ numero_debut: 500, numero_fin: 400 });
    expect(res.status).toBe(400);
  });

  test("POST /api/depenses/vignettes avec mouvement='utilisation' est refusé — migré vers l'instance", async () => {
    const res = await achat({ mouvement: "utilisation", quantite: 1 });
    expect(res.status).toBe(400);
  });

  test("refusée (400) si le dossier n'est pas contentieux", async () => {
    const dossierId = await creerDossier({ pole: "conseil" });
    const instanceId = await creerInstance(dossierId);
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 20001 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/contentieux/i);
  });

  test("refusée (400) si le mode d'honoraires du dossier n'est pas renseigné", async () => {
    const dossierId = await creerDossier();
    const instanceId = await creerInstance(dossierId);
    await pool.query("UPDATE dossiers SET mode_honoraires = NULL WHERE id = $1", [dossierId]);
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 20002 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/mode d'honoraires/i);
  });

  test("enregistre une vignette (numéro libre) : lie une dépense refacturable et décrémente le stock", async () => {
    const dossierId = await creerDossier();
    const instanceId = await creerInstance(dossierId);
    const stockAvant = await request(app).get("/api/depenses/vignettes/stock").set("Authorization", `Bearer ${token}`);

    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 30001 });
    expect(res.status).toBe(201);
    expect(res.body.numero_vignette).toBe(30001);
    expect(res.body.refacturee).toBe(true);

    const stockApres = await request(app).get("/api/depenses/vignettes/stock").set("Authorization", `Bearer ${token}`);
    expect(stockApres.body.stock).toBe(stockAvant.body.stock - 1);

    const dossier = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    const instance = dossier.body.instances.find((i) => i.id === instanceId);
    expect(instance.numero_vignette).toBe(30001);

    const { rows: [depense] } = await pool.query("SELECT * FROM depenses WHERE id = $1", [res.body.depense_id]);
    expect(depense.categorie).toBe("vignette_plaidoirie");
    expect(depense.montant).toBe("10000");
    expect(depense.statut).toBe("decaissee");
    expect(depense.refacturable_client).toBe(true);
    expect(depense.dossier_id).toBe(dossierId);
  });

  test("refuse une deuxième vignette sur la même instance (409)", async () => {
    const dossierId = await creerDossier();
    const instanceId = await creerInstance(dossierId);
    const premiere = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 30002 });
    expect(premiere.status).toBe(201);

    const deuxieme = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 30003 });
    expect(deuxieme.status).toBe(409);
  });

  test("refuse un numéro déjà enregistré sur une autre instance (409)", async () => {
    const dossierId = await creerDossier();
    const instance1 = await creerInstance(dossierId, "premiere_instance");
    const instance2 = await creerInstance(dossierId, "appel");

    const premiere = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instance1}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 30004 });
    expect(premiere.status).toBe(201);

    const reutilisation = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instance2}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 30004 });
    expect(reutilisation.status).toBe(409);
  });

  test("consomme un numéro connu depuis le pool et le retire des disponibles", async () => {
    const dossierId = await creerDossier();
    const instanceId = await creerInstance(dossierId);
    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 10000 }); // pré-enregistré par l'achat avec plage ci-dessus
    expect(res.status).toBe(201);

    const dispo = await request(app).get("/api/depenses/vignettes/numeros-disponibles").set("Authorization", `Bearer ${token}`);
    expect(dispo.body).not.toContain(10000);
    expect(dispo.body).toEqual(expect.arrayContaining([10001, 10002, 10003, 10004]));
  });

  test("pro bono : la dépense créée n'est pas refacturable au client", async () => {
    const associe = await creerUtilisateurRole("associe");
    const dossierId = await creerDossier({ pro_bono: true, responsable_id: associe.id });
    const instanceId = await creerInstance(dossierId);

    const res = await request(app)
      .post(`/api/dossiers/${dossierId}/instances/${instanceId}/vignette`)
      .set("Authorization", `Bearer ${token}`)
      .send({ numero_vignette: 40001 });
    expect(res.status).toBe(201);
    expect(res.body.refacturee).toBe(false);

    const { rows: [depense] } = await pool.query("SELECT refacturable_client FROM depenses WHERE id = $1", [res.body.depense_id]);
    expect(depense.refacturable_client).toBe(false);
  });

  test("seuil d'alerte vignettes : GET/PUT /api/parametres/honoraires", async () => {
    const lecture = await request(app).get("/api/parametres/honoraires").set("Authorization", `Bearer ${token}`);
    expect(lecture.status).toBe(200);
    expect(typeof lecture.body.seuil_alerte_vignettes).toBe("number");

    const maj = await request(app)
      .put("/api/parametres/honoraires")
      .set("Authorization", `Bearer ${token}`)
      .send({ seuil_alerte_vignettes: 25 });
    expect(maj.status).toBe(200);
    expect(maj.body.seuil_alerte_vignettes).toBe(25);

    const relecture = await request(app).get("/api/parametres/honoraires").set("Authorization", `Bearer ${token}`);
    expect(relecture.body.seuil_alerte_vignettes).toBe(25);
  });
});
