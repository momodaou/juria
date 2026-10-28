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

describe("Champs calculés et choix dans une liste (28/10/2026)", () => {
  const { evaluerFormule } = require("../src/questionnaireActes");

  test("évaluateur de formule : priorités, parenthèses, champ absent = 0, rejet du code", () => {
    const v = { a: 3, b: 4 };
    expect(evaluerFormule("a*(b+2)", (n) => v[n])).toBe(18);
    expect(evaluerFormule("a+b*2-1", (n) => v[n])).toBe(10);
    expect(evaluerFormule("a*absent", (n) => v[n])).toBe(0);
    expect(() => evaluerFormule("a / (b - 4)", (n) => v[n])).toThrow(/division/);
    expect(() => evaluerFormule("process.exit()", () => 1)).toThrow();
    expect(() => evaluerFormule("a +", () => 1)).toThrow();
  });

  test("calcul sur une liste et des montants à devise fixe", () => {
    const champs = [
      { cle: "enfants", libelle: "Enfants", type: "liste", sous_champs: [{ cle: "prenom", libelle: "p", type: "texte" }, { cle: "garde_a", libelle: "g", type: "choix", options: [{ valeur: "mere", libelle: "leur mère" }] }] },
      { cle: "pension", libelle: "Pension", type: "montant", devise_fixe: "XOF" },
      { cle: "total", libelle: "Total", type: "calcul", formule: "enfants_nombre*pension" },
    ];
    const { valeurs } = traiterReponses(champs, { enfants: [{ prenom: "A", garde_a: "mere" }, { prenom: "B", garde_a: "" }], pension: { valeur: 150000, devise: "EUR" } }, {});
    expect(valeurs.enfants[0].garde_a_libelle).toBe("leur mère");
    expect(valeurs.enfants[1].garde_a_libelle).toBe("");
    expect(valeurs.pension_chiffres).toBe("F.CFA 150 000");                    // devise imposée malgré « EUR »
    expect(valeurs.total_phrase).toBe("F.CFA 300 000 (Trois Cent Mille Francs CFA)");
    expect(() => traiterReponses(champs, { enfants: [{ prenom: "A", garde_a: "inconnu" }] }, {})).toThrow(/choix invalide/);
  });

  test("définitions refusées : formule invalide, devise fixe inconnue, sous-champ choix sans options", () => {
    expect(() => validerDefinition([{ cle: "t", libelle: "T", type: "calcul", formule: "a ** b" }])).toThrow(/formule/);
    expect(() => validerDefinition([{ cle: "m", libelle: "M", type: "montant", devise_fixe: "USD" }])).toThrow(/devise_fixe/);
    expect(() => validerDefinition([{ cle: "l", libelle: "L", type: "liste", sous_champs: [{ cle: "x", libelle: "X", type: "choix" }] }])).toThrow(/options/);
  });
});

