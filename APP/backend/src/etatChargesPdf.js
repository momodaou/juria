// JURIA — PDF de l'état mensuel des charges (support « papier » des associés).
// Paysage A4, pdfkit (même choix que le rôle d'audience : l'orientation est
// imposée dans le fichier). Une colonne « Décision » laissée vide permet aux
// associés d'annoter à la main (approuvé / reporté / rejeté) avant la saisie.
const PDFDocument = require("pdfkit");
const { libelleMoyen } = require("./moyensPaiement");

const TEXTE = "#1F2A44";
const GRIS = "#6B7280";
const OR = "#B08D57";
const LIGNE = "#D9DEE7";
const ROUGE = "#B3261E";
const MARGE = 28;
const TAILLE = 10.5;

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const nombre = (n) => Number(n || 0).toLocaleString("fr-FR").replace(/[  ]/g, " ");
const jour = (d) => (d ? new Date(d).toISOString().slice(0, 10).split("-").reverse().join("/") : "");
const libelleMois = (d) => { const x = new Date(d); return `${MOIS[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };

function periode(l) {
  if (!l.periode_debut) return "";
  const a = new Date(l.periode_debut); const b = l.periode_fin ? new Date(l.periode_fin) : a;
  const ABREGE = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const court = (x) => `${ABREGE[x.getUTCMonth()]} ${x.getUTCFullYear()}`;
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() ? libelleMois(a) : `${court(a)} – ${court(b)}`;
}

const DECISIONS = { en_attente: "À décider", approuvee: "Approuvée", rejetee: "Rejetée", reportee: "Reportée" };

// Précisions utiles aux associés pour décider (28/10/2026) : nature d'« Autre », dossier, bénéficiaire, arriéré, justificatifs.
function details(l) {
  const d = [];
  if (l.categorie === "autre" && l.precision_autre) d.push(`Autre : ${l.precision_autre}`);
  if (l.nature === "dossier") d.push(`Dossier ${l.dossier_numero || ""}${l.refacturable_client ? " (refacturable au client)" : ""}`.trim());
  if (l.beneficiaire) d.push(`Bénéficiaire : ${l.beneficiaire}`);
  if (!l.report_de && l.periode_debut && l.mois_etat && String(l.periode_debut).slice(0, 7) < String(l.mois_etat).slice(0, 7)) d.push("Arriéré");
  if (l.nb_pieces) d.push(`${l.nb_pieces} justificatif(s) joint(s)`);
  return d;
}

function genererEtatChargesPdf({ etat, lignes, raisonSociale }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGE });
    const morceaux = [];
    doc.on("data", (c) => morceaux.push(c));
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);

    const largeur = doc.page.width - 2 * MARGE;
    const cols = [
      { t: "Charge", p: 0.30 }, { t: "Période couverte", p: 0.14 }, { t: "Montant (FCFA)", p: 0.12, d: true },
      { t: "Retard", p: 0.07 }, { t: "Moyen / compte proposé", p: 0.20 }, { t: "Décision des associés", p: 0.17 },
    ].map((c) => ({ ...c, w: c.p * largeur }));

    const entete = () => {
      doc.font("Helvetica-Bold").fontSize(16).fillColor(TEXTE).text(raisonSociale || "JFC AVOCATS MALI", MARGE, MARGE);
      doc.font("Helvetica-Bold").fontSize(13).fillColor(OR).text(`État des charges — ${libelleMois(etat.mois)}`);
      doc.font("Helvetica").fontSize(9).fillColor(GRIS)
        .text(`Statut : ${etat.statut === "en_preparation" ? "en préparation" : etat.statut === "soumis" ? "soumis aux associés" : "clos"}   ·   Édité le ${jour(new Date())}`);
      doc.moveDown(0.6);
    };
    const enteteTableau = () => {
      let x = MARGE; const y = doc.y;
      doc.rect(MARGE, y, largeur, 22).fill(TEXTE);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor("#FFFFFF");
      for (const c of cols) { doc.text(c.t, x + 5, y + 6, { width: c.w - 10, align: c.d ? "right" : "left", lineBreak: false }); x += c.w; }
      doc.y = y + 22;
    };

    entete();
    enteteTableau();

    let total = 0;
    for (const l of lignes.map((x) => ({ ...x, mois_etat: etat.mois }))) {
      const moyen = [l.mode_paiement ? libelleMoyen(l.mode_paiement) : "", l.compte_intitule || ""].filter(Boolean).join(" — ");
      const cellules = [
        l.libelle + details(l).map((t) => `\n${t}`).join("") + (l.observation ? `\n${l.observation}` : "") + (l.report_de ? "\n(reporté d'un mois précédent)" : ""),
        periode(l),
        nombre(l.montant) + (l.montant_precedent != null ? `\nmois préc. : ${nombre(l.montant_precedent)}` : ""),
        l.retard_mois ? `${l.retard_mois} mois` : "",
        moyen,
        l.decision === "en_attente" ? "" : DECISIONS[l.decision] + (l.motif ? ` — ${l.motif}` : ""),
      ];
      doc.font("Helvetica").fontSize(TAILLE);
      const h = Math.max(24, ...cellules.map((t, i) => doc.heightOfString(t, { width: cols[i].w - 10 }) + 12));
      if (doc.y + h > doc.page.height - MARGE - 40) { doc.addPage(); doc.y = MARGE; enteteTableau(); }
      const y = doc.y;
      let x = MARGE;
      cellules.forEach((t, i) => {
        const alerte = i === 3 && l.retard_mois >= 2;
        doc.font(i === 0 || alerte ? "Helvetica-Bold" : "Helvetica").fontSize(TAILLE).fillColor(alerte ? ROUGE : TEXTE)
          .text(t, x + 5, y + 6, { width: cols[i].w - 10, align: cols[i].d ? "right" : "left" });
        x += cols[i].w;
      });
      doc.moveTo(MARGE, y + h).lineTo(MARGE + largeur, y + h).strokeColor(LIGNE).lineWidth(0.6).stroke();
      doc.y = y + h;
      if (l.decision !== "rejetee") total += Number(l.montant || 0);
    }

    if (doc.y + 50 > doc.page.height - MARGE) { doc.addPage(); doc.y = MARGE; }
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(TEXTE)
      .text(`Total des charges (hors rejetées) : ${nombre(total)} FCFA`, MARGE, doc.y, { width: largeur, align: "right" });
    doc.end();
  });
}

module.exports = { genererEtatChargesPdf, DECISIONS };
