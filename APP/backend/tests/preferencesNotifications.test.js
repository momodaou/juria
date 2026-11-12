// JURIA — réglages personnels de notification (12/11/2026) : l'e-mail en plus seulement, valeurs par défaut du rôle,
// verrou des avocats sur l'e-mail d'urgence, chacun ne règle que les siens, filtrage des envois.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const prefs = require("../src/preferencesNotifications");
const { assurerUtilisateurTest, pool } = require("./setup");

async function creer(role) {
  const sfx = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestPref123!", 10);
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,'Test','Pref',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id`,
    [`P${sfx.slice(0, 7)}`, `test.pref.${sfx}@jfcavocats-mali.com`, hash, role]);
  return { id: rows[0].id, role, token: jwt.sign({ sub: rows[0].id, role, nom: "Test Pref" }, SECRET, { expiresIn: "1h" }) };
}
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });

beforeAll(async () => { await assurerUtilisateurTest(); });
afterAll(async () => { await pool.end(); });

describe("Réglages personnels de notification", () => {
  test("valeurs par défaut selon le rôle", async () => {
    const assoc = await creer("associe");
    const assistante = await creer("assistante");
    const a = await request(app).get("/api/notifications/preferences").set(auth(assoc));
    expect(a.status).toBe(200);
    expect(a.body.valeurs).toEqual({ recap_lundi: true, recap_quotidien: false, email_urgence: true });
    expect(a.body.verrouille.email_urgence).toBe(false);
    const s = await request(app).get("/api/notifications/preferences").set(auth(assistante));
    expect(s.body.valeurs).toEqual({ recap_lundi: true, recap_quotidien: false, email_urgence: false });
  });

  test("un associé peut couper l'e-mail d'urgence et le récap du lundi ; le choix est conservé", async () => {
    const assoc = await creer("associe");
    const r = await request(app).put("/api/notifications/preferences").set(auth(assoc)).send({ email_urgence: false, recap_lundi: false, recap_quotidien: true });
    expect(r.status).toBe(200);
    expect(r.body.valeurs).toEqual({ recap_lundi: false, recap_quotidien: true, email_urgence: false });
    const relu = await request(app).get("/api/notifications/preferences").set(auth(assoc));
    expect(relu.body.valeurs).toEqual({ recap_lundi: false, recap_quotidien: true, email_urgence: false });
    // un envoi partiel ne touche que ce qui est fourni
    const partiel = await request(app).put("/api/notifications/preferences").set(auth(assoc)).send({ recap_lundi: true });
    expect(partiel.body.valeurs).toEqual({ recap_lundi: true, recap_quotidien: true, email_urgence: false });
  });

  test("avocat : l'e-mail d'urgence (délais de procédure) ne peut pas être coupé", async () => {
    for (const role of ["collaborateur", "avocat_stagiaire", "of_counsel"]) {
      const u = await creer(role);
      const r = await request(app).put("/api/notifications/preferences").set(auth(u)).send({ email_urgence: false });
      expect(r.status).toBe(200);
      expect(r.body.valeurs.email_urgence).toBe(true);
      expect(r.body.verrouille.email_urgence).toBe(true);
    }
  });

  test("chacun ne règle que ses propres préférences (pas de paramètre d'identité accepté)", async () => {
    const a = await creer("associe");
    const b = await creer("associe");
    await request(app).put("/api/notifications/preferences").set(auth(a)).send({ utilisateur_id: b.id, email_urgence: false });
    const chezB = await request(app).get("/api/notifications/preferences").set(auth(b));
    expect(chezB.body.valeurs.email_urgence).toBe(true);
    expect((await request(app).get("/api/notifications/preferences")).status).toBe(401);
  });

  test("filtrer : ne garde que les personnes qui ont accepté le canal (défaut du rôle sans ligne, verrou appliqué)", async () => {
    const assoc = await creer("associe");
    const collab = await creer("collaborateur");
    const assistante = await creer("assistante");
    await request(app).put("/api/notifications/preferences").set(auth(assoc)).send({ email_urgence: false, recap_quotidien: true });
    const tous = [assoc, collab, assistante];
    expect((await prefs.filtrer(tous, "email_urgence", pool)).map((p) => p.id)).toEqual([collab.id]);
    expect((await prefs.filtrer(tous, "recap_quotidien", pool)).map((p) => p.id)).toEqual([assoc.id]);
    expect((await prefs.filtrer(tous, "recap_lundi", pool)).length).toBe(3);
    // même une ligne en base qui contredirait le verrou ne le contourne pas
    await pool.query("INSERT INTO preferences_notifications (utilisateur_id, recap_lundi, recap_quotidien, email_urgence) VALUES ($1,true,false,false)", [collab.id]);
    expect((await prefs.filtrer([collab], "email_urgence", pool)).length).toBe(1);
  });
});