describe("Convention de divorce par consentement mutuel", () => {
  const base = {
    client_est: "epoux", mariage_date: "2022-09-06", mariage_centre: "Centre secondaire de Ville-Test", mariage_commune: "Commune V du District de Bamako",
    option: "monogamie", regime: "separation",
  };
  async function dossierConvention() {
    const dossierId = await nouveauDossier({ prenom: "Paul", lieu_naissance: "Ville-Test", date_naissance: "1985-12-14" });
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, civilite, type_partie) VALUES ($1,'co_demandeur','Claire TESTEUR','Mme','physique')", [dossierId]);
    return dossierId;
  }

  test("avec enfants : garde, pension, totaux calculés, conditions particulières", async () => {
    await valider("convention_divorce_consentement_mutuel");
    const dossierId = await dossierConvention();
    const res = await generer(dossierId, "convention_divorce_consentement_mutuel", {
      ...base,
      enfants: [{ prenom: "Aïcha", naissance: "2015-01-01", lieu: "Ville-Test", garde_a: "epouse", garde_jusqua: "ses 10 ans" }, { prenom: "Moussa", naissance: "2018-02-02", lieu: "Ville-Test", garde_a: "epouse", garde_jusqua: "" }],
      garde_retour: "epoux", debiteur_pension: "epoux", frais_scolarite: "oui", frais_sante: "Couverts par l'assurance médicale de l'époux.",
      frais_transport: { valeur: 80000 }, pension_principale: { valeur: 150000 }, pension_complementaire: { valeur: 100000 },
      conditions: [{ titre: "Frais exceptionnels de déménagement", texte: "L'époux prend en charge un forfait de 380 euros." }],
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("• Monsieur Paul TESTEUR");
    expect(t).toContain("Ci-après dénommé « l'époux », d'une part ;");
    expect(t).toContain("ET\n• Madame Claire TESTEUR");
    expect(t).toContain("sont issus 2 enfants mineurs");
    expect(t).toContain("• La garde de l'enfant Aïcha sera confiée à l'épouse jusqu'à ses 10 ans ;");
    expect(t).toContain("• La garde de l'enfant Moussa sera confiée à l'épouse ;");
    expect(t).toContain("la garde des enfants reviendra à l'époux, au domicile duquel ils résideront");
    expect(t).toContain("Au titre des charges des enfants, l'époux s'engage à prendre en charge l'intégralité de leurs frais de scolarité");
    expect(t).toContain("S'agissant des frais de santé : Couverts par l'assurance médicale de l'époux.");
    expect(t).toContain("fixés à F.CFA 80 000 par mois");
    expect(t).toContain("s'engage à verser à l'épouse :");
    expect(t).toContain("la somme de F.CFA 150 000 par mois et par enfant, soit une somme totale de F.CFA 300 000 par mois ;");
    expect(t).toContain("la somme de F.CFA 100 000 par mois et par enfant, soit une somme totale de F.CFA 200 000 par mois.");
    expect(t).toContain("la somme totale de F.CFA 500 000 (Cinq Cent Mille Francs CFA) par mois");
    expect(t).toContain("• Frais exceptionnels de déménagement\nL'époux prend en charge un forfait de 380 euros.");
    expect(t).toContain("Les époux étant mariés sous le régime de la séparation de biens");
    expect(t).toContain("L'époux : Paul");
    expect(t).toContain("L'épouse : Claire TESTEUR");
    expect(t).not.toContain("{{");
    expect(t).not.toContain("Sans objet");
  });

  test("sans enfant, client épouse, résidence attribuée, autre régime : articles « sans objet »", async () => {
    // La cliente est l'épouse ; l'époux est le co-demandeur : il doit venir en premier dans la convention.
    const cl = await request(app).post("/api/clients").set(auth()).send({ type: "physique", prenom: "Claire", nom: `TESTEUSE ${Date.now()}`, civilite: "Mme" });
    const d = await request(app).post("/api/dossiers").set(auth()).send({
      numero: `PIL-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier convention", pole: "contentieux",
      client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait",
    });
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, civilite, type_partie) VALUES ($1,'co_demandeur','Paul TESTEUR','M','physique')", [d.body.id]);
    const res = await generer(d.body.id, "convention_divorce_consentement_mutuel", {
      ...base, client_est: "epouse", regime: "communaute", liquidation_texte: "Les époux procèdent au partage des biens communs comme suit : [à rédiger].",
      residence: "attribuee", residence_adresse: "Rue Fictive 9, Ville-Test", residence_attribuee: "epouse",
    });
    expect(res.status).toBe(201);
    const t = res.body.texte;
    expect(t).toContain("ENTRE :\n• Monsieur Paul TESTEUR\nCi-après dénommé « l'époux », d'une part ;\nET\n• Madame Claire TESTEUSE");
    expect(t).toContain("Ci-après dénommée « l'épouse », d'autre part ;");
    expect(t).toContain("L'époux : Paul TESTEUR\nL'épouse : Claire TESTEUSE");
    expect(t).toContain("n'est issu aucun enfant");
    expect((t.match(/Sans objet : aucun enfant mineur/g) || []).length).toBe(3);    // articles 5, 6 et 7
    expect(t).toContain("La résidence conjugale située à Rue Fictive 9, Ville-Test est attribuée à l'épouse");
    expect(t).toContain("sous le régime matrimonial de la communauté de biens");
    expect(t).toContain("Les époux procèdent au partage des biens communs");
    expect(t).not.toContain("n'ayant acquis aucun bien en commun");
    expect(t).toContain("Les époux déclarent n'avoir convenu d'aucune condition particulière.");
    expect(t).not.toContain("{{");
  });

  test("pension principale requise quand il y a des enfants", async () => {
    const dossierId = await dossierConvention();
    const res = await generer(dossierId, "convention_divorce_consentement_mutuel", {
      ...base, enfants: [{ prenom: "Aïcha", naissance: "2015-01-01", lieu: "Ville-Test", garde_a: "epouse" }], debiteur_pension: "epoux",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Pension alimentaire principale/);
  });
});

describe("Mémoire des réponses par dossier (28/10/2026)", () => {
  const memoire = (dossierId) => request(app).get(`/api/actes/memoire/${dossierId}`).set(auth());
  const requeteDivorce = {
    destinataire_titre: "m_president", commune: "V", mariage_date: "2022-09-06", mariage_centre: "Centre secondaire de Ville-Test",
    mariage_commune: "Commune V du District de Bamako", option: "polygamie", regime: "autre", regime_autre: "la communauté réduite aux acquêts",
    enfants: [{ prenom: "Aïcha", naissance: "2015-01-01", lieu: "Ville-Test" }],
  };

  async function dossierDivorce() {
    const dossierId = await nouveauDossier();
    await pool.query("INSERT INTO dossier_parties (dossier_id, role, denomination, civilite, type_partie) VALUES ($1,'co_demandeur','Claire TESTEUR','Mme','physique')", [dossierId]);
    return dossierId;
  }

  test("seuls les champs marqués « memoriser » sont conservés après une génération réussie", async () => {
    await valider("requete_divorce_consentement_mutuel");
    const dossierId = await dossierDivorce();
    expect((await memoire(dossierId)).body).toEqual({});
    expect((await generer(dossierId, "requete_divorce_consentement_mutuel", requeteDivorce)).status).toBe(201);
    const m = (await memoire(dossierId)).body;
    expect(m.mariage_date).toBe("2022-09-06");
    expect(m.mariage_centre).toBe("Centre secondaire de Ville-Test");
    expect(m.option).toBe("polygamie");
    expect(m.regime).toBe("autre");
    expect(m.regime_autre).toBe("la communauté réduite aux acquêts");
    expect(m.enfants).toEqual([{ prenom: "Aïcha", naissance: "2015-01-01", lieu: "Ville-Test" }]);
    expect(m).not.toHaveProperty("commune");               // propre à cet acte : non marqué
    expect(m).not.toHaveProperty("destinataire_titre");
    expect(m).not.toHaveProperty("convocation");
  });

  test("un second acte met la mémoire à jour ; un champ laissé vide est oublié", async () => {
    await valider("convention_divorce_consentement_mutuel");
    const dossierId = await dossierDivorce();
    await generer(dossierId, "requete_divorce_consentement_mutuel", requeteDivorce);
    // La convention reprend le mariage mais corrige le régime et supprime les enfants.
    const conv = await generer(dossierId, "convention_divorce_consentement_mutuel", {
      client_est: "epoux", mariage_date: "2022-09-07", mariage_centre: "Centre secondaire de Ville-Test", mariage_commune: "Commune V du District de Bamako",
      option: "polygamie", regime: "separation", enfants: [],
    });
    expect(conv.status).toBe(201);
    const m = (await memoire(dossierId)).body;
    expect(m.mariage_date).toBe("2022-09-07");
    expect(m.regime).toBe("separation");
    expect(m).not.toHaveProperty("enfants");                // vidée : oubliée
    expect(m.regime_autre).toBe("la communauté réduite aux acquêts");   // champ non demandé cette fois : inchangé
  });

  test("une génération refusée ne mémorise rien ; la mémoire est propre à chaque dossier ; elle peut être oubliée", async () => {
    const dossierId = await dossierDivorce();
    const refus = await generer(dossierId, "requete_divorce_consentement_mutuel", { ...requeteDivorce, mariage_centre: undefined });
    expect(refus.status).toBe(400);
    expect((await memoire(dossierId)).body).toEqual({});
    await generer(dossierId, "requete_divorce_consentement_mutuel", requeteDivorce);
    const autre = await dossierDivorce();
    expect((await memoire(autre)).body).toEqual({});
    const oubli = await request(app).delete(`/api/actes/memoire/${dossierId}`).set(auth());
    expect(oubli.status).toBe(200);
    expect(oubli.body.oubliees).toBeGreaterThan(0);
    expect((await memoire(dossierId)).body).toEqual({});
  });

  test("définition : « memoriser » refusé sur un montant ou une valeur non booléenne", () => {
    expect(() => validerDefinition([{ cle: "m", libelle: "M", type: "montant", memoriser: true }])).toThrow(/memoriser/);
    expect(() => validerDefinition([{ cle: "t", libelle: "T", type: "texte", memoriser: "oui" }])).toThrow(/memoriser/);
    expect(() => validerDefinition([{ cle: "t", libelle: "T", type: "texte", memoriser: true }])).not.toThrow();
  });
});
