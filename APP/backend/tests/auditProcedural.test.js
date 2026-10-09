// JURIA — Traçabilité procédurale du journal d'audit (09/10/2026, voir
// CLAUDE.md : « identifier au besoin, par le code d'un profil — mda/mdj/
// bco… — telle ou telle action effectuée », et le bandeau préventif
// « Dernière modification » sur la fiche dossier, pour éviter qu'un
// mélange d'informations entre collaborateurs sur un même dossier
// n'impacte une procédure sans que personne ne le remarque).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
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

async function creerClientEtDossier(suffixe) {
  const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
    .send({ type: "morale", denomination: `Client audit procédural ${suffixe}-${Date.now()}-${Math.random()}` });
  const dossier = await request(app).post("/api/dossiers").set("Authorization", `Bearer ${token}`)
    .send({
      client_id: client.body.id, intitule: `Dossier test audit ${suffixe}`, pole: "contentieux",
      matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
    });
  return dossier.body.id;
}

async function dernierAudit(entite, action, entiteId) {
  const res = await request(app)
    .get(`/api/acces/audit?entite=${entite}&action=${action}&limit=50`)
    .set("Authorization", `Bearer ${token}`);
  return res.body.find((a) => a.entite_id === entiteId);
}

describe("PUT /api/dossiers/:id — journalise avant/après sur les champs procéduraux", () => {
  test("un champ suivi (objet) produit une entrée avec code utilisateur + diff", async () => {
    const dossierId = await creerClientEtDossier("objet");
    const maj = await request(app).put(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`)
      .send({ objet: "Recouvrement de créance — nouvel objet" });
    expect(maj.status).toBe(200);

    const entree = await dernierAudit("dossiers", "modifier_dossier", dossierId);
    expect(entree).toBeTruthy();
    expect(entree.utilisateur_code).toBe("TREG");
    expect(entree.details.changements.objet.apres).toBe("Recouvrement de créance — nouvel objet");
  });

  test("un champ non suivi (intitulé seul) ne produit aucune entrée", async () => {
    const dossierId = await creerClientEtDossier("intitule-seul");
    const maj = await request(app).put(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`)
      .send({ intitule: "Intitulé corrigé, sans portée procédurale" });
    expect(maj.status).toBe(200);

    const fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification).toBeNull();
  });
});

describe("Rollup « dernière modification » — instances/parties/audiences/échéances d'un dossier", () => {
  test("instance : création puis correction puis retrait, reflétés sur la fiche dossier", async () => {
    const dossierId = await creerClientEtDossier("instance");

    const avant = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(avant.body.derniere_modification).toBeNull();

    const creation = await request(app).post(`/api/dossiers/${dossierId}/instances`).set("Authorization", `Bearer ${token}`)
      .send({ degre: "premiere_instance", juridiction: "TGI Bamako" });
    expect(creation.status).toBe(201);
    let fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("creer_instance");
    expect(fiche.body.derniere_modification.utilisateur_code).toBe("TREG");

    const correction = await request(app).put(`/api/dossiers/${dossierId}/instances/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`).send({ juridiction: "TGI Kati" });
    expect(correction.status).toBe(200);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("modifier_instance");
    const entreeCorrection = await dernierAudit("dossier_instances", "modifier_instance", creation.body.id);
    expect(entreeCorrection.details.changements.juridiction).toEqual({ avant: "TGI Bamako", apres: "TGI Kati" });
    expect(entreeCorrection.details.dossier_id).toBe(dossierId);

    const retrait = await request(app).delete(`/api/dossiers/${dossierId}/instances/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(retrait.status).toBe(204);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("supprimer_instance");
  });

  test("partie : création puis correction du rôle, reflétées sur la fiche dossier", async () => {
    const dossierId = await creerClientEtDossier("partie");
    const creation = await request(app).post(`/api/dossiers/${dossierId}/parties`).set("Authorization", `Bearer ${token}`)
      .send({ denomination: "Partie X" });
    expect(creation.status).toBe(201);
    let fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("creer_partie");

    const correction = await request(app).put(`/api/dossiers/${dossierId}/parties/${creation.body.id}`)
      .set("Authorization", `Bearer ${token}`).send({ role: "tiers" });
    expect(correction.status).toBe(200);
    const entree = await dernierAudit("dossier_parties", "modifier_partie", creation.body.id);
    expect(entree.details.changements.role).toEqual({ avant: "adverse", apres: "tiers" });
    expect(entree.details.dossier_id).toBe(dossierId);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("modifier_partie");
  });

  test("audience : création, correction et retour, reflétés sur la fiche dossier", async () => {
    const dossierId = await creerClientEtDossier("audience");
    const creation = await request(app).post("/api/roles-audience/lignes").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, date_prevue: "2027-05-01", juridiction: "TGI Bamako", type: "mise_en_etat" });
    expect(creation.status).toBe(201);
    let fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("creer_audience");

    const correction = await request(app).put(`/api/roles-audience/audiences/${creation.body.audience_id}`)
      .set("Authorization", `Bearer ${token}`).send({ juridiction: "TGI Kati" });
    expect(correction.status).toBe(200);
    const entreeCorrection = await dernierAudit("audiences", "modifier_audience", creation.body.audience_id);
    expect(entreeCorrection.details.changements.juridiction).toEqual({ avant: "TGI Bamako", apres: "TGI Kati" });
    expect(entreeCorrection.details.dossier_id).toBe(dossierId);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("modifier_audience");

    const retour = await request(app).post(`/api/roles-audience/audiences/${creation.body.audience_id}/retour`)
      .set("Authorization", `Bearer ${token}`).send({ resultat: "decision_rendue", observations: "RAS" });
    expect(retour.status).toBe(200);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("saisir_retour_audience");
  });

  test("échéance : création, correction et clôture, reflétées sur la fiche dossier", async () => {
    const dossierId = await creerClientEtDossier("echeance");
    const creation = await request(app).post("/api/evenements").set("Authorization", `Bearer ${token}`)
      .send({ dossier_id: dossierId, type: "delai_procedure", date_echeance: "2027-06-01" });
    expect(creation.status).toBe(201);
    let fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("creer_echeance");

    const correction = await request(app).put(`/api/evenements/${creation.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ date_echeance: "2027-06-15" });
    expect(correction.status).toBe(200);
    const entree = await dernierAudit("evenements", "modifier_echeance", creation.body.id);
    expect(entree.details.dossier_id).toBe(dossierId);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("modifier_echeance");

    const cloture = await request(app).post(`/api/evenements/${creation.body.id}/statut`).set("Authorization", `Bearer ${token}`)
      .send({ statut: "traite" });
    expect(cloture.status).toBe(200);
    fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification.action).toBe("traiter_echeance");
  });
});

