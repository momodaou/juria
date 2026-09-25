// JURIA — 25/09/2026 : audit « modifier / supprimer / annuler » demandé par
// l'utilisateur. Échéances (traiter/annuler/modifier/reporter), tâches
// (modifier), pointage (autre jour, correction, calcul des heures, retrait),
// dépenses (retirer), paiements (lister/supprimer), congés approuvés
// (annuler).
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
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

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestCorrection123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Correction',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`K${suffixe.slice(0, 7)}`, `test.corr.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Correction" }, SECRET, { expiresIn: "1h" }) };
}

const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

async function creerClient() {
  const res = await request(app).post("/api/clients").set(auth())
    .send({ type: "morale", denomination: `Client corr ${Date.now()}-${Math.random()}` });
  return res.body.id;
}

async function creerDossier() {
  const clientId = await creerClient();
  const res = await request(app).post("/api/dossiers").set(auth()).send({
    intitule: "Dossier test corrections", client_id: clientId, pole: "contentieux",
    responsable_id: userId, mode_honoraires: "forfait",
  });
  return { dossierId: res.body.id, clientId };
}

describe("Échéances — PUT /api/evenements/:id + POST /:id/statut", () => {
  test("création sans intitulé : repli sur le libellé du type (plus de 400)", async () => {
    const { dossierId } = await creerDossier();
    const res = await request(app).post("/api/evenements").set(auth())
      .send({ dossier_id: dossierId, type: "delai_recours", date_echeance: "2026-12-01" });
    expect(res.status).toBe(201);
    expect(res.body.titre).toBe("Délai de recours");
  });

  test("report : la date change et les alertes repartent à zéro", async () => {
    const { dossierId } = await creerDossier();
    const ev = await request(app).post("/api/evenements").set(auth())
      .send({ dossier_id: dossierId, type: "depot", titre: "Dépôt conclusions", date_echeance: "2026-11-01" });
    await pool.query("UPDATE evenements SET alerte_j30 = TRUE, alerte_j15 = TRUE WHERE id = $1", [ev.body.id]);

    const maj = await request(app).put(`/api/evenements/${ev.body.id}`).set(auth())
      .send({ date_echeance: "2026-12-15", titre: "Dépôt conclusions (reporté)" });
    expect(maj.status).toBe(200);
    expect(maj.body.titre).toBe("Dépôt conclusions (reporté)");
    const { rows: [e] } = await pool.query(
      "SELECT date_echeance::date::text AS d, alerte_j30, alerte_j15 FROM evenements WHERE id = $1", [ev.body.id]
    );
    expect(e.d).toBe("2026-12-15");
    expect(e.alerte_j30).toBe(false);
    expect(e.alerte_j15).toBe(false);
  });

  test("modifier sans changer la date conserve les alertes déjà envoyées", async () => {
    const { dossierId } = await creerDossier();
    const ev = await request(app).post("/api/evenements").set(auth())
      .send({ dossier_id: dossierId, type: "depot", titre: "A", date_echeance: "2026-11-01" });
    await pool.query("UPDATE evenements SET alerte_j30 = TRUE WHERE id = $1", [ev.body.id]);
    await request(app).put(`/api/evenements/${ev.body.id}`).set(auth()).send({ titre: "B" });
    const { rows: [e] } = await pool.query("SELECT alerte_j30 FROM evenements WHERE id = $1", [ev.body.id]);
    expect(e.alerte_j30).toBe(true);
  });

  test("marquer traité : sort de la liste « à venir », double clic → 409, plus modifiable", async () => {
    const { dossierId } = await creerDossier();
    const ev = await request(app).post("/api/evenements").set(auth())
      .send({ dossier_id: dossierId, type: "depot", titre: "À traiter", date_echeance: "2026-10-10" });

    const t1 = await request(app).post(`/api/evenements/${ev.body.id}/statut`).set(auth()).send({ statut: "traite" });
    expect(t1.status).toBe(200);
    expect(t1.body.statut).toBe("traite");
    const t2 = await request(app).post(`/api/evenements/${ev.body.id}/statut`).set(auth()).send({ statut: "annule" });
    expect(t2.status).toBe(409);

    const liste = await request(app).get(`/api/evenements?dossier_id=${dossierId}`).set(auth());
    expect(liste.body.find((x) => x.id === ev.body.id)).toBeUndefined();
    // Reste visible (avec son statut) sur la fiche dossier.
    const fiche = await request(app).get(`/api/dossiers/${dossierId}/evenements`).set(auth());
    expect(fiche.body.find((x) => x.id === ev.body.id).statut).toBe("traite");

    const maj = await request(app).put(`/api/evenements/${ev.body.id}`).set(auth()).send({ titre: "X" });
    expect(maj.status).toBe(409);
  });

  test("statut invalide → 400, échéance inexistante → 404", async () => {
    const r1 = await request(app).post("/api/evenements/00000000-0000-0000-0000-000000000000/statut").set(auth()).send({ statut: "reporte" });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post("/api/evenements/00000000-0000-0000-0000-000000000000/statut").set(auth()).send({ statut: "annule" });
    expect(r2.status).toBe(404);
  });
});

