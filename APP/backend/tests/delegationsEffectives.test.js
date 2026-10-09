// JURIA — délégations d'accès réellement effectives (09/10/2026).
//
// Constat avant cette évolution : une délégation (table delegations_acces)
// était purement déclarative — aucune route protégée, aucun middleware
// (requirePermission/requireRole), ni /api/profil ne la consultait jamais.
// Accorder une délégation ne donnait concrètement aucun droit supplémentaire
// à la personne (voir CLAUDE.md/HISTORY.md pour le constat fait en
// l'auditant, à la demande explicite de l'utilisateur : « menu déroulant
// avec les permissions précises, pour choisir l'autorisation exacte à
// déléguer à un profil »).
//
// Ce fichier vérifie que la délégation d'une action_code précise :
// - est réellement accordée (estAutorise consulte aussi delegations_acces
//   en plus de permissions_role, requirePermission en bénéficie),
// - se reflète dans GET /api/profil (menus/boutons du frontend),
// - cesse dès la révocation, et n'a jamais d'effet hors de sa période
//   (date_fin dépassée),
// - refuse un action_code hors catalogue à la création.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { pool } = require("./setup");

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestDeleg123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Deleg',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`D${suffixe.slice(0, 7)}`, `test.deleg.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Deleg" }, SECRET, { expiresIn: "1h" }) };
}

// Force un point de départ déterministe, indépendant de l'état réel (et
// mouvant) de la matrice en production — plutôt que de supposer qu'un rôle
// précis n'a pas "taches.creer" par défaut.
async function fermerPermission(role, actionCode) {
  await pool.query(
    `INSERT INTO permissions_role (role, action_code, autorise)
     VALUES ($1::role_utilisateur,$2,FALSE)
     ON CONFLICT (role, action_code) DO UPDATE SET autorise = FALSE`,
    [role, actionCode]
  );
}

afterAll(async () => {
  await pool.end();
});

describe("Délégations d'accès réellement effectives (09/10/2026)", () => {
  test("sans délégation : l'action reste refusée (403)", async () => {
    await fermerPermission("assistante", "taches.creer");
    const { token } = await creerUtilisateurRole("assistante");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${token}`).send({ titre: "Sans délégation" });
    expect(res.status).toBe(403);
  });

  test("délégation active sur l'action précise : accordée en pratique, puis révoquée", async () => {
    await fermerPermission("assistante", "taches.creer");
    const associe = await creerUtilisateurRole("associe");
    const beneficiaire = await creerUtilisateurRole("assistante");

    // Avant : toujours refusé.
    const avant = await request(app).post("/api/taches").set("Authorization", `Bearer ${beneficiaire.token}`).send({ titre: "Avant délégation" });
    expect(avant.status).toBe(403);

    const deleg = await request(app).post("/api/acces/delegations").set("Authorization", `Bearer ${associe.token}`).send({
      utilisateur_id: beneficiaire.id,
      description: "Remplacement ponctuel",
      action_code: "taches.creer",
      portee: "temporaire",
      date_fin: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    });
    expect(deleg.status).toBe(201);
    expect(deleg.body.action_code).toBe("taches.creer");

    // Pendant : accordée, y compris via le middleware requirePermission.
    const pendant = await request(app).post("/api/taches").set("Authorization", `Bearer ${beneficiaire.token}`).send({ titre: "Pendant délégation" });
    expect(pendant.status).toBe(201);

    // Reflétée dans /api/profil (ce qui pilote l'affichage des menus/boutons côté écran).
    const profil = await request(app).get("/api/profil").set("Authorization", `Bearer ${beneficiaire.token}`);
    expect(profil.body.permissions).toContain("taches.creer");

    // Révocation : redevient refusée.
    const revoque = await request(app).post(`/api/acces/delegations/${deleg.body.id}/revoquer`).set("Authorization", `Bearer ${associe.token}`);
    expect(revoque.status).toBe(200);
    const apres = await request(app).post("/api/taches").set("Authorization", `Bearer ${beneficiaire.token}`).send({ titre: "Après révocation" });
    expect(apres.status).toBe(403);
    const profilApres = await request(app).get("/api/profil").set("Authorization", `Bearer ${beneficiaire.token}`);
    expect(profilApres.body.permissions).not.toContain("taches.creer");
  });

  test("délégation déjà expirée (date_fin passée) : jamais effective", async () => {
    await fermerPermission("assistante", "taches.creer");
    const associe = await creerUtilisateurRole("associe");
    const beneficiaire = await creerUtilisateurRole("assistante");
    const deleg = await request(app).post("/api/acces/delegations").set("Authorization", `Bearer ${associe.token}`).send({
      utilisateur_id: beneficiaire.id,
      description: "Déjà expirée",
      action_code: "taches.creer",
      portee: "temporaire",
      date_debut: "2020-01-01",
      date_fin: "2020-01-31",
    });
    expect(deleg.status).toBe(201);
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${beneficiaire.token}`).send({ titre: "Expirée" });
    expect(res.status).toBe(403);
  });

  test("délégation permanente : effective même sans date_fin", async () => {
    await fermerPermission("assistante", "taches.creer");
    const associe = await creerUtilisateurRole("associe");
    const beneficiaire = await creerUtilisateurRole("assistante");
    const deleg = await request(app).post("/api/acces/delegations").set("Authorization", `Bearer ${associe.token}`).send({
      utilisateur_id: beneficiaire.id,
      description: "Rôle associé — permanent",
      action_code: "taches.creer",
      portee: "permanent",
    });
    expect(deleg.status).toBe(201);
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${beneficiaire.token}`).send({ titre: "Permanente" });
    expect(res.status).toBe(201);
  });

  test("délégation sans action_code : reste purement déclarative (aucun effet)", async () => {
    const associe = await creerUtilisateurRole("associe");
    const beneficiaire = await creerUtilisateurRole("assistante");
    const deleg = await request(app).post("/api/acces/delegations").set("Authorization", `Bearer ${associe.token}`).send({
      utilisateur_id: beneficiaire.id,
      description: "Juste une note, sans action précise",
      portee: "temporaire",
      date_fin: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    });
    expect(deleg.status).toBe(201);
    expect(deleg.body.action_code).toBeNull();
    await fermerPermission("assistante", "taches.creer");
    const res = await request(app).post("/api/taches").set("Authorization", `Bearer ${beneficiaire.token}`).send({ titre: "Note seule" });
    expect(res.status).toBe(403);
  });

  test("action_code hors catalogue : refusée (400)", async () => {
    const associe = await creerUtilisateurRole("associe");
    const beneficiaire = await creerUtilisateurRole("assistante");
    const res = await request(app).post("/api/acces/delegations").set("Authorization", `Bearer ${associe.token}`).send({
      utilisateur_id: beneficiaire.id,
      description: "Action inventée",
      action_code: "nimporte_quoi.invente",
    });
    expect(res.status).toBe(400);
  });

  test("catalogue des actions : accessible au cercle delegations, pas au-delà", async () => {
    const adminGeneral = await creerUtilisateurRole("admin_general");
    const assistante = await creerUtilisateurRole("assistante");
    const ok = await request(app).get("/api/acces/delegations/catalogue-actions").set("Authorization", `Bearer ${adminGeneral.token}`);
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.body)).toBe(true);
    expect(ok.body.some((a) => a.code === "taches.creer")).toBe(true);
    const refuse = await request(app).get("/api/acces/delegations/catalogue-actions").set("Authorization", `Bearer ${assistante.token}`);
    expect(refuse.status).toBe(403);
  });
});
