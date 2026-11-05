// JURIA — Générateur de courriers, lot 2 (05/11/2026) : gabarits (cases de saisie), composition, moteurs pilotés par les réglages du cabinet.
const bcrypt = require("bcryptjs");
const JSZip = require("jszip");
const G = require("../src/courrier/gabarits");
const { genererPdf } = require("../src/courrier/moteurPdf");
const { genererCourrier, ErreurContenu } = require("../src/courrier/composer");
const { MESURES, pt } = require("../src/courrier/mesures");
const { standard } = require("../src/courrier/contenuExemple");
const { pool } = require("./setup");

const VALEURS_MIN = { destinataire: "Monsieur le Directeur\nde la BDM SA", objet: "Constitution", paragraphes: "Premier paragraphe.\n\nDeuxième paragraphe." };

describe("Gabarits : cases de saisie et validation", () => {
  test("deux gabarits : standard et constitution, avec leur bloc de signature par défaut", () => {
    const l = G.listerGabarits();
    expect(l.map((g) => g.code).sort()).toEqual(["constitution", "standard"]);
    expect(l.find((g) => g.code === "standard").bloc_signature).toBe("psc");
    expect(l.find((g) => g.code === "constitution").bloc_signature).toBe("con");
  });

  test("champs obligatoires manquants : une erreur par champ", () => {
    const r = G.validerContenu("standard", {});
    const cles = r.erreurs.map((e) => e.cle).sort();
    expect(cles).toEqual(["destinataire", "objet", "paragraphes"]);
  });

  test("valeurs minimales : les formules par défaut sont appliquées, le texte est normalisé", () => {
    const r = G.validerContenu("standard", VALEURS_MIN);
    expect(r.erreurs).toEqual([]);
    expect(r.contenu.destinataire).toEqual(["Monsieur le Directeur", "de la BDM SA"]);
    expect(r.contenu.paragraphes).toEqual(["Premier paragraphe.", "Deuxième paragraphe."]);
    expect(r.contenu.appel).toBe("Madame, Monsieur,");
    expect(r.contenu.politesse).toMatch(/salutations distinguées/);
  });

  test("la constitution fournit ses textes types et exige l'affaire", () => {
    const r = G.validerContenu("constitution", {});
    expect(r.erreurs.map((e) => e.cle)).toEqual(["affaire"]);
    const ok = G.validerContenu("constitution", { affaire: "Hawa F. COULIBALY c/ X" });
    expect(ok.erreurs).toEqual([]);
    expect(ok.contenu.objet).toBe("Lettre de constitution");
    expect(ok.contenu.paragraphes.length).toBe(2);
    expect(ok.contenu.destinataire[0]).toBe("Monsieur le Président");
  });

  test("bornes : trop de lignes, ligne trop longue, paragraphe trop long, objet trop long", () => {
    const base = { ...VALEURS_MIN };
    expect(G.validerContenu("standard", { ...base, destinataire: ["a", "b", "c", "d", "e", "f", "g"] }).erreurs[0].cle).toBe("destinataire");
    expect(G.validerContenu("standard", { ...base, destinataire: ["x".repeat(130)] }).erreurs[0].cle).toBe("destinataire");
    expect(G.validerContenu("standard", { ...base, paragraphes: ["y".repeat(5001)] }).erreurs[0].cle).toBe("paragraphes");
    expect(G.validerContenu("standard", { ...base, objet: "z".repeat(301) }).erreurs[0].cle).toBe("objet");
    expect(G.validerContenu("inconnu", {}).erreurs[0].cle).toBe("gabarit");
  });

  test("un marqueur de gras orphelin est retiré (il passerait toute la lettre en gras)", () => {
    const r = G.validerContenu("standard", { ...VALEURS_MIN, paragraphes: ["Un **gras** et un ** orphelin", "Ceci est **correct** ici."] });
    expect(r.contenu.paragraphes[0]).not.toContain("**");
    expect(r.contenu.paragraphes[1]).toBe("Ceci est **correct** ici.");
  });

  test("caractères de contrôle supprimés", () => {
    const r = G.validerContenu("standard", { ...VALEURS_MIN, objet: "Ob\u0000jet\u0007 test" });
    expect(r.contenu.objet).toBe("Objet test");
  });

  test("date du jour en lettres, « 1er » le premier du mois", () => {
    expect(G.dateDuJour(new Date("2026-11-05T12:00:00Z"))).toBe("Bamako, le 5 novembre 2026");
    expect(G.dateDuJour(new Date("2026-11-01T12:00:00Z"))).toBe("Bamako, le 1er novembre 2026");
    expect(G.dateDuJour(new Date("2026-08-31T23:30:00Z"))).toBe("Bamako, le 31 août 2026");
  });

  test("nom et mention du signataire : saisis dans les réglages, sinon « Prénom NOM » et « Avocat associé »", () => {
    expect(G.signataireAffiche({ prenom: "Mamadou", nom: "Konaté", nom_signature: "Mamadou I. KONATE", qualite_signature: "Avocat aux Barreaux du Mali & de Paris", role: "associe_fondateur" }))
      .toEqual({ nom: "Mamadou I. KONATE", qualite: "Avocat aux Barreaux du Mali & de Paris" });
    expect(G.signataireAffiche({ prenom: "Mahamane", nom: "Djiteye", role: "associe" })).toEqual({ nom: "Mahamane DJITEYE", qualite: "Avocat associé" });
    expect(G.signataireAffiche({ prenom: "Awa", nom: "N'Daw", role: "admin_general" }).qualite).toBe("");
  });

  test("lettre composée : date du jour par défaut, bloc par défaut du gabarit ou bloc choisi", () => {
    const { contenu } = G.validerContenu("constitution", { affaire: "X c/ Y" });
    const sig = { nom: "Mohamed DAOU", qualite: "Avocat" };
    const l = G.composerLettre("constitution", contenu, { nref: "DEP-2026-000001", signataire: sig, dateJour: "Bamako, le 5 novembre 2026" });
    expect(l.signature.bloc).toBe("con");
    expect(l.date).toBe("Bamako, le 5 novembre 2026");
    expect(l.nref).toBe("DEP-2026-000001");
    expect(G.composerLettre("constitution", contenu, { nref: "x", signataire: sig, blocSignature: "psc" }).signature.bloc).toBe("psc");
  });
});

