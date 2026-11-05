// JURIA — Générateur de courriers : page de calibrage du papier à en-tête (lot 0, 04/11/2026).
//
// À imprimer à 100 % (sans mise à l'échelle) SUR le papier à en-tête : les repères montrent où JURIA place le
// texte, la colonne de droite et les zones réservées ; on relève les écarts avec les éléments préimprimés
// (filet, coordonnées, logo, barre). Une règle graduée et un carré de 10 cm vérifient l'échelle d'impression.
const PDFDocument = require("pdfkit");
const { MESURES: MESURES_DEFAUT, pt } = require("./mesures");

async function genererCalibragePdf(mesures) {
  const MESURES = mesures || MESURES_DEFAUT;
  const doc = new PDFDocument({ size: "A4", margin: 0, info: { Title: "JURIA — Page de calibrage du papier à en-tête" } });
  const morceaux = [];
  doc.on("data", (c) => morceaux.push(c));
  const fini = new Promise((res) => doc.on("end", () => res(Buffer.concat(morceaux))));
  const L = pt(MESURES.page.largeur), H = pt(MESURES.page.hauteur);
  const P = MESURES.papier;

  // règle : graduations du millimètre, chiffres tous les 5 cm (haut et gauche)
  doc.lineWidth(0.25).strokeColor("#999999").fillColor("#666666").font("Helvetica").fontSize(6);
  for (let mm = 0; mm <= 210; mm += 1) {
    const x = pt(mm / 10); const long = mm % 10 === 0; const mid = mm % 5 === 0;
    doc.moveTo(x, 0).lineTo(x, long ? 9 : (mid ? 6 : 3)).stroke();
    if (mm % 50 === 0 && mm > 0) doc.text(String(mm / 10), x + 1.5, 10, { lineBreak: false });
  }
  for (let mm = 0; mm <= 297; mm += 1) {
    const y = pt(mm / 10); const long = mm % 10 === 0; const mid = mm % 5 === 0;
    doc.moveTo(0, y).lineTo(long ? 9 : (mid ? 6 : 3), y).stroke();
    if (mm % 50 === 0 && mm > 0) doc.text(String(mm / 10), 11, y - 3, { lineBreak: false });
  }

  const boite = (x0, y0, x1, y1, couleur, nom, tirets) => {
    doc.save().lineWidth(0.6).strokeColor(couleur);
    if (tirets) doc.dash(3, { space: 2 });
    doc.rect(pt(x0), pt(y0), pt(x1 - x0), pt(y1 - y0)).stroke().restore();
    if (nom) doc.font("Helvetica").fontSize(6.5).fillColor(couleur).text(nom, pt(x0) + 2, pt(y0) + 2, { lineBreak: false });
  };
  // éléments préimprimés mesurés (vert) : le repère doit se superposer à l'élément réel
  boite(P.logo.x, P.logo.y, P.logo.x + P.logo.l, P.logo.y + P.logo.h, "#1a8a3a", "logo");
  boite(P.coordonnees.x[0], P.coordonnees.y[0], P.coordonnees.x[1], P.coordonnees.y[1], "#1a8a3a", "coordonnées");
  boite(0, P.barre.y[0], MESURES.page.largeur, P.barre.y[1], "#1a8a3a", "barre");
  boite(P.decor.x[0], P.decor.y[0], P.decor.x[1], P.decor.y[1], "#1a8a3a", "décor pâle", true);
  doc.save().lineWidth(0.6).strokeColor("#1a8a3a").moveTo(pt(P.filetX), pt(P.filetY[0])).lineTo(pt(P.filetX), pt(P.filetY[1])).stroke().restore();
  doc.font("Helvetica").fontSize(6.5).fillColor("#1a8a3a").text("filet 5,86 cm", pt(P.filetX) + 2, pt(P.filetY[0]) - 9, { lineBreak: false });

  // zones de JURIA (rouge : texte page 1 ; bleu : colonne de droite)
  boite(MESURES.page1.texteX, MESURES.page1.haut, (MESURES.page.largeur - MESURES.margeDroite), MESURES.page1.bas, "#c0392b", "texte page 1 : 6,2 cm → 17,8 cm");
  doc.save().lineWidth(0.6).strokeColor("#2a5db0").dash(4, { space: 2 })
    .moveTo(pt(MESURES.droiteX), pt(MESURES.page1.haut)).lineTo(pt(MESURES.droiteX), pt(MESURES.page1.bas)).stroke().restore();
  doc.font("Helvetica").fontSize(6.5).fillColor("#2a5db0").text("colonne de droite 10,3 cm", pt(MESURES.droiteX) + 2, pt(MESURES.page1.haut) - 9, { lineBreak: false });
  boite(MESURES.suivantes.texteX, MESURES.suivantes.haut, (MESURES.page.largeur - MESURES.margeDroite), MESURES.suivantes.bas, "#c0392b", "texte pages suivantes : 3,175 cm → 17,8 cm", true);

  // carré de 10 cm (vérification de l'échelle d'impression)
  doc.save().lineWidth(0.8).strokeColor("#000000").rect(pt(7.0), pt(8.0), pt(10), pt(10)).stroke().restore();
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#000000")
    .text("Ce carré doit mesurer exactement 10 cm × 10 cm (impression à 100 %).", pt(7.2), pt(8.15), { width: pt(9.6) });
  doc.font("Helvetica").fontSize(8).fillColor("#333333").text(
    [
      "PAGE DE CALIBRAGE — papier à en-tête JFC Avocats Mali",
      "",
      "1. Imprimer à 100 % (taille réelle, sans « ajuster à la page »), sur le papier à en-tête, en simple face.",
      "2. Les repères VERTS reprennent l'emplacement mesuré des éléments préimprimés : ils doivent se superposer à eux.",
      "3. Les repères ROUGES montrent la zone de texte (page 1 puis pages suivantes), le repère BLEU la colonne de droite.",
      "4. Relever en millimètres les écarts éventuels (filet, coordonnées, logo, barre) et les transmettre : ils règlent le calibrage.",
    ].join("\n"),
    pt(7.2), pt(9.6), { width: pt(9.6), lineGap: 2 });
  doc.end();
  return fini;
}

module.exports = { genererCalibragePdf };
