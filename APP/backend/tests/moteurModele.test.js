// JURIA — moteur des modèles d'actes (28/10/2026) : conditions, répétitions, imbrication, erreurs.
const { rendre, analyser } = require("../src/moteurModele");

describe("Substitution simple (comportement historique)", () => {
  test("remplace les balises connues, laisse visibles les inconnues", () => {
    expect(rendre("Bonjour {{nom}} {{inconnue}}", { nom: "Test" })).toBe("Bonjour Test {{inconnue}}");
  });
});

describe("Blocs conditionnels", () => {
  test("{{#si}} / {{#sinon}} selon la valeur", () => {
    const m = "{{#si enfants}}avec enfants{{#sinon}}sans enfant{{/si}}";
    expect(rendre(m, { enfants: [{ prenom: "A" }] })).toBe("avec enfants");
    expect(rendre(m, { enfants: [] })).toBe("sans enfant");
    expect(rendre(m, {})).toBe("sans enfant");
  });

  test("valeurs « non », vide et [à compléter] sont fausses", () => {
    const m = "{{#si x}}oui{{/si}}";
    for (const faux of ["non", "", "Non", "false", "[à compléter]"]) expect(rendre(m, { x: faux })).toBe("");
    expect(rendre(m, { x: "oui" })).toBe("oui");
  });

  test("comparaisons = et !=", () => {
    const m = "{{#si regime=separation}}A{{/si}}{{#si regime!=separation}}B{{/si}}";
    expect(rendre(m, { regime: "separation" })).toBe("A");
    expect(rendre(m, { regime: "communaute" })).toBe("B");
  });

  test("une balise de bloc seule sur sa ligne disparaît avec son saut de ligne", () => {
    const m = "Avant\n{{#si x}}\nLigne conditionnelle\n{{/si}}\nAprès";
    expect(rendre(m, { x: "oui" })).toBe("Avant\nLigne conditionnelle\nAprès");
    expect(rendre(m, { x: "non" })).toBe("Avant\nAprès");
  });
});

describe("Blocs répétés", () => {
  test("{{#chaque}} avec rang {{@n}}", () => {
    const m = "{{#chaque enfants}}\n{{@n}}. {{prenom}} né le {{naissance}}\n{{/chaque}}";
    const out = rendre(m, { enfants: [{ prenom: "Aïcha", naissance: "01/01/2015" }, { prenom: "Moussa", naissance: "02/02/2018" }] });
    expect(out).toBe("1. Aïcha né le 01/01/2015\n2. Moussa né le 02/02/2018\n");
  });

  test("liste absente ou vide : rien", () => {
    expect(rendre("{{#chaque l}}x{{/chaque}}", {})).toBe("");
    expect(rendre("{{#chaque l}}x{{/chaque}}", { l: [] })).toBe("");
  });

  test("imbrication : condition dans une répétition, portée globale accessible dans l'élément", () => {
    const m = "{{#chaque faits}}{{texte}}{{#si pieces}} [{{pieces}}]{{/si}} ({{auteur}});{{/chaque}}";
    expect(rendre(m, { auteur: "Me X", faits: [{ texte: "A", pieces: "P1" }, { texte: "B", pieces: "" }] })).toBe("A [P1] (Me X);B (Me X);");
  });
});

describe("Erreurs de syntaxe (400)", () => {
  test.each([
    ["{{#si x}}jamais fermé", /non fermé/],
    ["{{/si}}", /sans « \{\{#si\}\} »/],
    ["{{#chaque l}}{{/si}}", /sans « \{\{#si\}\} »/],
    ["{{#sinon}}", /en dehors/],
    ["{{#si x}}a{{#sinon}}b{{#sinon}}c{{/si}}", /double|en dehors/],
  ])("%s", (corps, motif) => {
    expect(() => analyser(corps)).toThrow(motif);
    try { analyser(corps); } catch (e) { expect(e.status).toBe(400); }
  });
});
