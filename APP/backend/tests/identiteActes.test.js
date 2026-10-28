// JURIA — identité détaillée pour les actes (27/10/2026) : phrases d'identification,
// écriture/effacement des champs facultatifs, dates sans décalage, balises des actes.
const request = require("supertest");
const app = require("../server");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");
const { identification, depuisClient, depuisPartie, dateLongue } = require("../src/balisesActes");

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

describe("Phrases d'identification (unitaire)", () => {
  test("personne physique, accords au masculin et élisions", () => {
    const phrase = identification(depuisClient({
      type: "physique", civilite: "M", prenom: "Paul", nom: "TESTEUR", profession: "Exemplaire",
      date_naissance: "1985-12-14", lieu_naissance: "Ville-Test", pere: "Étienne TESTEUR", mere: "Berthe MARTEAU",
      adresse: "Rue Fictive 1", ville: "Ville-Test",
    }));
    expect(phrase).toBe("Monsieur Paul TESTEUR, Exemplaire, né le 14 décembre 1985 à Ville-Test, fils d'Étienne TESTEUR et de Berthe MARTEAU, domicilié à Rue Fictive 1, Ville-Test");
  });

  test("personne physique, accords au féminin ; « de » devant consonne", () => {
    const phrase = identification(depuisClient({
      type: "physique", civilite: "Mme", prenom: "Claire", nom: "TESTEUR", date_naissance: "1999-05-30",
      lieu_naissance: "Lieu-Test", pere: "Alain TESTEUR", mere: "Berthe MARTEAU", adresse: "Rue Fictive 2",
    }));
    expect(phrase).toBe("Madame Claire TESTEUR, née le 30 mai 1999 à Lieu-Test, fille d'Alain TESTEUR et de Berthe MARTEAU, domiciliée à Rue Fictive 2");
  });

  test("civilité absente : formes neutres visibles (né(e), fils/fille)", () => {
    const phrase = identification(depuisClient({ type: "physique", prenom: "A", nom: "B", date_naissance: "2000-01-01", pere: "X Y" }));
    expect(phrase).toContain("né(e) le 1er janvier 2000");
    expect(phrase).toContain("fils/fille de X Y");
  });

  test("personne morale : capital, RCCM daté, siège avec BP, représentant", () => {
    const phrase = identification(depuisClient({
      type: "morale", denomination: "SOCIETE EXEMPLE SA", forme_juridique: "Société Anonyme", capital_social: "10 000 000 FCFA",
      rccm: "XX.TEST.2001.B.0001", rccm_date: "2001-03-05", adresse: "Rue Fictive 3", boite_postale: "B 100", ville: "Ville-Test",
      representant_nom: "Mme Alice EXEMPLE", representant_qualite: "Directrice générale",
    }));
    expect(phrase).toBe("SOCIETE EXEMPLE SA, Société Anonyme, au capital de 10 000 000 FCFA, immatriculée au RCCM sous le numéro XX.TEST.2001.B.0001 du 5 mars 2001, ayant son siège social à Rue Fictive 3, BP B 100, Ville-Test, représentée par Mme Alice EXEMPLE, Directrice générale");
  });

  test("partie sans détail : nom seul ; avec détails de société : traitée comme morale", () => {
    expect(identification(depuisPartie({ denomination: "Alpha SA" }))).toBe("Alpha SA");
    expect(identification(depuisPartie({ denomination: "Beta SARL", forme_juridique: "SARL", capital_social: "1 000 000 FCFA" }))).toBe("Beta SARL, SARL, au capital de 1 000 000 FCFA");
  });

  test("dateLongue", () => {
    expect(dateLongue("2026-10-28")).toBe("28 octobre 2026");
    expect(dateLongue("")).toBe("");
  });
});

