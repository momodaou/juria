// JURIA — modèles pilotes (28/10/2026) : questionnaire, validation, n° de courrier départ,
// lettre de constitution, requête conjointe de divorce, requête en injonction de payer.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { validerDefinition, traiterReponses } = require("../src/questionnaireActes");

let token, associeId;

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  associeId = login.body.utilisateur.id;
});

afterAll(async () => {
  await pool.end();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function nouveauDossier(extraClient = {}) {
  const cl = await request(app).post("/api/clients").set(auth()).send({
    type: "physique", prenom: "Paul", nom: `TESTEUR ${Date.now()}-${Math.random()}`, civilite: "M", ...extraClient,
  });
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    numero: `PIL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier pilote", pole: "contentieux",
    client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait",
  });
  return d.body.id;
}

async function valider(code) {
  const { rows } = await pool.query("SELECT id FROM modeles_actes WHERE code = $1", [code]);
  const r = await request(app).post(`/api/actes/modeles/${rows[0].id}/valider`).set(auth());
  expect(r.status).toBe(200);
}

const generer = (dossierId, code, reponses, extra = {}) =>
  request(app).post("/api/actes/generer").set(auth()).send({ dossier_id: dossierId, mode: "modele", modele_code: code, reponses, ...extra });

describe("Définition du questionnaire (unitaire)", () => {
  test("les trois modèles pilotes ont une définition valide", async () => {
    const { rows } = await pool.query("SELECT code, champs FROM modeles_actes WHERE code IN ('lettre_constitution_juridiction','requete_divorce_consentement_mutuel','requete_injonction_de_payer')");
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(() => validerDefinition(r.champs)).not.toThrow();
  });

  test.each([
    [[{ cle: "date", libelle: "x", type: "texte" }], /déjà une balise/],
    [[{ cle: "A b", libelle: "x", type: "texte" }], /invalide/],
    [[{ cle: "x", libelle: "x", type: "inconnu" }], /inconnu/],
    [[{ cle: "x", libelle: "x", type: "choix" }], /options/],
    [[{ cle: "x", libelle: "x", type: "texte" }, { cle: "x", libelle: "y", type: "texte" }], /double/],
    [[{ cle: "x", libelle: "x", type: "liste" }], /sous_champs/],
  ])("refuse %j", (champs, motif) => {
    expect(() => validerDefinition(champs)).toThrow(motif);
  });

  test("montant : phrase en chiffres et en lettres avec contre-valeur", () => {
    const { valeurs } = traiterReponses([{ cle: "m", libelle: "Montant", type: "montant" }], { m: { valeur: 1000, devise: "EUR" } }, {});
    expect(valeurs.m_phrase).toBe("EUR 1 000 (Mille Euros), soit F.CFA 655 957 (Six Cent Cinquante-Cinq Mille Neuf Cent Cinquante-Sept Francs CFA)");
    const xof = traiterReponses([{ cle: "m", libelle: "Montant", type: "montant" }], { m: { valeur: 2000000, devise: "XOF" } }, {});
    expect(xof.valeurs.m_phrase).toBe("F.CFA 2 000 000 (Deux Millions Francs CFA)");
  });

  test("pièces d'une liste : numérotation continue sur l'acte", () => {
    const champs = [{ cle: "faits", libelle: "Faits", type: "liste", sous_champs: [{ cle: "texte", libelle: "t", type: "texte" }, { cle: "pieces", libelle: "p", type: "pieces" }] }];
    const { valeurs, pieces } = traiterReponses(champs, { faits: [{ texte: "A", pieces: "Contrat\nAvenant" }, { texte: "B", pieces: "Courrier" }] }, {});
    expect(pieces).toEqual(["Contrat", "Avenant", "Courrier"]);
    expect(valeurs.faits[0].pieces_texte).toBe("Pièce N°1 : Contrat\nPièce N°2 : Avenant");
    expect(valeurs.faits[1].pieces_refs).toBe("n° 3");
  });
});

describe("Validation des modèles", () => {
  test("un modèle « à valider » n'est ni proposé ni utilisable ; il l'est après validation", async () => {
    const dossierId = await nouveauDossier();
    const code = `essai_${Date.now()}`;
    const cree = await request(app).post("/api/actes/modeles").set(auth()).send({ code, nom: "Essai", corps: "Corps {{client}}" });
    expect(cree.status).toBe(201);
    expect(cree.body.statut_validation).toBe("a_valider");
    const liste = await request(app).get("/api/actes/modeles").set(auth());
    expect(liste.body.map((m) => m.code)).not.toContain(code);
    const refus = await generer(dossierId, code, {});
    expect(refus.status).toBe(400);
    expect(refus.body.error).toMatch(/validé/);
    const val = await request(app).post(`/api/actes/modeles/${cree.body.id}/valider`).set(auth());
    expect(val.status).toBe(200);
    expect((await request(app).get("/api/actes/modeles").set(auth())).body.map((m) => m.code)).toContain(code);
    expect((await generer(dossierId, code, {})).status).toBe(201);
    // modifier le texte repasse « à valider »
    const maj = await request(app).put(`/api/actes/modeles/${cree.body.id}`).set(auth()).send({ corps: "Autre {{client}}" });
    expect(maj.body.statut_validation).toBe("a_valider");
  });

  test("un corps ou un questionnaire invalide est refusé (400)", async () => {
    const code = `invalide_${Date.now()}`;
    const r1 = await request(app).post("/api/actes/modeles").set(auth()).send({ code, nom: "X", corps: "{{#si x}} jamais fermé" });
    expect(r1.status).toBe(400);
    const r2 = await request(app).post("/api/actes/modeles").set(auth()).send({ code, nom: "X", corps: "ok", champs: [{ cle: "client", libelle: "x", type: "texte" }] });
    expect(r2.status).toBe(400);
  });
});

describe("Lettre de constitution", () => {
  test("réserve un n° DEP- au registre du courrier, avec l'acte en pièce jointe", async () => {
    await valider("lettre_constitution_juridiction");
    const dossierId = await nouveauDossier();
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination) VALUES ($1,'adverse','Marie TESTEUSE')", [dossierId]);
    const res = await generer(dossierId, "lettre_constitution_juridiction", {
      destinataire_titre: "m_president", juridiction_destinataire: "tgi_c4", nature: "Divorce", client_defendeur: "oui",
      renvoi: "oui", adresse_etranger: "1 Rue Fictive, Ville-Test, France",
    });
    expect(res.status).toBe(201);
    expect(res.body.courrier_reference).toMatch(/^DEP-\d{4}-\d{6}$/);
    expect(res.body.texte).toContain(`N/Réf : ${res.body.courrier_reference}`);
    expect(res.body.texte).toContain("À Monsieur le Président\ndu Tribunal de Grande Instance de la Commune IV du District de Bamako");
    expect(res.body.texte).toContain("Affaire : Marie TESTEUSE\nC/\n");     // client défendeur : adverse en premier
    expect(res.body.texte).toContain("Nature : Divorce\nObjet : Constitution");
    expect(res.body.texte).toContain("1 Rue Fictive, Ville-Test, France");
    expect(res.body.texte).not.toContain("jugement attaqué");                 // pas en appel
    expect(res.body.texte).not.toContain("{{");
    const { rows } = await pool.query("SELECT sens, dossier_id, document_id, correspondant FROM courriers WHERE reference = $1", [res.body.courrier_reference]);
    expect(rows[0].sens).toBe("depart");
    expect(rows[0].dossier_id).toBe(dossierId);
    expect(rows[0].document_id).toBe(res.body.id);
    // deuxième lettre : numéro suivant ; numeroter:false : aucun numéro
    const suite = await generer(dossierId, "lettre_constitution_juridiction", { destinataire_titre: "m_president", juridiction_destinataire: "tc_bamako", nature: "Recouvrement" });
    const n1 = Number(res.body.courrier_reference.slice(-6));
    expect(Number(suite.body.courrier_reference.slice(-6))).toBe(n1 + 1);
    const sans = await generer(dossierId, "lettre_constitution_juridiction", { destinataire_titre: "m_president", juridiction_destinataire: "tc_bamako", nature: "Recouvrement" }, { numeroter: false });
    expect(sans.body.courrier_reference).toBeNull();
    expect(sans.body.texte).toContain("N/Réf : [à compléter]");
  });

  test("champ requis manquant, choix invalide : 400, et aucun numéro consommé", async () => {
    const dossierId = await nouveauDossier();
    const avant = await pool.query("SELECT count(*)::int AS n FROM courriers WHERE sens = 'depart'");
    const manque = await generer(dossierId, "lettre_constitution_juridiction", { destinataire_titre: "m_president", juridiction_destinataire: "tc_bamako" });
    expect(manque.status).toBe(400);
    expect(manque.body.error).toMatch(/Nature de l'affaire/);
    const mauvais = await generer(dossierId, "lettre_constitution_juridiction", { destinataire_titre: "x", juridiction_destinataire: "tc_bamako", nature: "N" });
    expect(mauvais.status).toBe(400);
    const apres = await pool.query("SELECT count(*)::int AS n FROM courriers WHERE sens = 'depart'");
    expect(apres.rows[0].n).toBe(avant.rows[0].n);
  });
});

describe("Requête conjointe de divorce par consentement mutuel", () => {
  async function dossierDivorce() {
    const dossierId = await nouveauDossier({ prenom: "Paul", date_naissance: "1985-12-14", lieu_naissance: "Ville-Test", pere: "Étienne TESTEUR", mere: "Berthe MARTEAU", adresse: "Rue Fictive 1", ville: "Ville-Test" });
    await pool.query(
      "INSERT INTO dossier_parties (dossier_id, role, denomination, civilite, type_partie, date_naissance, lieu_naissance, adresse) VALUES ($1,'co_demandeur','Claire TESTEUR','Mme','physique','1990-05-30','Lieu-Test','Rue Fictive 2')",
      [dossierId]
    );
    return dossierId;
  }
  const base = { destinataire_titre: "m_president", commune: "V", mariage_date: "2022-09-06", mariage_centre: "Centre secondaire de Ville-Test", mariage_commune: "Commune V du District de Bamako", option: "monogamie", regime: "separation" };

  test("sans enfant : identité des deux époux, mariage, dispositif et « Par ces motifs »", async () => {
    await valider("requete_divorce_consentement_mutuel");
    const dossierId = await dossierDivorce();
    const res = await generer(dossierId, "requete_divorce_consentement_mutuel", base);
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("du Tribunal de Grande Instance de la Commune V du District de Bamako.");
    expect(t).toContain("Monsieur Paul TESTEUR");
    expect(t).toContain("né le 14 décembre 1985 à Ville-Test, fils d'Étienne TESTEUR et de Berthe MARTEAU");
    expect(t).toContain("ET\nMadame Claire TESTEUR, née le 30 mai 1990 à Lieu-Test, domiciliée à Rue Fictive 2");
    expect(t).toContain("contracté mariage le 6 septembre 2022");
    expect(t).toContain("sous le régime matrimonial de la séparation de biens et avec comme option matrimoniale la monogamie");
    expect(t).toContain("n'est issu aucun enfant");
    expect(t).toContain("pièce n° 2)");                  // la convention est la pièce 2 sans enfants
    expect(t).toContain("• De constater la recevabilité de la requête ;");
    expect(t).toContain("PAR CES MOTIFS");
    expect(t).not.toContain("{{");
  });

  test("avec enfants, convocation et sans « Par ces motifs »", async () => {
    const dossierId = await dossierDivorce();
    const res = await generer(dossierId, "requete_divorce_consentement_mutuel", {
      ...base, regime: "autre", regime_autre: "la communauté réduite aux acquêts", option: "polygamie", convocation: "oui", par_ces_motifs: "non",
      enfants: [{ prenom: "Aïcha", naissance: "2015-01-01", lieu: "Ville-Test" }, { prenom: "Moussa", naissance: "2018-02-02", lieu: "Ville-Test" }],
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("sont nés 2 enfants mineurs");
    expect(t).toContain("• Aïcha, né(e) le 1er janvier 2015 à Ville-Test ;");
    expect(t).toContain("• Moussa, né(e) le 2 février 2018 à Ville-Test ;");
    expect(t).toContain("pièce n° 3)");
    expect(t).toContain("régime matrimonial de la communauté réduite aux acquêts");
    expect(t).toContain("la polygamie");
    expect(t).toContain("• De les convoquer pour constater la recevabilité de la requête ;");
    expect(t).not.toContain("PAR CES MOTIFS");
  });
});

describe("Requête en injonction de payer", () => {
  test("créanciers, débiteurs, montant en chiffres et en lettres, exposé avec pièces, ordonnance et bordereau", async () => {
    await valider("requete_injonction_de_payer");
    const dossierId = await nouveauDossier({ type: "morale", denomination: `SOCIETE EXEMPLE ${Date.now()}`, forme_juridique: "SARL", prenom: undefined, nom: undefined, civilite: undefined });
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, type_partie, forme_juridique) VALUES ($1,'adverse','DEBITEUR FICTIF SA','morale','SA')", [dossierId]);
    const res = await generer(dossierId, "requete_injonction_de_payer", {
      destinataire_titre: "mme_presidente", juridiction: "tc_bamako", montant: { valeur: 1000, devise: "EUR" },
      faits: [
        { texte: "Suivant contrat de vente du 29 janvier 2018, la société a vendu des marchandises.", pieces: "Contrat de vente\nAvenant n° 1" },
        { texte: "Malgré relances, la facture est restée impayée.", pieces: "Facture" },
      ],
      mise_en_demeure: "oui", mise_en_demeure_date: "2021-02-10", projet_ordonnance: "oui",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("À Madame la Présidente du Tribunal de Commerce de Bamako.");
    expect(t).toContain("Ayant pour Conseil la SCPA JFC AVOCATS");        // un seul requérant
    expect(t).toContain("Suivant contrat de vente du 29 janvier 2018");
    expect(t).toContain("Pièce N°1 : Contrat de vente\nPièce N°2 : Avenant n° 1");
    expect(t).toContain("Pièce N°3 : Facture");
    expect(t).toContain("selon courrier du 10 février 2021");
    expect(t).toContain("DEBITEUR FICTIF SA, SA");
    expect(t).toContain("le paiement de la somme de EUR 1 000 (Mille Euros), soit F.CFA 655 957");
    expect(t).toContain("ORDONNANCE N°");
    expect(t).toContain("Nous, [à compléter], Président du Tribunal de Commerce de Bamako.");
    expect(t).toContain("BORDEREAU DES PIÈCES\n1. Contrat de vente\n2. Avenant n° 1\n3. Facture");
    expect(t).not.toContain("{{");
    const sans = await generer(dossierId, "requete_injonction_de_payer", { destinataire_titre: "m_president", juridiction: "autre", juridiction_autre: "du Tribunal de Grande Instance de la Commune III du District de Bamako", montant: { valeur: 500000, devise: "XOF" }, faits: [{ texte: "Fait unique." }], projet_ordonnance: "non" });
    expect(sans.status).toBe(201);
    expect(sans.body.texte).toContain("À Monsieur le Président du Tribunal de Grande Instance de la Commune III");
    expect(sans.body.texte).not.toContain("ORDONNANCE");
    expect(sans.body.texte).not.toContain("BORDEREAU");
    expect(sans.body.texte).not.toContain("Préalablement");
    expect(sans.body.texte).toContain("F.CFA 500 000 (Cinq Cent Mille Francs CFA)");
  });
});
