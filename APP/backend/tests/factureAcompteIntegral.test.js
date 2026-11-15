// JURIA — Facture « payée intégralement à l'émission » (15/11/2026) : acompte.integral reprend le total TTC calculé.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token, clientId;
const auth = () => ({ Authorization: `Bearer ${token}` });
const creer = (corps) => request(app).post("/api/factures").set(auth()).send({ client_id: clientId, mode: "forfait", montant_ht: 100000, ...corps });

beforeAll(async () => {
  await assurerUtilisateurTest();
  token = (await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST })).body.token;
  clientId = (await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client intégral ${Date.now()}` })).body.id;
});
afterAll(async () => { await pool.end(); });

describe("Paiement intégral à l'émission", () => {
  test("le total TTC (TVA, frais inclus) est repris tout seul : facture payée, un paiement du bon montant", async () => {
    const r = await creer({ taux_tva: 18, montant_frais: 5000, acompte: { integral: true, mode: "especes" } });
    expect(r.status).toBe(201);
    expect(Number(r.body.montant_ttc)).toBe(123000);        // 100 000 + 18 % + 5 000 de frais
    expect(r.body.statut).toBe("payee");
    expect(r.body.acompte).toBe(123000);
    const { rows } = await pool.query("SELECT montant FROM paiements WHERE facture_id = $1", [r.body.id]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].montant)).toBe(123000);
  });

  test("sans la case, comportement inchangé : acompte partiel → partielle ; sans acompte → émise", async () => {
    const partiel = await creer({ acompte: { montant: 30000, mode: "especes" } });
    expect(partiel.body.statut).toBe("partielle");
    const sans = await creer({});
    expect(sans.body.statut).toBe("emise");
    expect(sans.body.acompte).toBeUndefined();
  });

  test("moyen de paiement toujours exigé avec la case cochée", async () => {
    const r = await creer({ acompte: { integral: true } });
    expect(r.status).toBe(400);
  });

  test("un montant saisi qui dépasse le total reste refusé", async () => {
    const r = await creer({ taux_tva: 0, acompte: { montant: 999999, mode: "especes" } });
    expect(r.status).toBe(400);
  });
});
