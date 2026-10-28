// JURIA — Sortie Word (.docx) d'un acte de l'Atelier d'actes (28/10/2026).
//
// Même principe que actePdf.js : le texte courant du document (documents.ocr_texte,
// seule version faisant foi) est mis en forme à la demande, jamais persisté. La
// différence : le .docx se retravaille dans Word (styles, en-tête du cabinet,
// pagination) avant dépôt dans le dossier ou envoi.
//
// Mise en forme (pas d'imposition au-delà du strict nécessaire — l'auteur
// maîtrise la structure du texte) :
//  - une ligne du texte = un paragraphe ; une ligne vide = un espacement ;
//  - une ligne entièrement en majuscules et courte (« REQUETE AUX FINS DE… »,
//    « PAR CES MOTIFS ») = intitulé gras centré ;
//  - une ligne commençant par « • », « - » ou « * » = puce ;
//  - un paragraphe long est justifié, comme dans les actes du cabinet.
// Pas de date en tête (contrairement au PDF) : les modèles portent déjà leur « Bamako, le … ».
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, ImageRun, Header, Footer, PageNumber, AlignmentType, BorderStyle,
} = require("docx");
const { chargerDonnees } = require("./actePdf");

const LOGO_PATH = path.join(__dirname, "../assets/logo-jfc.png");
const POLICE = "Times New Roman";
const BLEU = "005DAC";
const GRIS = "666666";

// Intitulé : au moins 4 lettres, aucune minuscule, longueur raisonnable.
function estIntitule(ligne) {
  const lettres = ligne.replace(/[^A-Za-zÀ-ÿ]/g, "");
  return lettres.length >= 4 && ligne.length <= 110 && lettres === lettres.toUpperCase();
}

const PUCE = /^\s*[•\-*]\s+/;

function paragrapheDeLigne(ligne) {
  const texte = ligne.replace(/\t/g, "    ").replace(/\s+$/, "");
  if (!texte.trim()) return new Paragraph({ spacing: { after: 120 }, children: [] });
  if (estIntitule(texte.trim())) {
    return new Paragraph({
      alignment: AlignmentType.CENTER, spacing: { before: 120, after: 160 },
      children: [new TextRun({ text: texte.trim(), bold: true, font: POLICE, size: 24 })],
    });
  }
  if (PUCE.test(texte)) {
    return new Paragraph({
      bullet: { level: 0 }, spacing: { after: 80 }, alignment: AlignmentType.JUSTIFIED,
      children: [new TextRun({ text: texte.replace(PUCE, ""), font: POLICE, size: 24 })],
    });
  }
  return new Paragraph({
    alignment: texte.length > 120 ? AlignmentType.JUSTIFIED : AlignmentType.LEFT, spacing: { after: 100 },
    children: [new TextRun({ text: texte, font: POLICE, size: 24 })],
  });
}

function enTete(cab) {
  const enfants = [];
  try {
    enfants.push(new Paragraph({
      spacing: { after: 60 },
      children: [new ImageRun({ type: "png", data: fs.readFileSync(LOGO_PATH), transformation: { width: 90, height: 54 } })],
    }));
  } catch (e) {
    // Pas de logo trouvé (environnement de test, etc.) : jamais bloquant.
  }
  const lignes = [cab.forme, cab.adresse, [cab.telephone, cab.email].filter(Boolean).join(" — "),
    [cab.rccm && `RCCM ${cab.rccm}`, cab.nif && `NIF ${cab.nif}`].filter(Boolean).join(" · ")].filter(Boolean);
  lignes.forEach((ligne, i) => {
    const dernier = i === lignes.length - 1;
    enfants.push(new Paragraph({
      spacing: { after: dernier ? 100 : 0 },
      border: dernier ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: BLEU, space: 4 } } : undefined,
      children: [new TextRun({ text: ligne, font: POLICE, size: 16, color: GRIS })],
    }));
  });
  return new Header({ children: enfants });
}

function piedDePage(acte) {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({ text: `Réf. dossier : ${acte.dossier_numero} — ${acte.dossier_intitule}   ·   Page `, font: POLICE, size: 16, color: GRIS }),
        new TextRun({ children: [PageNumber.CURRENT], font: POLICE, size: 16, color: GRIS }),
        new TextRun({ text: " / ", font: POLICE, size: 16, color: GRIS }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], font: POLICE, size: 16, color: GRIS }),
      ],
    })],
  });
}

// Pure fonction (données) -> Buffer .docx — aucun accès base/réseau, même esprit que dessinerActe().
async function construireDocx({ acte, cab }) {
  const lignes = String(acte.ocr_texte || "").replace(/\r\n?/g, "\n").split("\n");
  const doc = new Document({
    creator: cab.raison_sociale || "JURIA",
    title: acte.nom,
    description: `Acte généré par JURIA — v${acte.version} (${acte.statut})`,
    sections: [{
      properties: { page: { margin: { top: 1700, bottom: 1300, left: 1300, right: 1300, header: 500, footer: 500 } } },
      headers: { default: enTete(cab) },
      footers: { default: piedDePage(acte) },
      children: [
        ...lignes.map(paragrapheDeLigne),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function envoyerActeDocx(pool, docId, res, enteteContentDisposition) {
  const donnees = await chargerDonnees(pool, docId);
  if (!donnees) return false;
  const buffer = await construireDocx(donnees);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", enteteContentDisposition(`${donnees.acte.nom}.docx`));
  res.send(buffer);
  return true;
}

module.exports = { construireDocx, envoyerActeDocx, estIntitule };
