// JURIA — Étiquette de chemise en PDF (22/10/2026).
//
// Pourquoi un PDF : l'impression HTML du navigateur (fenêtre pop-up +
// window.print) laisse le navigateur réduire ou agrandir le contenu selon
// son réglage d'échelle (« ajuster à la page », Safari…), d'où une étiquette
// dont la taille varie d'une impression à l'autre. Ici, le fichier est une
// vraie page A4 qui contient le cadre à sa taille physique exacte
// (100 x 60 mm) : à 100 %, la règle donne 10 cm sur 6 cm. Même patron que le
// rôle d'audience (rolePdf.js).
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");

const MM = 72 / 25.4;
const LARGEUR = 100 * MM;
const HAUTEUR = 60 * MM;

const COULEURS = {
  rouge: "#c0392b", jaune: "#d4ac0d", bleu: "#2874a6", vert: "#229954",
  orange: "#d35400", violet: "#7d3c98", gris: "#95a5a6", dore: "#C89938",
};
const NOMS_COULEURS = {
  bleu: "Bleu", dore: "Doré", rouge: "Rouge", vert: "Vert", violet: "Violet",
  gris: "Gris", jaune: "Jaune", orange: "Orange",
};
const OR = "#B08D57";
const TEXTE = "#1F2A44";
const GRIS = "#6B7280";

// Même règle d'abréviation que l'écran (dossier-detail) : affichage seul.
function abregeJuridiction(j) {
  if (!j) return "";
  let m = j.match(/^Tribunal de Grande Instance de la Commune\s+([IVXLCDM]+)$/i);
  if (m) return `TGI C${m[1].toUpperCase()}`;
  m = j.match(/^Tribunal de Grande Instance de\s+(.+)$/i);
  if (m) return `TGI ${m[1]}`;
  return j;
}

function libelleCouleur(c) { return c ? (NOMS_COULEURS[c] || c) : "—"; }

// Dessine l'étiquette dont le coin haut-gauche est (x, y).
function dessinerEtiquette(doc, { numero, intitule, client, juridiction, couleur, qr }, x, y) {
  const hex = COULEURS[couleur] || "#cccccc";
  const rayon = 6;

  doc.save();
  doc.roundedRect(x, y, LARGEUR, HAUTEUR, rayon).clip();
  doc.rect(x, y, 7, HAUTEUR).fill(hex);
  doc.restore();
  doc.roundedRect(x, y, LARGEUR, HAUTEUR, rayon).dash(4, { space: 3 }).lineWidth(1.5).strokeColor(OR).stroke().undash();

  const taillesQr = 65;
  const xQr = x + 7 + 12;
  doc.image(qr, xQr, y + (HAUTEUR - taillesQr) / 2, { width: taillesQr, height: taillesQr });

  const xTexte = xQr + taillesQr + 10.5;
  const largeur = x + LARGEUR - 12 - xTexte;

  // Blocs de texte : taille, nombre de lignes max. Les segments à styles mêlés
  // (« Client : » gris puis le nom en gras) sont dessinés avec `continued`.
  // La troncature est faite ici (jamais par pdfkit, qui coupe mal les textes
  // à plusieurs segments) : on raccourcit le texte jusqu'à ce qu'il tienne
  // dans le nombre de lignes voulu, avec « … » à la fin.
  const lignes = [
    { type: "num", taille: 16.5, max: 1, marge: 0, police: "Courier-Bold", etiquette: "", valeur: numero },
    { type: "intitule", taille: 12.75, max: 3, marge: 4, police: "Helvetica-Bold", etiquette: "", valeur: intitule },
    { type: "client", taille: 11.25, max: 2, marge: 5, police: "Helvetica-Bold", etiquette: "Client : ", valeur: client },
    ...(juridiction ? [{ type: "juridiction", taille: 10.5, max: 1, marge: 4, police: "Helvetica", etiquette: "Juridiction : ", valeur: juridiction }] : []),
    { type: "chemise", taille: 9.75, max: 1, marge: 5, police: "Helvetica-Bold", etiquette: "Chemise : ", valeur: libelleCouleur(couleur) },
  ];

  lignes.forEach((l) => {
    doc.font(l.police).fontSize(l.taille);
    const pas = doc.currentLineHeight(true);
    let v = String(l.valeur);
    const hauteurDe = (t) => doc.heightOfString(l.etiquette + t, { width: largeur });
    if (hauteurDe(v) > pas * l.max + 0.5) {
      while (v.length > 1 && hauteurDe(v + "…") > pas * l.max + 0.5) v = v.slice(0, -1);
      v = v.trimEnd() + "…";
    }
    l.valeur = v;
    l.hauteur = hauteurDe(v);
  });
  const total = lignes.reduce((s, l) => s + l.hauteur + l.marge, 0);
  let yT = y + Math.max(9, (HAUTEUR - Math.min(total, HAUTEUR - 18)) / 2);

  lignes.forEach((l) => {
    yT += l.marge;
    if (l.etiquette) {
      doc.font("Helvetica").fontSize(l.taille).fillColor(l.type === "client" ? GRIS : l.type === "juridiction" ? GRIS : TEXTE)
        .text(l.etiquette, xTexte, yT, { width: largeur, continued: true });
      doc.font(l.police).fillColor(l.type === "chemise" ? hex : TEXTE).text(l.valeur, { width: largeur });
    } else {
      doc.font(l.police).fontSize(l.taille).fillColor(TEXTE).text(l.valeur, xTexte, yT, { width: largeur });
    }
    yT += l.hauteur;
  });
  doc.fillColor(TEXTE);
}

// Renvoie le PDF (Buffer) d'une étiquette. `d` : { numero, intitule,
// client_nom, juridiction, couleur_chemise } ; `url` : lien encodé dans le QR.
async function genererEtiquettePdfBuffer(d, url) {
  const qr = await QRCode.toBuffer(url, { width: 340, margin: 1 });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 0, compress: false });
    const morceaux = [];
    doc.on("data", (m) => morceaux.push(m));
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);
    const x = (doc.page.width - LARGEUR) / 2;
    dessinerEtiquette(doc, {
      numero: d.numero || "",
      intitule: d.intitule || "",
      client: d.client_nom || "—",
      juridiction: abregeJuridiction(d.juridiction),
      couleur: d.couleur_chemise,
      qr,
    }, x, 15 * MM);
    doc.end();
  });
}

module.exports = { genererEtiquettePdfBuffer, abregeJuridiction, libelleCouleur, LARGEUR, HAUTEUR };
