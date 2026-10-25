// JURIA — PDF du Rôle d'audience : chevauchement de texte corrigé (09/10/2026).
//
// Bug réel signalé par l'utilisateur : « l'aperçu du prochain rôle laisse
// apparaître une superposition des mots dans le dossier Moumouni Konaté ».
// Reproduit (voir HISTORY.md) avec un intitulé de dossier long et SANS
// " c/ " (pas de partie adverse structurée, ex. dossier de succession à une
// seule partie) : la référence du dossier (2e ligne de la colonne Parties)
// se dessinait par-dessus la fin du nom encore affiché.
//
// Cause : dessinerLigneParties() change de police EN COURS DE DESSIN
// (gras 9.5 pour le nom, gras+italique 8 pour « (client) »), et ne la
// restaure JAMAIS après coup. Sans « c/ Partie » à la suite, la dernière
// police posée par ce dessin reste donc l'italique 8 (plus étroite) —
// dessinerCellule() mesurait alors la hauteur de la ligne suivante avec
// CETTE police résiduelle au lieu de celle réellement utilisée pour
// l'essentiel du texte (gras 9.5), sous-estimant le nombre de lignes
// occupées. Corrigé en réappliquant systématiquement styleLigne() juste
// avant de mesurer (cohérent avec hauteurCellule(), qui le faisait déjà).
const PDFDocument = require("pdfkit");
const { styleLigne, dessinerLigneParties, texteParties, calculerColonnes, minimaColonnes } = require("../src/rolePdf");
const { TAILLE_TEXTE, TAILLE_PETIT } = require("../src/rolePdf");

function nouveauDoc() {
  return new PDFDocument({ size: "A4", layout: "landscape", margin: 24 });
}

describe("rolePdf — chevauchement de texte, colonne Parties sans partie adverse", () => {
  test("texteParties() sans ' c/ ' : dessinerLigneParties() laisse la police en italique 8 (quirk à l'origine du bug)", () => {
    const doc = nouveauDoc();
    const colonnes = calculerColonnes(300, 0);
    const colonneParties = colonnes.find((c) => c.cle === "parties");
    const texte = texteParties({ dossier_intitule: "Succession de feu Moumouni Konaté — Partage amiable des biens" });

    styleLigne(doc, colonneParties, 0); // Helvetica-Bold 9.5 — police réellement utilisée pour le nom
    dessinerLigneParties(doc, texte, colonneParties.x, 0, colonneParties.w);

    // Documente le quirk réel de dessinerLigneParties() : sans "c/ Partie"
    // à la suite, la dernière police posée est celle du segment "(client)",
    // pas celle (plus large) qui a dessiné l'essentiel du texte.
    expect(doc._font.name).toBe("Helvetica-BoldOblique");
    expect(doc._fontSize).toBe(TAILLE_PETIT);
  });

  test("le correctif (réappliquer styleLigne avant de mesurer) restaure la bonne police de mesure", () => {
    const doc = nouveauDoc();
    const colonnes = calculerColonnes(300, 0);
    const colonneParties = colonnes.find((c) => c.cle === "parties");
    const texte = texteParties({ dossier_intitule: "Succession de feu Moumouni Konaté — Partage amiable des biens" });

    styleLigne(doc, colonneParties, 0);
    dessinerLigneParties(doc, texte, colonneParties.x, 0, colonneParties.w);
    // Même geste que dessinerCellule() après le correctif du 09/10/2026 :
    styleLigne(doc, colonneParties, 0);

    expect(doc._font.name).toBe("Helvetica-Bold");
    expect(doc._fontSize).toBe(TAILLE_TEXTE);
  });

  test("avec ' c/ Partie adverse' : dessinerLigneParties() retombe déjà sur la bonne police (cas jamais bugué)", () => {
    const doc = nouveauDoc();
    const colonnes = calculerColonnes(300, 0);
    const colonneParties = colonnes.find((c) => c.cle === "parties");
    const texte = texteParties({ dossier_intitule: "Moumouni Konaté c/ Banque de Développement du Mali SA" });

    styleLigne(doc, colonneParties, 0);
    dessinerLigneParties(doc, texte, colonneParties.x, 0, colonneParties.w);

    expect(doc._font.name).toBe("Helvetica-Bold");
    expect(doc._fontSize).toBe(TAILLE_TEXTE);
  });
});

describe("rolePdf — aucun mot coupé dans les colonnes courtes", () => {
  test("« Conciliation » tient dans la colonne Type audience, la largeur totale est conservée", () => {
    const doc = nouveauDoc();
    const largeurTable = 794;
    const minima = minimaColonnes(doc, [{ type: "conciliation", juridiction: "TGI CI", heure: "09:00" }], []);
    const colonnes = calculerColonnes(largeurTable, 24, minima);
    const type = colonnes.find((c) => c.cle === "type");
    doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE);
    expect(type.w).toBeGreaterThanOrEqual(doc.widthOfString("Conciliation") + 14);
    expect(colonnes.reduce((s, c) => s + c.w, 0)).toBeCloseTo(largeurTable, 5);
  });
});
