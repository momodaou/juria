// JURIA — Générateur de courriers : rendu Word (.docx) (lot 0, 04/11/2026).
//
// Même modèle de mise en page que le PDF (moteurPdf.js), mais Word fait lui-même les sauts de ligne et de page.
// Le retrait de la page 1 (texte à 6,2 cm, à droite du filet du papier à en-tête) est obtenu sans aucun
// retrait manuel : une zone d'exclusion transparente, flottante et ancrée dans le premier paragraphe,
// à habillage carré, que le texte contourne sur la page 1 seulement. Dès la page 2, la marge normale
// (3,175 cm) s'applique. À VALIDER par un essai réel dans Word (lot 0).
// Sortie B : les calques d'en-tête (assets/courrier) sont posés derrière le texte, sur la page 1.
// Le Word n'embarque ni cachet ni signature (apposés sur le PDF, lot 5).
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, PageNumber, AlignmentType,
  HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType, TextWrappingSide,
} = require("docx");
const { MESURES } = require("./mesures");
const { segmenter } = require("./moteurPdf");

const ASSETS = path.join(__dirname, "../../assets/courrier");
const TWIP = 566.929;                       // 1 cm en twips
const EMU = 360000;                         // 1 cm en EMU
const PX = 37.7953;                         // 1 cm en pixels (96 ppp)
const twips = (cm) => Math.round(cm * TWIP);
const LIGNE = 276;                          // interligne 1,15 (240 × 1,15)
// PNG transparent 1×1 : sert de zone d'exclusion (habillage carré)
const PNG_VIDE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==", "base64");

const run = (s) => new TextRun({
  text: s.t, bold: !!s.b, italics: !!s.i, underline: s.ul ? { type: "single" } : undefined, font: "Arial", size: 24,
});
const nbsp = (mot) => mot.replace(/ /g, " ");
const libelle = (mot) => ({ t: nbsp(mot), b: true, ul: true });