describe("GET /api/acces/audit — filtres (09/10/2026)", () => {
  test("filtre par entite ne renvoie que les lignes de cette entité", async () => {
    const res = await request(app).get("/api/acces/audit?entite=dossier_parties&limit=20")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((a) => a.entite === "dossier_parties")).toBe(true);
  });

  test("filtre par utilisateur_id renvoie des entrées et expose le code court", async () => {
    const res = await request(app).get(`/api/acces/audit?utilisateur_id=${userId}&limit=5`)
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((a) => a.utilisateur_code === "TREG")).toBe(true);
  });

  test("plage de dates future (depuis) exclut tout l'historique déjà écrit", async () => {
    const res = await request(app).get("/api/acces/audit?depuis=2999-01-01&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });

  test("plage de dates passée (jusqu_au) exclut tout l'historique déjà écrit", async () => {
    const res = await request(app).get("/api/acces/audit?jusqu_au=2000-01-01&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
  });
});

// 09/10/2026 — suite de la demande utilisateur (« c'est quand même important
// de savoir qui a créé un dossier ou un client... apparent dans les
// fiches ») : `dossiers.cree_par` (nouvelle colonne, non rétroactive) et
// `clients.cree_par` (déjà en base depuis le premier schéma, jamais résolu
// ni affiché) + journalisation des modifications de fiche client (gap
// identique à celui comblé pour les dossiers plus haut dans ce fichier,
// jamais traité pour clients.js jusqu'ici).
describe("« Créé par » — dossiers et clients", () => {
  test("GET /api/dossiers/:id expose cree_par_code/cree_par_nom pour un dossier créé après le correctif", async () => {
    const dossierId = await creerClientEtDossier("cree-par");
    const fiche = await request(app).get(`/api/dossiers/${dossierId}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.status).toBe(200);
    expect(fiche.body.cree_par_code).toBe("TREG");
  });

  test("GET /api/clients/:id expose cree_par_code/cree_par_nom", async () => {
    const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination: `Client créateur ${Date.now()}-${Math.random()}` });
    const fiche = await request(app).get(`/api/clients/${client.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.status).toBe(200);
    expect(fiche.body.cree_par_code).toBe("TREG");
  });
});

describe("Modification de fiche client — journalisée + rollup « dernière modification »", () => {
  test("un champ d'identité suivi (denomination) produit une entrée avec code utilisateur + diff", async () => {
    const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination: `Client avant correction ${Date.now()}-${Math.random()}` });

    const avant = await request(app).get(`/api/clients/${client.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(avant.body.derniere_modification).toBeNull();

    const nouvelleDenom = `Client après correction ${Date.now()}`;
    const maj = await request(app).put(`/api/clients/${client.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ denomination: nouvelleDenom });
    expect(maj.status).toBe(200);

    const apres = await request(app).get(`/api/clients/${client.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(apres.body.derniere_modification.utilisateur_code).toBe("TREG");

    const entree = await dernierAudit("clients", "modifier_client", client.body.id);
    expect(entree).toBeTruthy();
    expect(entree.details.changements.denomination.apres).toBe(nouvelleDenom);
  });

  test("un champ non suivi (notes) ne produit aucune entrée", async () => {
    const client = await request(app).post("/api/clients").set("Authorization", `Bearer ${token}`)
      .send({ type: "morale", denomination: `Client notes seules ${Date.now()}-${Math.random()}` });
    const maj = await request(app).put(`/api/clients/${client.body.id}`).set("Authorization", `Bearer ${token}`)
      .send({ notes: "Simple complément d'information, sans enjeu d'identité." });
    expect(maj.status).toBe(200);

    const fiche = await request(app).get(`/api/clients/${client.body.id}`).set("Authorization", `Bearer ${token}`);
    expect(fiche.body.derniere_modification).toBeNull();
  });
});
