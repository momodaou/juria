// JURIA — conversion d'un montant en toutes lettres (facture PDF enrichie,
// 28/08/2026). Test pur, aucune base requise : la fonction ne dépend que
// des règles orthographiques françaises.
const { nombreEnLettres, montantEnLettres } = require("../src/nombreEnLettres");

describe("nombreEnLettres — cas irréguliers du français", () => {
  test.each([
    [0, "zéro"],
    [1, "un"],
    [17, "dix-sept"],
    [20, "vingt"],
    [21, "vingt et un"],
    [69, "soixante-neuf"],
    [70, "soixante-dix"],
    [71, "soixante et onze"],
    [72, "soixante-douze"],
    [79, "soixante-dix-neuf"],
    [80, "quatre-vingts"],
    [81, "quatre-vingt-un"],
    [89, "quatre-vingt-neuf"],
    [90, "quatre-vingt-dix"],
    [91, "quatre-vingt-onze"],
    [99, "quatre-vingt-dix-neuf"],
    [100, "cent"],
    [101, "cent un"],
    [200, "deux cents"],
    [234, "deux cent trente-quatre"],
    [1000, "mille"],
    [2000, "deux mille"],
    [1000000, "un million"],
    [2000000, "deux millions"],
  ])("%i -> %s", (n, attendu) => {
    expect(nombreEnLettres(n)).toBe(attendu);
  });

  // Exemple exact du modèle de référence fourni par l'utilisateur (note
  // d'honoraires TIRE SARL, 13.08.2026) : 27 397 306 F.CFA.
  test("exemple du modèle de référence (27 397 306)", () => {
    expect(nombreEnLettres(27397306)).toBe(
      "vingt-sept millions trois cent quatre-vingt-dix-sept mille trois cent six"
    );
  });
});

describe("montantEnLettres — phrase capitalisée + devise", () => {
  test("XOF", () => {
    expect(montantEnLettres(118000, "XOF")).toBe("Cent Dix-Huit Mille Francs CFA");
  });
  test("devise étrangère", () => {
    expect(montantEnLettres(40800, "USD")).toBe("Quarante Mille Huit Cents Dollars US");
  });
});