async function genererDocx(lettre, opts = {}) {
  const M = opts.mesures || MESURES;
  const sortie = opts.sortie === "B" ? "B" : "A";
  const logo = opts.logo === "std" ? "std" : "mali";
  const decor = opts.decor !== false;
  const nbPages = opts.pages || 1;                         // pages comptées par le moteur PDF (numérotation si > 1)
  const calque = (nom) => fs.readFileSync(path.join(ASSETS, nom));

  const retraitDroite = twips(M.droiteX - M.suivantes.texteX);      // colonne de droite, mesurée depuis la marge
  const blocs = [];
  const p = (spec, o = {}) => new Paragraph({
    alignment: o.align || AlignmentType.LEFT,
    indent: o.indent ? { left: o.indent } : undefined,
    spacing: { line: LIGNE, before: o.avant || 0, after: o.apres === undefined ? 0 : o.apres },
    keepNext: !!o.keepNext,
    children: [...(o.avantRuns || []), ...spec.map(run)],
  });
  const apres = (n) => n * LIGNE;

  // 1. date : porte les objets flottants de la page 1 (zone d'exclusion et, en sortie B, calques d'en-tête)
  const flottants = [];
  flottants.push(new ImageRun({
    type: "png", data: PNG_VIDE,
    transformation: { width: Math.round(M.page1.texteX * PX), height: Math.round(M.page1.bas * PX) },
    floating: {
      horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
      verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
      wrap: { type: TextWrappingType.SQUARE, side: TextWrappingSide.BOTH_SIDES, margins: { top: 0, bottom: 0, left: 0, right: 0 } },
      allowOverlap: true,
    },
  }));
  if (sortie === "B") {
    const couches = [...(decor ? ["entete-b-decor.png"] : []), `entete-b-base-${logo}.png`];
    couches.forEach((nom) => flottants.push(new ImageRun({
      type: "png", data: calque(nom),
      transformation: { width: Math.round(M.page.largeur * PX), height: Math.round(M.page.hauteur * PX) },
      floating: {
        horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
        verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
        wrap: { type: TextWrappingType.NONE },
        behindDocument: true, allowOverlap: true,
      },
    })));
  }
  const avant1 = twips(M.page1.haut - M.suivantes.haut);             // la date commence à 3,5 cm (le logo finit à 3,0 cm)
  blocs.push(p([{ t: lettre.date }], { indent: retraitDroite, avant: avant1, apres: apres(1), avantRuns: flottants }));

  blocs.push(p([libelle("À l’attention de"), { t: " :", b: true }], { indent: retraitDroite, apres: apres(1) }));
  lettre.destinataire.forEach((l, k, tab) => blocs.push(p([{ t: l, b: true }], {
    indent: retraitDroite, apres: (k === tab.length - 1 && !lettre.ville) ? apres(1) : 0,
  })));
  if (lettre.ville) blocs.push(p([{ t: lettre.ville, b: true, ul: true }], { indent: retraitDroite, apres: apres(1) }));
  blocs.push(p([libelle("N/R"), { t: " :", b: true }, { t: ` ${lettre.nref}`, b: true }], { apres: apres(1) }));
  if (lettre.affaire) blocs.push(p([libelle("Affaire"), { t: " :", b: true }, { t: ` ${lettre.affaire}` }], { apres: apres(1) }));
  blocs.push(p([libelle("Objet"), { t: " :", b: true }, { t: ` ${lettre.objet}` }], { apres: lettre.precision ? 0 : apres(1) }));
  if (lettre.precision) blocs.push(p([{ t: lettre.precision, i: true }], { indent: twips(1.5), apres: apres(1) }));
  if (lettre.motif) blocs.push(p([libelle("Motif"), { t: " :", b: true }, { t: ` ${lettre.motif}` }], { apres: apres(1) }));
  blocs.push(p([{ t: lettre.appel, b: true }], { apres: apres(1) }));
  lettre.paragraphes.forEach((t) => blocs.push(p(segmenter(t), { align: AlignmentType.JUSTIFIED, apres: apres(1) })));
  blocs.push(p(segmenter(lettre.politesse), { align: AlignmentType.JUSTIFIED, apres: apres(2) }));

  // bloc de signature : place laissée au cachet et à la signature (3 cm) ; le Word reste modifiable
  const sig = lettre.signature;
  const psc = sig.bloc !== "con";
  const longue = (sig.qualite || "").length > 34;
  const ind = retraitDroite - (longue ? twips(0.15) : 0);
  const gap = twips(3.0);
  if (psc) {
    blocs.push(p([libelle("P/SCPA JFC AVOCATS-MALI")], { indent: ind, apres: gap, keepNext: true }));
    blocs.push(p([{ t: sig.nom, b: true }], { indent: ind, keepNext: true }));
    blocs.push(p([{ t: sig.qualite || "", i: true }], { indent: ind, apres: apres(1) }));
  } else {
    blocs.push(p([{ t: "Le Conseil" }], { indent: ind, keepNext: true }));
    blocs.push(p([{ t: "SCPA JFC AVOCATS - MALI", b: true }], { indent: ind, apres: gap, keepNext: true }));
    blocs.push(p([{ t: `Me ${sig.nom}` }], { indent: ind, keepNext: true }));
    blocs.push(p([{ t: sig.qualite || "", i: true }], { indent: ind, apres: apres(1) }));
  }
  if (lettre.pj) blocs.push(p([libelle("P.J."), { t: " :", b: true }, { t: ` ${lettre.pj}` }]));

  const pied = nbPages > 1
    ? new Footer({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ children: [PageNumber.CURRENT, "/", PageNumber.TOTAL_PAGES], font: "Arial", size: 18 })],
      })] })
    : new Footer({ children: [new Paragraph({ children: [] })] });
  const enteteSuite = sortie === "B"
    ? new Header({ children: [new Paragraph({ children: [new TextRun({ text: lettre.nref || "", font: "Arial", size: 16, color: "555555" })] })] })
    : new Header({ children: [new Paragraph({ children: [] })] });
  const enteteVide = new Header({ children: [new Paragraph({ children: [] })] });

  const doc = new Document({
    creator: "JURIA — JFC Avocats Mali",
    title: `Courrier ${lettre.nref || ""}`.trim(),
    styles: { default: { document: { run: { font: "Arial", size: 24 } } } },
    sections: [{
      properties: {
        titlePage: true,
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: twips(2.54), bottom: twips(2.54), left: twips(M.suivantes.texteX), right: twips(M.margeDroite), header: 720, footer: 720 },
        },
      },
      headers: { first: enteteVide, default: enteteSuite },
      footers: { first: pied, default: pied },
      children: blocs,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { genererDocx };
