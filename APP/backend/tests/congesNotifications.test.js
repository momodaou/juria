// JURIA — e-mails des demandes de congé (29/10/2026) : nouvelle demande → personnes habilitées à être averties,
// décision → demandeur, annulation d'un congé approuvé → demandeur + habilitées ; jamais bloquant, confidentialité maladie.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const mailer = require("../src/mailer");
const { SECRET } = require("../src/auth");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let associe; let adminGen; let collab; let collab2; let spy;
const auth = (u) => ({ Authorization: `Bearer ${u.token}` });
const suffixe = () => Math.random().toString(36).slice(2, 8);

async function creerUtilisateur(role, prenom) {
  const s = suffixe();
  const email = `conge.${s}@jfcavocats-mali.com`;
  const { rows } = await pool.query(
    `INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le)
     VALUES ($1,$2,'Congé',$3,$4,$5::role_utilisateur,TRUE,now()) RETURNING id`,
    [`C${s.slice(0, 6)}`.toUpperCase(), prenom, email, await bcrypt.hash("TestConge123!", 4), role]);
  return { id: rows[0].id, email, prenom, token: jwt.sign({ sub: rows[0].id, role, nom: prenom }, SECRET, { expiresIn: "1h" }) };
}
const attendre = async (cond, ms = 2500) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25)); };
const envoyes = () => spy.mock.calls.map((c) => c[0]);
const vers = (email) => envoyes().filter((m) => m.to === email);
const demande = (u, corps) => request(app).post("/api/cabinet/conges").set(auth(u)).send({ type: "annuel", ...corps });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const l = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  associe = { id: l.body.utilisateur.id, email: EMAIL_TEST, token: l.body.token };
  adminGen = await creerUtilisateur("admin_general", "Admine");
  collab = await creerUtilisateur("collaborateur", "Collab");
  collab2 = await creerUtilisateur("collaborateur", "Collabdeux");
  await pool.query("UPDATE utilisateurs SET email = $1 WHERE id = $2", [associe.email, associe.id]);
});
beforeEach(() => { spy = jest.spyOn(mailer, "envoyerEmail").mockResolvedValue({ envoye: true }); });
afterEach(() => spy.mockRestore());
afterAll(async () => { await pool.end(); });

describe("Nouvelle demande de congé", () => {
  test("avertit les associés et l'administration générale, jamais le demandeur ni les autres collaborateurs", async () => {
    const r = await demande(collab, { date_debut: "2038-01-05", date_fin: "2038-01-09" });
    expect(r.status).toBe(201);
    await attendre(() => vers(adminGen.email).length >= 1 && vers(associe.email).length >= 1);
    expect(vers(adminGen.email).length).toBe(1);
    expect(vers(associe.email).length).toBe(1);
    expect(vers(collab.email).length).toBe(0);
    expect(vers(collab2.email).length).toBe(0);
    const m = vers(adminGen.email)[0];
    expect(m.subject).toMatch(/Demande de congé annuel — Collab Congé/);
    expect(m.html).toContain("05/01/2038 au 09/01/2038 (5 jours)");
    expect(m.html).toContain("/cabinet");
  });

  test("signale les autres absences sur les mêmes dates", async () => {
    await demande(collab2, { date_debut: "2038-02-02", date_fin: "2038-02-06" });
    await attendre(() => spy.mock.calls.length >= 2);
    spy.mockClear();
    await demande(collab, { date_debut: "2038-02-04", date_fin: "2038-02-10" });
    await attendre(() => vers(adminGen.email).length >= 1);
    expect(vers(adminGen.email)[0].html).toContain("Collabdeux Congé");
  });

  test("congé maladie : le motif n'est jamais repris dans l'e-mail ; autre type : motif repris", async () => {
    await demande(collab, { type: "maladie", date_debut: "2038-03-02", date_fin: "2038-03-03", motif: "Intervention chirurgicale" });
    await attendre(() => vers(adminGen.email).length >= 1);
    expect(vers(adminGen.email)[0].html).not.toContain("chirurgicale");
    spy.mockClear();
    await demande(collab, { type: "sans_solde", date_debut: "2038-04-06", date_fin: "2038-04-07", motif: "Voyage familial" });
    await attendre(() => vers(adminGen.email).length >= 1);
    expect(vers(adminGen.email)[0].html).toContain("Voyage familial");
  });

  test("permission retirée dans la Matrice : plus d'e-mail pour ce rôle ; échec d'envoi : la demande est quand même enregistrée", async () => {
    await pool.query("UPDATE permissions_role SET autorise = FALSE WHERE role = 'admin_general' AND action_code = 'cabinet.conge.notifier'");
    const r1 = await demande(collab, { date_debut: "2038-05-04", date_fin: "2038-05-05" });
    expect(r1.status).toBe(201);
    await attendre(() => vers(associe.email).length >= 1);
    expect(vers(adminGen.email).length).toBe(0);
    await pool.query("UPDATE permissions_role SET autorise = TRUE WHERE role = 'admin_general' AND action_code = 'cabinet.conge.notifier'");
    spy.mockRejectedValue(new Error("SMTP indisponible"));
    const r2 = await demande(collab, { date_debut: "2038-06-01", date_fin: "2038-06-02" });
    expect(r2.status).toBe(201);
    const ligne = await pool.query("SELECT 1 FROM conges WHERE id = $1", [r2.body.id]);
    expect(ligne.rows.length).toBe(1);
  });
});

describe("Décision et annulation", () => {
  test("approuvé / refusé (avec motif) : e-mail au demandeur ; annulation d'un congé approuvé : demandeur + habilitées", async () => {
    const a = (await demande(collab, { date_debut: "2038-07-06", date_fin: "2038-07-10" })).body.id;
    const b = (await demande(collab2, { date_debut: "2038-08-03", date_fin: "2038-08-04" })).body.id;
    await attendre(() => spy.mock.calls.length >= 4);
    spy.mockClear();

    expect((await request(app).post(`/api/cabinet/conges/${a}/decision`).set(auth(associe)).send({ statut: "approuve" })).status).toBe(200);
    await attendre(() => vers(collab.email).length >= 1);
    expect(vers(collab.email)[0].subject).toMatch(/approuvée/);

    expect((await request(app).post(`/api/cabinet/conges/${b}/decision`).set(auth(associe)).send({ statut: "refuse", motif: "Période de dépôt des conclusions" })).status).toBe(200);
    await attendre(() => vers(collab2.email).length >= 1);
    expect(vers(collab2.email)[0].subject).toMatch(/refusée/);
    expect(vers(collab2.email)[0].html).toContain("dépôt des conclusions");
    const memo = await pool.query("SELECT motif FROM conges WHERE id = $1", [b]);
    expect(memo.rows[0].motif).toContain("Refus : Période de dépôt des conclusions");

    spy.mockClear();
    expect((await request(app).post(`/api/cabinet/conges/${a}/annuler`).set(auth(associe)).send({ motif: "Reporté" })).status).toBe(200);
    await attendre(() => vers(collab.email).length >= 1 && vers(adminGen.email).length >= 1);
    expect(vers(collab.email)[0].subject).toMatch(/Congé annulé/);
    expect(vers(adminGen.email).length).toBe(1);
    expect(vers(associe.email).length).toBe(0); // l'auteur de l'annulation n'est pas averti de sa propre action
  });
});
