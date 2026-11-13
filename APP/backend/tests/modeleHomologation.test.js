// JURIA — Atelier d'actes, lot B (13/11/2026) : requête conjointe d'homologation de protocole d'accord transactionnel.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { validerDefinition } = require("../src/questionnaireActes");

const CODE = "requete_homologation_protocole";
let token, associeId, dossierId;
const auth = () => ({ Authorization: `Bearer ${token}` });
const generer = (reponses) =>
  request(app).post("/api/actes/generer").set(auth()).send({ dossier_id: dossierId, mode: "modele", modele_code: CODE, reponses });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
  const { rows } = await pool.query("SELECT id FROM modeles_actes WHERE code = $1", [CODE]);
  expect((await request(app).post(`/api/actes/modeles/${rows[0].id}/valider`).set(auth())).status).toBe(200);
  const cl = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `SOCIETE REQUERANTE ${Date.now()}`, forme_juridique: "SARL" });
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `HOM-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier homologation", pole: "contentieux",
    client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait",
  });
  dossierId = d.body.id;
  await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, type_partie, forme_juridique) VALUES ($1,'adverse','SOCIETE ADVERSE FICTIVE SA','morale','SA')", [dossierId]);
});
afterAll(async () => { await pool.end(); });

describe("Requête conjointe d'homologation de protocole transactionnel", () => {
  test("définition du questionnaire valide, modèle créé « à valider » dans la famille des requêtes conjointes", async () => {
    const { rows } = await pool.query("SELECT champs, famille, textes_cites FROM modeles_actes WHERE code = $1", [CODE]);
    expect(() => validerDefinition(rows[0].champs)).not.toThrow();
    expect(rows[0].famille).toBe("Requêtes conjointes");
    expect(rows[0].textes_cites[0].texte).toMatch(/87-31\/AN-RM/);
  });

  test("tribunal de commerce : deux parties, conseil adverse, exposé avec pièces, dispositif complet, ordonnance, bordereau", async () => {
    const res = await generer({
      destinataire_titre: "mme_presidente", juridiction: "tc_bamako", conseil_autre_partie: "Maître Conseil ADVERSE, Avocat au Barreau du Mali",
      faits: [{ texte: "Suivant contrat de vente conclu le 5 octobre 2023, la société a vendu une marchandise.", pieces: "Contrat de vente" },
              { texte: "La partie adverse est restée devoir un reliquat.", pieces: "Protocole d'accord transactionnel" }],
      protocole_date: "2025-05-31", chose_jugee: "oui", article_77: "oui", force_executoire: "oui", donner_acte: "oui", depens: "oui", projet_ordonnance: "oui",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("À Madame la Présidente du Tribunal de Commerce de Bamako.");
    expect(t).toContain("SOCIETE ADVERSE FICTIVE SA, SA");
    expect(t).toContain("Ayant pour conseil : Maître Conseil ADVERSE");
    expect(t).toContain("D'autre part ;");
    expect(t).toContain("Pièce N°1 : Contrat de vente");
    expect(t).toContain("protocole d'accord transactionnel en date du 31 mai 2025");
    expect(t).toContain("l'autorité de la chose jugée");
    expect(t).toContain("article 77 de la loi n° 87-31/AN-RM");
    expect(t).toContain("• Lui conférer la force exécutoire");
    expect(t).toContain("• Leur en donner acte ;");
    expect(t).toContain("• Mettre les dépens à la charge des parties.");
    expect(t).toContain("ORDONNANCE N°");
    expect(t).toContain("Président du Tribunal de Commerce de Bamako ;");
    expect(t).toContain("BORDEREAU DES PIÈCES\n1. Contrat de vente\n2. Protocole d'accord transactionnel");
    expect(t).not.toContain("{{");
  });

  test("TGI de commune, options retirées : pas de chose jugée, article 77, ordonnance ni conseil adverse", async () => {
    const res = await generer({
      destinataire_titre: "m_president", juridiction: "tgi_commune", commune: "III",
      faits: [{ texte: "Fait unique." }], protocole_date: "2026-08-07", entree_en_vigueur: "oui", article_homologation: "12",
      chose_jugee: "non", article_77: "non", force_executoire: "non", donner_acte: "non", depens: "non", projet_ordonnance: "non",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("À Monsieur le Président du Tribunal de Grande Instance de la Commune III du District de Bamako.");
    expect(t).toContain("aux termes de l'article 12 dudit protocole");
    expect(t).not.toContain("chose jugée");
    expect(t).not.toContain("article 77");
    expect(t).not.toContain("force exécutoire");
    expect(t).not.toContain("dépens");
    expect(t).not.toContain("ORDONNANCE");
    expect(t).not.toContain("Ayant pour conseil :");
    expect(t).not.toContain("BORDEREAU");
    expect(t).not.toContain("{{");
  });

  test("juridiction « autre » : désignation saisie, article d'homologation obligatoire si l'entrée en vigueur en dépend", async () => {
    const ok = await generer({ destinataire_titre: "m_president", juridiction: "autre", juridiction_autre: "du Tribunal du Travail de Bamako", faits: [{ texte: "F." }], protocole_date: "2026-01-02", projet_ordonnance: "non" });
    expect(ok.status).toBe(201);
    expect(ok.body.texte).toContain("À Monsieur le Président du Tribunal du Travail de Bamako.");
    const sans = await generer({ destinataire_titre: "m_president", juridiction: "tc_bamako", faits: [{ texte: "F." }], protocole_date: "2026-01-02", entree_en_vigueur: "oui" });
    expect(sans.status).toBe(400);
  });
});