describe("Tâches — PUT /api/taches/:id/details", () => {
  test("corrige titre, échéance, priorité, responsable", async () => {
    const autre = await creerUtilisateurRole("collaborateur");
    const t = await request(app).post("/api/taches").set(auth()).send({ titre: "Tâche avec fote", echeance: "2026-10-01" });
    const maj = await request(app).put(`/api/taches/${t.body.id}/details`).set(auth())
      .send({ titre: "Tâche corrigée", echeance: "2026-10-20", priorite: "haute", responsable_id: autre.id });
    expect(maj.status).toBe(200);
    expect(maj.body.titre).toBe("Tâche corrigée");
    expect(maj.body.priorite).toBe("haute");
    expect(maj.body.responsable_id).toBe(autre.id);
  });

  test("echeance: null retire l'échéance ; titre vide refusé", async () => {
    const t = await request(app).post("/api/taches").set(auth()).send({ titre: "T", echeance: "2026-10-01" });
    const maj = await request(app).put(`/api/taches/${t.body.id}/details`).set(auth()).send({ echeance: null });
    expect(maj.status).toBe(200);
    expect(maj.body.echeance).toBeNull();
    const vide = await request(app).put(`/api/taches/${t.body.id}/details`).set(auth()).send({ titre: "  " });
    expect(vide.status).toBe(400);
  });

  test("tâche terminée → 409", async () => {
    const t = await request(app).post("/api/taches").set(auth()).send({ titre: "Finie" });
    await request(app).put(`/api/taches/${t.body.id}`).set(auth()).send({ statut: "termine" });
    const maj = await request(app).put(`/api/taches/${t.body.id}/details`).set(auth()).send({ titre: "Y" });
    expect(maj.status).toBe(409);
  });
});

describe("Pointage — date, correction, heures calculées, retrait", () => {
  test("heures calculées depuis arrivée/départ (le compteur restait à 0 h)", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    const res = await request(app).post("/api/cabinet/presences").set(auth(u.token))
      .send({ date_jour: "2026-09-01", heure_arrivee: "08:00", heure_depart: "17:30" });
    expect(res.status).toBe(201);
    expect(Number(res.body.heures)).toBe(9.5);
    const mois = await request(app).get("/api/cabinet/presences?mois=2026-09-01").set(auth(u.token));
    expect(Number(mois.body.total_heures)).toBe(9.5);
  });

  test("pointage en deux temps (arrivée puis départ) calcule les heures au départ", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/cabinet/presences").set(auth(u.token)).send({ date_jour: "2026-09-02", heure_arrivee: "09:00" });
    const res = await request(app).post("/api/cabinet/presences").set(auth(u.token)).send({ date_jour: "2026-09-02", heure_depart: "12:00" });
    expect(Number(res.body.heures)).toBe(3);
  });

  test("correction (remplacer) efface un départ erroné ; date future refusée", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/cabinet/presences").set(auth(u.token))
      .send({ date_jour: "2026-09-03", heure_arrivee: "08:00", heure_depart: "18:00" });
    const corr = await request(app).post("/api/cabinet/presences").set(auth(u.token))
      .send({ date_jour: "2026-09-03", heure_arrivee: "08:30", remplacer: true });
    expect(corr.body.heure_depart).toBeNull();
    expect(corr.body.heures).toBeNull();
    const futur = await request(app).post("/api/cabinet/presences").set(auth(u.token)).send({ date_jour: "2099-01-01", heure_arrivee: "08:00" });
    expect(futur.status).toBe(400);
  });

  test("retrait de son propre pointage ; 404 si rien ce jour-là", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/cabinet/presences").set(auth(u.token)).send({ date_jour: "2026-09-04", heure_arrivee: "08:00" });
    const del = await request(app).delete("/api/cabinet/presences/2026-09-04").set(auth(u.token));
    expect(del.status).toBe(204);
    const del2 = await request(app).delete("/api/cabinet/presences/2026-09-04").set(auth(u.token));
    expect(del2.status).toBe(404);
  });

  test("consulter le pointage d'un autre sans supervision RH → 403", async () => {
    const a = await creerUtilisateurRole("collaborateur");
    const b = await creerUtilisateurRole("collaborateur");
    const res = await request(app).get(`/api/cabinet/presences?utilisateur_id=${b.id}`).set(auth(a.token));
    expect(res.status).toBe(403);
    const direction = await request(app).get(`/api/cabinet/presences?utilisateur_id=${b.id}`).set(auth());
    expect(direction.status).toBe(200);
  });
});