describe("Clients : écriture, effacement et validation des champs d'identité", () => {
  async function nouveauClient(extra = {}) {
    const res = await request(app).post("/api/clients").set(auth()).send({ type: "physique", prenom: "Test", nom: `Ident ${Date.now()}-${Math.random()}`, ...extra });
    expect(res.status).toBe(201);
    return res.body.id;
  }

  test("création avec identité, lecture : date en AAAA-MM-JJ", async () => {
    const id = await nouveauClient({ civilite: "M", date_naissance: "1985-12-14", lieu_naissance: "Ville-Test", pere: "Étienne", mere: "Berthe", profession: "Exemplaire" });
    const res = await request(app).get(`/api/clients/${id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.date_naissance).toBe("1985-12-14");
    expect(res.body.civilite).toBe("M");
    expect(res.body.profession).toBe("Exemplaire");
  });

  test("PUT : champ absent inchangé, '' efface, date invalide refusée", async () => {
    const id = await nouveauClient({ profession: "Exemplaire", lieu_naissance: "Ville-Test", date_naissance: "1985-12-14" });
    let res = await request(app).put(`/api/clients/${id}`).set(auth()).send({ lieu_naissance: "Autre-Ville" });
    expect(res.status).toBe(200);
    res = await request(app).get(`/api/clients/${id}`).set(auth());
    expect(res.body.lieu_naissance).toBe("Autre-Ville");
    expect(res.body.profession).toBe("Exemplaire");           // non envoyé : inchangé
    res = await request(app).put(`/api/clients/${id}`).set(auth()).send({ profession: "", date_naissance: "" });
    expect(res.status).toBe(200);
    res = await request(app).get(`/api/clients/${id}`).set(auth());
    expect(res.body.profession).toBeNull();
    expect(res.body.date_naissance).toBeNull();
    res = await request(app).put(`/api/clients/${id}`).set(auth()).send({ date_naissance: "14/12/1985" });
    expect(res.status).toBe(400);
  });

  test("PUT sans champ d'identité : l'ancien contrôle de concurrence reste actif", async () => {
    const id = await nouveauClient();
    const fiche = await request(app).get(`/api/clients/${id}`).set(auth());
    const ok = await request(app).put(`/api/clients/${id}`).set(auth()).send({ ville: "Bamako", maj_le_attendu: fiche.body.maj_le });
    expect(ok.status).toBe(200);
    const perime = await request(app).put(`/api/clients/${id}`).set(auth()).send({ ville: "Kayes", maj_le_attendu: fiche.body.maj_le });
    expect(perime.status).toBe(409);
  });
});

describe("Parties au dossier : identité détaillée", () => {
  test("POST puis PUT d'une partie adverse, visibles dans la fiche dossier", async () => {
    const cl = await request(app).post("/api/clients").set(auth()).send({ type: "morale", denomination: `Soc Parties ${Date.now()}` });
    const d = await request(app).post("/api/dossiers").set(auth()).send({
      numero: `IDT-${Date.now()}-${Math.floor(Math.random() * 100000)}`, intitule: "Dossier identité", pole: "contentieux",
      client_id: cl.body.id, responsable_id: associeId, mode_honoraires: "forfait",
    });
    const dossierId = d.body.id;
    const p = await request(app).post(`/api/dossiers/${dossierId}/parties`).set(auth()).send({
      role: "adverse", denomination: "Omega SARL", type_partie: "morale", forme_juridique: "SARL", capital_social: "1 000 000 FCFA", rccm_date: "2020-02-20",
    });
    expect(p.status).toBe(201);
    const maj = await request(app).put(`/api/dossiers/${dossierId}/parties/${p.body.id}`).set(auth()).send({ representant_nom: "M. Testeur", representant_qualite: "Gérant", adresse: "Rue Fictive 4" });
    expect(maj.status).toBe(200);
    const fiche = await request(app).get(`/api/dossiers/${dossierId}`).set(auth());
    const partie = fiche.body.parties.find((x) => x.id === p.body.id);
    expect(partie.representant_nom).toBe("M. Testeur");
    expect(partie.rccm_date).toBe("2020-02-20");
    expect(partie.capital_social).toBe("1 000 000 FCFA");
    const bad = await request(app).put(`/api/dossiers/${dossierId}/parties/${p.body.id}`).set(auth()).send({ rccm_date: "20 février 2020" });
    expect(bad.status).toBe(400);

    // Génération : l'identité de la partie adverse et du client sont fusionnées.
    await pool.query("INSERT INTO modeles_actes (code, nom, corps) VALUES ('test_ident','Test ident',$1) ON CONFLICT (code) DO UPDATE SET corps = EXCLUDED.corps", ["{{partie_adverse_identification}}|{{avocat_titre}}|{{avocat_initiales}}|{{client_filiation}}"]);
    const g = await request(app).post("/api/actes/generer").set(auth()).send({ dossier_id: dossierId, mode: "modele", modele_code: "test_ident" });
    expect(g.status).toBe(201);
    expect(g.body.texte).toContain("Omega SARL, SARL, au capital de 1 000 000 FCFA, ayant son siège social à Rue Fictive 4, représentée par M. Testeur, Gérant");
    expect(g.body.texte).toContain("Avocat au Barreau du Mali");
    expect(g.body.texte).toContain("[à compléter]");   // filiation du client absente
  });
});

describe("Profil : titre de l'avocat", () => {
  test("PUT /api/profil enregistre le titre, repris par la balise avocat_titre", async () => {
    const res = await request(app).put("/api/profil").set(auth()).send({ titre_avocat: "Avocat au Barreau du Mali et de Paris" });
    expect(res.status).toBe(200);
    const profil = await request(app).get("/api/profil").set(auth());
    expect(profil.body.titre_avocat).toBe("Avocat au Barreau du Mali et de Paris");
    const vide = await request(app).put("/api/profil").set(auth()).send({ titre_avocat: "" });
    expect(vide.status).toBe(200);
    expect(vide.body.titre_avocat).toBeNull();
    const sans = await request(app).put("/api/profil").set(auth()).send({});
    expect(sans.status).toBe(400);
  });
});
