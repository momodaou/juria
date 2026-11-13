// JURIA — Atelier d'actes, lot C (13/11/2026) : requêtes unilatérales au président
// (saisie conservatoire, désignation de séquestre, mise en liberté provisoire).
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { validerDefinition } = require("../src/questionnaireActes");

const CODES = ["requete_saisie_conservatoire", "requete_designation_sequestre", "requete_mise_liberte_provisoire"];
let token, associeId, dossierMoral, dossierPhysique;
const auth = () => ({ Authorization: `Bearer ${token}` });
const generer = (dossierId, code, reponses) =>
  request(app).post("/api/actes/generer").set(auth()).send({ dossier_id: dossierId, mode: "modele", modele_code: code, reponses });

async function nouveauDossier(client) {
  const cl = await request(app).post("/api/clients").set(auth()).send(client);
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `UNI-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier requête unilatérale", pole: "contentieux",
    client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait",
  });
  return d.body.id;
}

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
  for (const code of CODES) {
    const { rows } = await pool.query("SELECT id FROM modeles_actes WHERE code = $1", [code]);
    expect((await request(app).post(`/api/actes/modeles/${rows[0].id}/valider`).set(auth())).status).toBe(200);
  }
  dossierMoral = await nouveauDossier({ type: "morale", denomination: `SOCIETE CREANCIERE ${Date.now()}`, forme_juridique: "SARL" });
  await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, type_partie, forme_juridique) VALUES ($1,'adverse','DEBITEUR FICTIF SA','morale','SA')", [dossierMoral]);
  dossierPhysique = await nouveauDossier({ type: "physique", prenom: "Paul", nom: `REQUERANT ${Date.now()}`, civilite: "M" });
});
afterAll(async () => { await pool.end(); });

describe("Requêtes unilatérales : définitions", () => {
  test("trois modèles créés « à valider », famille des requêtes unilatérales, définitions valides", async () => {
    const { rows } = await pool.query("SELECT code, champs, famille, textes_cites FROM modeles_actes WHERE code = ANY($1)", [CODES]);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(() => validerDefinition(r.champs)).not.toThrow();
      expect(r.famille).toBe("Requêtes unilatérales au président");
      expect(r.textes_cites.length).toBeGreaterThan(0);
    }
  });
});

describe("Saisie conservatoire", () => {
  test("saisie de créances au tribunal de commerce : débiteur, tiers saisi, montant, article 57, ordonnance, bordereau", async () => {
    const res = await generer(dossierMoral, "requete_saisie_conservatoire", {
      destinataire_titre: "mme_presidente", juridiction: "tc_bamako", mesure: "creances", tiers_saisi: "la banque X, sise à Bamako",
      montant: { valeur: 1000000, devise: "XOF" },
      faits: [{ texte: "Suivant contrat du 10 août 2021, la société a exécuté des travaux.", pieces: "Contrat\nFacture" }],
      mise_en_demeure: "oui", mise_en_demeure_date: "2021-11-15", menace: "le débiteur est en cessation de paiement apparente",
      citer_article_57: "oui", projet_ordonnance: "oui",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("REQUETE AUX FINS DE SAISIE CONSERVATOIRE DE CREANCES");
    expect(t).toContain("À Madame la Présidente du Tribunal de Commerce de Bamako.");
    expect(t).toContain("Pièce N°1 : Contrat\nPièce N°2 : Facture");
    expect(t).toContain("mise en demeure adressée au débiteur en date du 15 novembre 2021");
    expect(t).toContain("son recouvrement se trouve menacé : le débiteur est en cessation de paiement apparente");
    expect(t).toContain("article 57");
    expect(t).toContain("DEBITEUR FICTIF SA, SA");
    expect(t).toContain("entre les mains de la banque X, sise à Bamako");
    expect(t).toContain("F.CFA 1 000 000");
    expect(t).toContain("ORDONNANCE N°");
    expect(t).toContain("caduque si la mesure n'a pas été pratiquée dans un délai de trois mois");
    expect(t).toContain("BORDEREAU DES PIÈCES\n1. Contrat\n2. Facture");
    expect(t).not.toContain("{{");
  });

  test("saisie sur biens mobiliers, sans tiers saisi, sans mise en demeure, ni article 57, ni ordonnance", async () => {
    const res = await generer(dossierMoral, "requete_saisie_conservatoire", {
      destinataire_titre: "m_president", juridiction: "tgi_commune", commune: "VI", mesure: "biens", montant: { valeur: 500000, devise: "XOF" },
      faits: [{ texte: "Fait unique." }], menace: "des actes de dissipation sont à craindre", citer_article_57: "non", projet_ordonnance: "non",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("À Monsieur le Président du Tribunal de Grande Instance de la Commune VI du District de Bamako.");
    expect(t).toContain("REQUETE AUX FINS DE SAISIE CONSERVATOIRE\n");
    expect(t).toContain("sur les biens mobiliers corporels et incorporels à l'encontre de");
    expect(t).not.toContain("entre les mains");
    expect(t).not.toContain("mise en demeure");
    expect(t).not.toContain("article 57");
    expect(t).not.toContain("ORDONNANCE");
  });
});

describe("Désignation de séquestre", () => {
  test("séquestre par défaut, montant, durée, suspension, article 166, ordonnance", async () => {
    const res = await generer(dossierMoral, "requete_designation_sequestre", {
      destinataire_titre: "mme_presidente", juridiction: "tgi_commune", commune: "III",
      faits: [{ texte: "Un arrêt exécutoire a été rendu, un pourvoi est formé.", pieces: "Arrêt" }],
      montant: { valeur: 104937330, devise: "XOF" }, sequestre: "la Caisse Autonome de Recouvrement de Paiement des Avocats (CARPA)",
      duree_sequestre: "jusqu'à décision définitive sur le pourvoi", suspension: "oui", citer_article_166: "oui", projet_ordonnance: "oui",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("REQUETE AUX FINS DE DESIGNATION DE SEQUESTRE");
    expect(t).toContain("À Madame la Présidente du Tribunal de Grande Instance de la Commune III du District de Bamako.");
    expect(t).toContain("article 166");
    expect(t).toContain("entre les mains de la Caisse Autonome de Recouvrement de Paiement des Avocats (CARPA)");
    expect(t).toContain("jusqu'à décision définitive sur le pourvoi");
    expect(t).toContain("la consignation suspend toute procédure d'exécution");
    expect(t).toContain("ORDONNANCE N°");
    expect(t).not.toContain("{{");
    const sans = await generer(dossierMoral, "requete_designation_sequestre", {
      destinataire_titre: "m_president", juridiction: "tc_bamako", faits: [{ texte: "F." }], montant: { valeur: 1000, devise: "XOF" },
      sequestre: "Maître X, séquestre", duree_sequestre: "jusqu'au jugement", suspension: "non", citer_article_166: "non", projet_ordonnance: "non",
    });
    expect(sans.status).toBe(201);
    expect(sans.body.texte).not.toContain("article 166");
    expect(sans.body.texte).not.toContain("suspend");
    expect(sans.body.texte).not.toContain("ORDONNANCE");
  });
});

describe("Mise en liberté provisoire", () => {
  test("identité du requérant, mandat de dépôt, garanties, antécédents, articles 148 et suivants", async () => {
    const res = await generer(dossierPhysique, "requete_mise_liberte_provisoire", {
      destinataire_titre: "m_president", juridiction_texte: "de la Chambre d'Instruction Criminelle de la Cour Suprême du Mali",
      autres_conseils: "l'Étude EXEMPLE, plaidant par Maître Untel",
      dossier_nom: "EXEMPLE-SA", infractions: "complicité d'atteinte aux biens publics", mandat_date: "2024-05-02", mandat_organe: "la Chambre d'Instruction",
      faits: [{ texte: "Il s'est largement expliqué sur les faits.", pieces: "Attestation" }],
      garanties: [{ texte: "le requérant demeure à Bamako et offre des garanties suffisantes de représentation" }],
      sans_antecedent: "oui", utilite_verite: "oui",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("REQUÊTE AUX FINS DE MISE EN LIBERTÉ PROVISOIRE");
    expect(t).toContain("À Monsieur le Président de la Chambre d'Instruction Criminelle de la Cour Suprême du Mali.");
    expect(t).toContain("REQUERANT");
    expect(t).toContain("pour Conseils : la SCPA JFC AVOCATS");
    expect(t).toContain("l'Étude EXEMPLE, plaidant par Maître Untel ;");
    expect(t).toContain("dans le cadre du dossier dit EXEMPLE-SA, le requérant a été inculpé de complicité d'atteinte aux biens publics");
    expect(t).toContain("placé sous mandat de dépôt en date du 2 mai 2024 par la Chambre d'Instruction");
    expect(t).toContain("Que le requérant demeure à Bamako et offre des garanties suffisantes de représentation ;");
    expect(t).toContain("Qu'il n'a aucun antécédent judiciaire");
    expect(t).toContain("articles 148 et suivants du Code de procédure pénale");
    expect(t).toContain("BORDEREAU DES PIÈCES\n1. Attestation");
    expect(t).not.toContain("{{");
  });

  test("sans autre conseil, sans dossier nommé, sans antécédent affirmé", async () => {
    const res = await generer(dossierPhysique, "requete_mise_liberte_provisoire", {
      destinataire_titre: "mme_presidente", juridiction_texte: "du Tribunal de Grande Instance de la Commune I",
      infractions: "des faits qualifiés", mandat_date: "2026-01-05", mandat_organe: "le juge d'instruction", sans_antecedent: "non", utilite_verite: "non",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("pour Conseil : la SCPA JFC AVOCATS");
    expect(t).toContain("dans le cadre du dossier, le requérant");
    expect(t).not.toContain("antécédent");
    expect(t).not.toContain("manifestation de la vérité");
    expect(t).not.toContain("BORDEREAU");
  });
});
