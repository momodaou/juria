// JURIA — Générateur de courriers, lot 6 (05/11/2026) : rappels personnels (tuile du Tableau de bord, bandeau du registre) et filtres du registre.
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { pool } = require("./setup");

const VALEURS = { destinataire: "Monsieur le Directeur\nde la BDM SA", objet: "Objet lot 6", paragraphes: "Un paragraphe." };
let u;   // associé de test : rédacteur ET signataire

async function creerAssocie() {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const { rows } = await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) VALUES ($1,'Test','Lot6',$2,$3,'associe',TRUE,now()) RETURNING id",
    ["L6" + suffixe.slice(0, 6), "test.lot6." + suffixe + "@jfcavocats-mali.com", await bcrypt.hash("x-Lot6-123!", 4)]);
  return { id: rows[0].id, token: jwt.sign({ sub: rows[0].id, role: "associe", nom: "Test Lot6" }, SECRET, { expiresIn: "1h" }) };
}
const auth = (r, t) => r.set("Authorization", "Bearer " + t);
const rediger = (t = u.token) => auth(request(app).post("/api/courriers/rediger"), t).send({ gabarit: "standard", valeurs: VALEURS, signataire_id: u.id, sortie: "B" });

beforeAll(async () => { u = await creerAssocie(); });
afterAll(async () => { await pool.end(); });

describe("Rappels personnels", () => {
  test("aucun courrier : tout à zéro", async () => {
    const r = await auth(request(app).get("/api/courriers/mes-rappels"), u.token);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ a_signer_n: 0, brouillons_n: 0, brouillons_anciens_n: 0, reserves_n: 0, jours_ancien: 5 });
  });

  test("brouillons, brouillon ancien, lettre à signer, numéro réservé ; une lettre annulée ou signée ne compte plus", async () => {
    const a = (await rediger()).body.courrier;
    const b = (await rediger()).body.courrier;
    const c = (await rediger()).body.courrier;
    const d = (await rediger()).body.courrier;
    // b : brouillon ancien (8 jours) ; c : à signer ; d : annulée
    await pool.query("UPDATE courriers SET cree_le = now() - interval '8 days' WHERE id = $1::uuid", [b.id]);
    await pool.query("UPDATE courrier_versions SET cree_le = now() - interval '8 days' WHERE courrier_id = $1::uuid", [b.id]);
    expect((await auth(request(app).post("/api/courriers/" + c.id + "/soumettre-signature"), u.token)).status).toBe(200);
    expect((await auth(request(app).post("/api/courriers/" + d.id + "/annuler-numero"), u.token).send({ motif: "test" })).status).toBe(200);
    expect((await auth(request(app).post("/api/courriers/reserver-numero"), u.token).send({})).status).toBe(201);

    const r = (await auth(request(app).get("/api/courriers/mes-rappels"), u.token)).body;
    expect(r.brouillons_n).toBe(2);              // a et b (d annulée, c à signer)
    expect(r.brouillons_anciens_n).toBe(1);      // b
    expect(r.a_signer_n).toBe(1);                // c
    expect(r.reserves_n).toBe(1);
    expect(r.a_signer_apercu[0]).toMatchObject({ id: c.id, reference: c.reference });
    expect(r.brouillons_apercu[0].id).toBe(b.id);            // le plus ancien d'abord
    expect(r.brouillons_apercu[0].jours).toBeGreaterThanOrEqual(8);
    expect(Object.keys(r.a_signer_apercu[0]).sort()).toEqual(["id", "objet", "reference"]);   // aucune donnée sensible

    // la lettre à signer, une fois signée, sort du compteur
    await pool.query("UPDATE courriers SET etat_redaction = 'signee' WHERE id = $1::uuid", [c.id]);
    expect((await auth(request(app).get("/api/courriers/mes-rappels"), u.token)).body.a_signer_n).toBe(0);
    expect(a.id).toBeTruthy();
  });

  test("personnels : un autre utilisateur ne voit pas les lettres d'autrui", async () => {
    const autre = await creerAssocie();
    const r = (await auth(request(app).get("/api/courriers/mes-rappels"), autre.token)).body;
    expect(r).toMatchObject({ a_signer_n: 0, brouillons_n: 0, reserves_n: 0 });
  });
});

describe("Tuile du Tableau de bord", () => {
  test("le tableau de bord porte les mêmes compteurs que les rappels", async () => {
    const rap = (await auth(request(app).get("/api/courriers/mes-rappels"), u.token)).body;
    const dash = await auth(request(app).get("/api/dashboard"), u.token);
    expect(dash.status).toBe(200);
    expect(dash.body.courriers_depart).toMatchObject({
      a_signer_n: rap.a_signer_n, brouillons_n: rap.brouillons_n, brouillons_anciens_n: rap.brouillons_anciens_n, reserves_n: rap.reserves_n,
    });
  });
});

describe("Filtres du registre", () => {
  test("état de rédaction et « les miennes » (à signer par moi / rédigées par moi)", async () => {
    const x = await creerAssocie();
    // x rédige deux lettres ; l'une est à signer par u
    const l1 = (await auth(request(app).post("/api/courriers/rediger"), x.token).send({ gabarit: "standard", valeurs: VALEURS, signataire_id: u.id, sortie: "B" })).body.courrier;
    const l2 = (await auth(request(app).post("/api/courriers/rediger"), x.token).send({ gabarit: "standard", valeurs: VALEURS, signataire_id: x.id, sortie: "B" })).body.courrier;
    await auth(request(app).post("/api/courriers/" + l1.id + "/soumettre-signature"), x.token);
    const aSigner = (await auth(request(app).get("/api/courriers?etat=a_signer&moi=signer"), u.token)).body;
    expect(aSigner.some((c) => c.id === l1.id)).toBe(true);
    expect(aSigner.every((c) => c.etat_redaction === "a_signer" && c.signataire_id === u.id)).toBe(true);
    const miens = (await auth(request(app).get("/api/courriers?moi=auteur"), x.token)).body;
    expect(miens.map((c) => c.id).sort()).toEqual([l1.id, l2.id].sort());
    const brouillons = (await auth(request(app).get("/api/courriers?etat=brouillon&moi=auteur"), x.token)).body;
    expect(brouillons.map((c) => c.id)).toEqual([l2.id]);
    expect((await auth(request(app).get("/api/courriers?etat=inconnu&moi=auteur"), x.token)).body.length).toBe(2);   // état inconnu ignoré
  });
});