describe("Dépenses — DELETE /api/depenses/:id (retirer avant décision)", () => {
  async function soumettre(t) {
    const res = await request(app).post("/api/depenses").set(auth(t))
      .send({ type: "ponctuelle", categorie: "fournitures", libelle: "Ramette", montant: 5000 });
    return res.body.id;
  }

  test("le déposant retire sa dépense soumise", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    const id = await soumettre(u.token);
    const res = await request(app).delete(`/api/depenses/${id}`).set(auth(u.token));
    expect(res.status).toBe(204);
  });

  test("un tiers sans droit de décision → 403 ; dépense validée → 409", async () => {
    const deposant = await creerUtilisateurRole("collaborateur");
    const tiers = await creerUtilisateurRole("collaborateur");
    const id = await soumettre(deposant.token);
    const r1 = await request(app).delete(`/api/depenses/${id}`).set(auth(tiers.token));
    expect(r1.status).toBe(403);
    await request(app).post(`/api/depenses/${id}/decision`).set(auth()).send({ statut: "validee" });
    const r2 = await request(app).delete(`/api/depenses/${id}`).set(auth(deposant.token));
    expect(r2.status).toBe(409);
  });
});

describe("Paiements — GET/DELETE /api/factures/:id/paiements", () => {
  async function factureSoldee() {
    const clientId = await creerClient();
    const f = await request(app).post("/api/factures").set(auth())
      .send({ client_id: clientId, mode: "forfait", montant_ht: 100000, taux_tva: 0 });
    await request(app).post(`/api/factures/${f.body.id}/paiements`).set(auth()).send({ montant: 100000, mode: "virement" });
    return f.body.id;
  }

  test("supprimer un paiement recalcule le statut (payée → émise) et trace l'action", async () => {
    const id = await factureSoldee();
    const liste = await request(app).get(`/api/factures/${id}/paiements`).set(auth());
    expect(liste.status).toBe(200);
    expect(liste.body).toHaveLength(1);

    const del = await request(app).delete(`/api/factures/${id}/paiements/${liste.body[0].id}`).set(auth());
    expect(del.status).toBe(200);
    expect(del.body.statut).toBe("emise");
    const { rows } = await pool.query(
      "SELECT 1 FROM journal_audit WHERE action = 'supprimer_paiement' AND entite_id = $1", [id]
    );
    expect(rows).toHaveLength(1);
  });

  test("refusé si une rétrocession liée a déjà été décaissée", async () => {
    const id = await factureSoldee();
    const retro = await request(app).post("/api/retrocessions").set(auth())
      .send({ beneficiaire_id: userId, qualite: "associe", base_ht: 100000, facture_id: id });
    await request(app).post(`/api/retrocessions/${retro.body.id}/decaisser`).set(auth());
    const liste = await request(app).get(`/api/factures/${id}/paiements`).set(auth());
    const del = await request(app).delete(`/api/factures/${id}/paiements/${liste.body[0].id}`).set(auth());
    expect(del.status).toBe(409);
  });

  test("sans factures.annuler → 403", async () => {
    const id = await factureSoldee();
    const u = await creerUtilisateurRole("collaborateur");
    const liste = await request(app).get(`/api/factures/${id}/paiements`).set(auth());
    const del = await request(app).delete(`/api/factures/${id}/paiements/${liste.body[0].id}`).set(auth(u.token));
    expect(del.status).toBe(403);
  });
});

describe("Congés — POST /api/cabinet/conges/:id/annuler", () => {
  async function congeApprouve() {
    const c = await request(app).post("/api/cabinet/conges").set(auth())
      .send({ date_debut: "2026-12-20", date_fin: "2026-12-24" });
    await request(app).post(`/api/cabinet/conges/${c.body.id}/decision`).set(auth()).send({ statut: "approuve" });
    return c.body.id;
  }

  test("annule un congé approuvé, avec motif ; double annulation → 409", async () => {
    const id = await congeApprouve();
    const r1 = await request(app).post(`/api/cabinet/conges/${id}/annuler`).set(auth()).send({ motif: "Renonce" });
    expect(r1.status).toBe(200);
    expect(r1.body.statut).toBe("annule");
    const { rows: [c] } = await pool.query("SELECT motif FROM conges WHERE id = $1", [id]);
    expect(c.motif).toContain("Annulé : Renonce");
    const r2 = await request(app).post(`/api/cabinet/conges/${id}/annuler`).set(auth()).send({});
    expect(r2.status).toBe(409);
  });

  test("demande encore en attente → 409 (utiliser Retirer) ; sans droit de décision → 403", async () => {
    const c = await request(app).post("/api/cabinet/conges").set(auth())
      .send({ date_debut: "2026-12-01", date_fin: "2026-12-02" });
    const r1 = await request(app).post(`/api/cabinet/conges/${c.body.id}/annuler`).set(auth()).send({});
    expect(r1.status).toBe(409);
    const u = await creerUtilisateurRole("collaborateur");
    const id = await congeApprouve();
    const r2 = await request(app).post(`/api/cabinet/conges/${id}/annuler`).set(auth(u.token)).send({});
    expect(r2.status).toBe(403);
  });
});
