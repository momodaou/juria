// JURIA — Générateur de courriers, lot 0 (04/11/2026) : mise en page des deux sorties (A papier à en-tête, B en-tête
// numérique), en PDF et en Word. Aucune base de données : moteurs purs.
const JSZip = require("jszip");
const { genererPdf } = require("../src/courrier/moteurPdf");
const { genererDocx } = require("../src/courrier/moteurDocx");
const { genererCalibragePdf } = require("../src/courrier/calibragePdf");
const { standard, courte, constitution } = require("../src/courrier/contenuExemple");
const { MESURES, pt, bordDroit } = require("../src/courrier/mesures");

const xml = async (buf, fichier) => (await JSZip.loadAsync(buf)).file(fichier).async("string");

describe("PDF : géométrie de la mise en page", () => {
  test("lettre longue : 2 pages ; page 1 à 6,2 cm, pages suivantes à 3,175 cm, rien au-delà de 17,8 cm", async () => {
    const trace = [];
    const { pages } = await genererPdf(standard, { sortie: "A", trace });
    expect(pages).toBe(2);
    const texte1 = trace.filter((t) => t.page === 1 && t.col === "texte");
    const texte2 = trace.filter((t) => t.page === 2 && t.col === "texte");
    expect(texte1.length).toBeGreaterThan(20);
    expect(Math.min(...texte1.map((t) => t.x))).toBeCloseTo(pt(MESURES.page1.texteX), 1);
    expect(Math.min(...texte2.map((t) => t.x))).toBeCloseTo(pt(MESURES.suivantes.texteX), 1);
    trace.forEach((t) => expect(t.x + t.w).toBeLessThanOrEqual(pt(bordDroit()) + 0.6));
  });

  test("colonne de droite à 10,3 cm (date, destinataire)", async () => {
    const trace = [];
    await genererPdf(standard, { sortie: "A", trace });
    const date = trace.find((t) => t.t === "Bamako,");
    expect(date.x).toBeCloseTo(pt(MESURES.droiteX), 1);
    const dest = trace.find((t) => t.t === "Monsieur" && t.col === "droite");
    expect(dest.x).toBeCloseTo(pt(MESURES.droiteX), 1);
  });

  test("lettre courte : une seule page ; le texte de la page 1 reste à 3 mm au moins du filet (5,86 cm)", async () => {
    const trace = [];
    const { pages } = await genererPdf(courte, { sortie: "A", trace });
    expect(pages).toBe(1);
    const gauche = Math.min(...trace.filter((t) => t.col === "texte").map((t) => t.x));
    expect(gauche - pt(MESURES.papier.filetX)).toBeGreaterThan(pt(0.3));
  });

  test("les sorties A et B ont exactement la même mise en page", async () => {
    const a = [], b = [];
    await genererPdf(standard, { sortie: "A", trace: a });
    await genererPdf(standard, { sortie: "B", trace: b });
    expect(b).toEqual(a);
  });

  test("la mention la plus longue (« Avocat aux Barreaux du Mali & de Paris ») ne dépasse pas la marge de droite", async () => {
    const trace = [];
    await genererPdf(constitution, { sortie: "B", trace });
    const fin = trace.filter((t) => t.t === "Paris");
    expect(fin.length).toBe(1);
    expect(fin[0].x + fin[0].w).toBeLessThanOrEqual(pt(bordDroit()) + 0.6);
  });

  test("la référence JURIA figure dans la lettre (N/R)", async () => {
    const trace = [];
    await genererPdf(standard, { sortie: "A", trace });
    expect(trace.some((t) => t.t === standard.nref)).toBe(true);
  });

  test("un passage en gras collé à une virgule ne laisse pas d'espace avant la virgule", async () => {
    const trace = [];
    await genererPdf(standard, { sortie: "A", trace });
    expect(trace.some((t) => t.t === "000230,")).toBe(true);
  });
});

describe("Word : zone d'exclusion et calques", () => {
  test("sortie A : un seul objet flottant (zone d'exclusion à habillage carré), première page distincte", async () => {
    const buf = await genererDocx(standard, { sortie: "A", pages: 2 });
    const doc = await xml(buf, "word/document.xml");
    expect((doc.match(/<wp:anchor/g) || []).length).toBe(1);
    expect(doc).toContain("wp:wrapSquare");
    expect(doc).toContain("<w:titlePg");
    expect(doc).toContain(standard.nref);
  });

  test("sortie B : exclusion + calque d'en-tête + décor (3 objets), ou 2 sans décor", async () => {
    const avec = await xml(await genererDocx(standard, { sortie: "B", pages: 2 }), "word/document.xml");
    expect((avec.match(/<wp:anchor/g) || []).length).toBe(3);
    const sans = await xml(await genererDocx(standard, { sortie: "B", decor: false, pages: 2 }), "word/document.xml");
    expect((sans.match(/<wp:anchor/g) || []).length).toBe(2);
  });

  test("numérotation n/N seulement si plusieurs pages", async () => {
    const zip2 = await JSZip.loadAsync(await genererDocx(standard, { sortie: "A", pages: 2 }));
    const zip1 = await JSZip.loadAsync(await genererDocx(courte, { sortie: "A", pages: 1 }));
    const pieds = async (zip) => (await Promise.all(Object.keys(zip.files).filter((f) => /word\/footer\d*\.xml/.test(f)).map((f) => zip.file(f).async("string")))).join("");
    expect(await pieds(zip2)).toContain("NUMPAGES");
    expect(await pieds(zip1)).not.toContain("NUMPAGES");
  });
});

describe("Page de calibrage", () => {
  test("PDF d'une page", async () => {
    const buf = await genererCalibragePdf();
    expect(buf.slice(0, 4).toString()).toBe("%PDF");
    expect((buf.toString("latin1").match(/\/Type \/Page\b/g) || []).length).toBe(1);
  });
});