describe("Moteur piloté par des mesures extérieures", () => {
  test("retrait de la page 1 et colonne de droite pris dans les mesures fournies", async () => {
    const mesures = { ...MESURES, page1: { ...MESURES.page1, texteX: 6.5 }, droiteX: 11 };
    const trace = [];
    await genererPdf(standard, { sortie: "A", mesures, trace });
    const texte1 = trace.filter((t) => t.page === 1 && t.col === "texte");
    expect(Math.min(...texte1.map((t) => t.x))).toBeCloseTo(pt(6.5), 1);
    expect(trace.find((t) => t.t === "Bamako,").x).toBeCloseTo(pt(11), 1);
  });
});

describe("Service de composition (base de données)", () => {
  let signataireId;
  const remettre = () => pool.query(
    "UPDATE parametres_cabinet SET courrier_logo_defaut = 'mali', courrier_decor = TRUE, courrier_texte_x_page1_cm = 6.20, courrier_colonne_droite_cm = 10.30 WHERE id = 1");

  beforeAll(async () => {
    const suffixe = Math.random().toString(36).slice(2, 8);
    const { rows } = await pool.query(
      "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le, nom_signature, qualite_signature) " +
      "VALUES ($1,'Mamadou','Konaté',$2,$3,'associe_fondateur',TRUE,now(),'Mamadou I. KONATE','Avocat aux Barreaux du Mali & de Paris') RETURNING id",
      ["L2" + suffixe, "test.lot2." + suffixe + "@jfcavocats-mali.com", await bcrypt.hash("x-Lot2-123!", 4)]);
    signataireId = rows[0].id;
    await remettre();
  });
  afterAll(async () => { await remettre(); await pool.end(); });

  test("génère PDF et Word ; le nom de signature et la mention viennent de la base", async () => {
    const trace = [];
    const r = await genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId, nref: "DEP-2026-000777", trace });
    expect(r.pdf.slice(0, 4).toString()).toBe("%PDF");
    expect(r.pages).toBeGreaterThanOrEqual(1);
    expect(trace.some((t) => t.t === "KONATE")).toBe(true);
    expect(trace.some((t) => t.t === "DEP-2026-000777")).toBe(true);
    const doc = await (await JSZip.loadAsync(r.docx)).file("word/document.xml").async("string");
    expect(doc).toContain("Mamadou I. KONATE");
    expect(doc).toContain("DEP-2026-000777");
  });

  test("la mention la plus longue tient dans la marge de droite", async () => {
    const trace = [];
    await genererCourrier({ gabarit: "constitution", valeurs: { affaire: "A c/ B" }, signataireId, trace });
    const fin = trace.filter((t) => t.t === "Paris");
    expect(fin.length).toBe(1);
    expect(fin[0].x + fin[0].w).toBeLessThanOrEqual(pt(MESURES.page.largeur - MESURES.margeDroite) + 0.6);
  });

  test("les réglages du cabinet pilotent la mise en page", async () => {
    await pool.query("UPDATE parametres_cabinet SET courrier_texte_x_page1_cm = 6.40, courrier_colonne_droite_cm = 10.60 WHERE id = 1");
    const trace = [];
    await genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId, trace });
    const texte1 = trace.filter((t) => t.page === 1 && t.col === "texte");
    expect(Math.min(...texte1.map((t) => t.x))).toBeCloseTo(pt(6.4), 1);
    expect(trace.find((t) => t.t === "Bamako,").x).toBeCloseTo(pt(10.6), 1);
    await remettre();
  });

  test("sortie B : le logo par défaut est celui des réglages ; sortie A : aucun calque", async () => {
    const a = await genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId, sortie: "A" });
    const b = await genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId, sortie: "B" });
    expect(b.pdf.length).toBeGreaterThan(a.pdf.length + 20000);
    const std = await genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId, sortie: "B", logo: "std", decor: false });
    expect(std.pdf.length).toBeLessThan(b.pdf.length);
  });

  test("sans numéro fourni : référence provisoire lisible ; contenu invalide ou signataire inconnu : erreur détaillée", async () => {
    const r = await genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId });
    expect(r.lettre.nref).toMatch(/^DEP-\d{4}-/);
    await expect(genererCourrier({ gabarit: "standard", valeurs: {}, signataireId })).rejects.toBeInstanceOf(ErreurContenu);
    await expect(genererCourrier({ gabarit: "inconnu", valeurs: {}, signataireId })).rejects.toBeInstanceOf(ErreurContenu);
    await expect(genererCourrier({ gabarit: "standard", valeurs: VALEURS_MIN, signataireId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(/Signataire/);
  });
});
