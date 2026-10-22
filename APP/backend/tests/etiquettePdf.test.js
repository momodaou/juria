// JURIA — Étiquette de chemise en PDF (22/10/2026) : taille exacte du cadre
// (100 x 60 mm), contenu et troncature des textes très longs.
const { genererEtiquettePdfBuffer, abregeJuridiction, libelleCouleur, LARGEUR, HAUTEUR } = require("../src/etiquettePdf");

// pdfkit écrit le texte en hexadécimal, par morceaux (crénage) : on le recompose.
function lignesTexte(buf) {
  const t = buf.toString("latin1");
  return (t.match(/\[[^\]]*\] TJ/g) || []).map((tj) =>
    (tj.match(/<([0-9a-f]*)>/gi) || []).map((h) => Buffer.from(h.slice(1, -1), "hex").toString("latin1")).join(""));
}

const D = { numero: "CS-CIV-2026-0003", intitule: "Partage de succession", client_nom: "Moussa Traoré", juridiction: "Tribunal de Grande Instance de la Commune IV", couleur_chemise: "dore" };

describe("etiquettePdf", () => {
  test("cadre de 100 x 60 mm exactement (en points PDF)", () => {
    expect(LARGEUR).toBeCloseTo(283.46, 1);
    expect(HAUTEUR).toBeCloseTo(170.08, 1);
  });

  test("renvoie un PDF A4 contenant le numéro, le client, la juridiction et la chemise", async () => {
    const buf = await genererEtiquettePdfBuffer(D, "https://exemple.test/dossiers/1");
    expect(buf.toString("latin1").startsWith("%PDF")).toBe(true);
    expect(buf.toString("latin1")).toMatch(/MediaBox \[0 0 595\.28 841\.89\]/);
    const l = lignesTexte(buf);
    expect(l).toContain("CS-CIV-2026-0003");
    expect(l).toContain("Client : ");
    expect(l).toContain("Moussa Traoré");
    expect(l).toContain("Juridiction : ");
    expect(l).toContain("TGI CIV");
    expect(l).toContain("Chemise : ");
    expect(l).toContain("Doré");
  });

  test("sans juridiction : pas de ligne Juridiction", async () => {
    const buf = await genererEtiquettePdfBuffer({ ...D, juridiction: null }, "https://exemple.test/d");
    expect(lignesTexte(buf)).not.toContain("Juridiction : ");
  });

  test("textes très longs : tronqués avec « … », une seule page", async () => {
    const long = "Société Malienne de Distribution et d'Import-Export des Produits Alimentaires ".repeat(4);
    const buf = await genererEtiquettePdfBuffer({ ...D, intitule: long, client_nom: long }, "https://exemple.test/d");
    expect((buf.toString("latin1").match(/\/Type \/Page\n/g) || []).length).toBe(1);
    const l = lignesTexte(buf).filter((t) => t.includes("Malienne") || t.includes("Distribution"));
    expect(l.length).toBeGreaterThan(0);
    l.forEach((t) => expect(t.length).toBeLessThan(long.length));
    expect(lignesTexte(buf).some((t) => t.endsWith("\u0085"))).toBe(true); // « … » en WinAnsi
  });

  test("abréviation de juridiction et nom de couleur", () => {
    expect(abregeJuridiction("Tribunal de Grande Instance de la Commune IV")).toBe("TGI CIV");
    expect(abregeJuridiction("Tribunal de Grande Instance de Kati")).toBe("TGI Kati");
    expect(abregeJuridiction(null)).toBe("");
    expect(libelleCouleur("dore")).toBe("Doré");
    expect(libelleCouleur(null)).toBe("—");
  });
});
