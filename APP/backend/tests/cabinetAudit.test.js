// JURIA — 27/09/2026 : audit du module Administratif & RH (Cabinet),
// demandé par l'utilisateur après avoir remarqué que le détail du pointage
// n'était pas consultable par les associés depuis l'écran.
//
// 2 points couverts ici :
// - GET /api/cabinet/conges n'avait AUCUNE restriction (ni requirePermission,
//   ni filtre forcé) : un rôle sans cabinet.conge.decision voyait les
//   demandes de TOUT le cabinet, motif inclus (santé pour maladie/
//   maternité/paternité) — corrigé pour suivre le même principe que
//   rétrocessions/bulletins (18/08/2026) : chacun voit toujours les siennes,
//   voir celles des autres exige cabinet.conge.decision.
// - GET /api/cabinet/presences accepte désormais une plage explicite
//   debut/fin (vue par semaine), en plus de mois — vérifié distinct du
//   total mensuel.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { pool } = require("./setup");

afterAll(async () => {
  await pool.end();
});

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestCabinetAudit123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','CabinetAudit',$2,$3,$4::role_utilisateur,TRUE,now())
     RETURNING id`,
    [`Z${suffixe.slice(0, 7)}`, `test.cabaudit.${suffixe}@jfcavocats-mali.com`, hash, role]
  );
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role, nom: "Test CabinetAudit" }, SECRET, { expiresIn: "1h" }) };
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

describe("Congés — GET /api/cabinet/conges restreint aux siens sans cabinet.conge.decision (27/09/2026)", () => {
  test("un collaborateur ne voit que ses propres demandes, y compris en tentant ?utilisateur_id=<autre>", async () => {
    const a = await creerUtilisateurRole("collaborateur");
    const b = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/cabinet/conges").set(auth(a.token))
      .send({ type: "annuel", date_debut: "2026-11-01", date_fin: "2026-11-02" });
    await request(app).post("/api/cabinet/conges").set(auth(b.token))
      .send({ type: "maladie", date_debut: "2026-11-03", date_fin: "2026-11-04", motif: "Confidentiel" });

    const res = await request(app).get("/api/cabinet/conges").set(auth(a.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((c) => c.utilisateur_id === a.id)).toBe(true);

    // Tentative de contournement : le paramètre est ignoré pour un rôle non autorisé.
    const tentative = await request(app).get(`/api/cabinet/conges?utilisateur_id=${b.id}`).set(auth(a.token));
    expect(tentative.status).toBe(200);
    expect(tentative.body.every((c) => c.utilisateur_id === a.id)).toBe(true);
    expect(tentative.body.some((c) => c.motif === "Confidentiel")).toBe(false);
  });

  test("associé (cabinet.conge.decision) voit les demandes des deux", async () => {
    const a = await creerUtilisateurRole("collaborateur");
    const b = await creerUtilisateurRole("collaborateur");
    const direction = await creerUtilisateurRole("associe");
    await request(app).post("/api/cabinet/conges").set(auth(a.token))
      .send({ type: "annuel", date_debut: "2026-11-05", date_fin: "2026-11-06" });
    await request(app).post("/api/cabinet/conges").set(auth(b.token))
      .send({ type: "annuel", date_debut: "2026-11-07", date_fin: "2026-11-08" });

    const res = await request(app).get("/api/cabinet/conges").set(auth(direction.token));
    expect(res.status).toBe(200);
    const ids = res.body.map((c) => c.utilisateur_id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
  });
});

describe("Pointage — GET /api/cabinet/presences?debut=&fin= (vue par semaine, 27/09/2026)", () => {
  test("une plage explicite ne renvoie que les jours de cette plage, total distinct du mois entier", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    await request(app).post("/api/cabinet/presences").set(auth(u.token))
      .send({ date_jour: "2026-09-05", heure_arrivee: "08:00", heure_depart: "16:00" }); // 8h, hors semaine testée
    await request(app).post("/api/cabinet/presences").set(auth(u.token))
      .send({ date_jour: "2026-09-21", heure_arrivee: "08:00", heure_depart: "17:00" }); // 9h, dans la semaine testée
    await request(app).post("/api/cabinet/presences").set(auth(u.token))
      .send({ date_jour: "2026-09-23", heure_arrivee: "08:00", heure_depart: "12:00" }); // 4h, dans la semaine testée

    const semaine = await request(app)
      .get("/api/cabinet/presences?debut=2026-09-21&fin=2026-09-27")
      .set(auth(u.token));
    expect(semaine.status).toBe(200);
    expect(semaine.body.jours.length).toBe(2);
    expect(Number(semaine.body.total_heures)).toBe(13);

    const mois = await request(app).get("/api/cabinet/presences?mois=2026-09-01").set(auth(u.token));
    expect(Number(mois.body.total_heures)).toBe(21);
  });

  test("plage invalide (fin avant début) refusée", async () => {
    const u = await creerUtilisateurRole("collaborateur");
    const res = await request(app)
      .get("/api/cabinet/presences?debut=2026-09-27&fin=2026-09-21")
      .set(auth(u.token));
    expect(res.status).toBe(400);
  });
});
