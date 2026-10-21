// JURIA — numérotation des dossiers, factures et courriers : plus de doublon
// « dossiers_numero_key » (21/10/2026). Le numéro d'ordre est « le plus grand déjà
// utilisé + 1 » (et non « le nombre + 1 »), et les créations simultanées se
// départagent par un réessai (dossiers) ou un verrou (factures, courriers).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token; let userId;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token; userId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

const client = async () => (await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Client num ${Date.now()}-${Math.random()}` })).body.id;
const dossier = (clientId, extra = {}) => request(app).post("/api/dossiers").set(auth()).send({
  client_id: clientId, intitule: "Dossier numérotation", pole: "contentieux", matiere: "x", code_matiere: "FON",
  mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId, ...extra });
const ordre = (numero) => Number(numero.match(/-(\d+)$/)[1]);

describe("Numérotation des dossiers", () => {
  test("créations simultanées : tous créés, numéros distincts", async () => {
    const c = await client();
    const reponses = await Promise.all(Array.from({ length: 10 }, () => dossier(c)));
    expect(reponses.map((r) => r.status)).toEqual(Array(10).fill(201));
    const numeros = reponses.map((r) => r.body.numero);
    expect(new Set(numeros).size).toBe(10);
  });

  test("après la suppression d'un dossier du milieu, la création suivante ne retombe pas sur un numéro pris", async () => {
    const c = await client();
    const a = (await dossier(c, { code_matiere: "IMM" })).body;
    const b = (await dossier(c, { code_matiere: "IMM" })).body;
    const d = (await dossier(c, { code_matiere: "IMM" })).body;
    expect([ordre(a.numero), ordre(b.numero), ordre(d.numero)]).toEqual([ordre(a.numero), ordre(a.numero) + 1, ordre(a.numero) + 2]);
    expect((await request(app).delete(`/api/dossiers/${b.id}`).set(auth())).status).toBeLessThan(300);
    const e = await dossier(c, { code_matiere: "IMM" });
    expect(e.status).toBe(201);
    expect(ordre(e.body.numero)).toBe(ordre(d.numero) + 1);
  });

  test("un numéro repris d'un import (plus grand que le comptage) n'entre pas en collision", async () => {
    const c = await client();
    const annee = new Date().getFullYear();
    expect((await dossier(c, { code_matiere: "ARB", numero: `CX-ARB-${annee}-0100` })).status).toBe(201);
    const suivant = await dossier(c, { code_matiere: "ARB" });
    expect(suivant.status).toBe(201);
    expect(suivant.body.numero).toBe(`CX-ARB-${annee}-0101`);
  });

  test("un numéro saisi à la main déjà utilisé : refus clair (409), pas d'erreur SQL brute", async () => {
    const c = await client();
    const premier = (await dossier(c, { code_matiere: "NUM" })).body;
    const doublon = await dossier(c, { code_matiere: "NUM", numero: premier.numero });
    expect(doublon.status).toBe(409);
    expect(doublon.body.error).toMatch(/existe déjà/);
    expect(doublon.body.error).not.toMatch(/duplicate key/);
  });

  test("requalification simultanée de dossiers IND : aucun doublon", async () => {
    const c = await client();
    const inds = await Promise.all(Array.from({ length: 6 }, () => dossier(c, { code_matiere: "IND" })));
    const rep = await Promise.all(inds.map((r) => request(app).put(`/api/dossiers/${r.body.id}`).set(auth()).send({ code_matiere: "SOC" })));
    expect(rep.map((r) => r.status)).toEqual(Array(6).fill(200));
    expect(new Set(rep.map((r) => r.body.numero)).size).toBe(6);
  });
});

describe("Numérotation des factures et des courriers", () => {
  test("émissions simultanées de factures : numéros distincts", async () => {
    const c = await client();
    const reps = await Promise.all(Array.from({ length: 8 }, () =>
      request(app).post("/api/factures").set(auth()).send({ client_id: c, mode: "forfait", montant_ht: 1000, taux_tva: 0 })));
    expect(reps.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(reps.map((r) => r.body.numero)).size).toBe(8);
  });

  test("facture : un numéro saisi plus grand que le comptage est respecté par la suivante", async () => {
    const c = await client();
    const yy = String(new Date().getFullYear()).slice(2);
    expect((await request(app).post("/api/factures").set(auth()).send({ client_id: c, mode: "forfait", montant_ht: 1000, taux_tva: 0, numero: `F-${yy}-900` })).status).toBe(201);
    const suivante = await request(app).post("/api/factures").set(auth()).send({ client_id: c, mode: "forfait", montant_ht: 1000, taux_tva: 0 });
    expect(suivante.status).toBe(201);
    expect(suivante.body.numero).toBe(`F-${yy}-901`);
  });

  test("courriers enregistrés simultanément : références distinctes", async () => {
    const reps = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      request(app).post("/api/courriers").set(auth()).send({ sens: "depart", type: "lettre", correspondant: `Destinataire ${i}`, objet: "Test numérotation" })));
    expect(reps.map((r) => r.status)).toEqual(Array(8).fill(201));
    expect(new Set(reps.map((r) => r.body.reference)).size).toBe(8);
  });
});
