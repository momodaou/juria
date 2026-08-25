// JURIA — Génération du PDF d'une facture (support « papier numérique »).
//
// Contexte (25/08/2026, demande utilisateur) : une facture émise n'avait
// jusqu'ici aucune représentation fichier — juste une ligne dans la table
// `factures`, jamais de document déposé en GED, aucun bouton Voir/
// Télécharger côté écran. Contrairement à l'Atelier d'actes (texte brut
// `.txt`), une facture a besoin d'une vraie mise en page (montants alignés,
// tableau, TVA) — d'où pdfkit (dessin direct, pas de navigateur headless :
// cohérent avec le choix du projet d'éviter les dépendances lourdes, et bien
// plus adapté à un démarrage à froid Cloud Run que Puppeteer/Chromium).
//
// Générée à la volée à chaque téléchargement (GET /api/factures/:id/pdf),
// PAS enregistrée dans la GED : une facture n'a pas de PUT après création
// (seule `annuler` change son statut), donc le PDF est toujours reconstruit
// à l'identique depuis les données figées en base — pas besoin de la
// persister comme fichier séparé pour cette passe.
//
// Portée retenue (option « honoraires + frais/débours en totaux distincts »,
// pas de vraie ligne par ligne façon `lignes_facture`, qui reste non
// câblée) : le détail des temps/débours effectivement rattachés à CETTE
// facture (via temps.facture_id / depenses.facture_id) est listé nommément
// quand il existe — sans passer par lignes_facture — sinon repli sur une
// ligne globale « Honoraires ».
const PDFDocument = require("pdfkit");

const LABELS_MODE = {
  forfait: "Forfait",
  temps_passe: "Temps passé",
  success_fee: "Success fee",
  abonnement: "Abonnement",
  consultation: "Consultation",
};

const LABELS_STATUT = {
  brouillon: "Brouillon",
  emise: "Émise",
  partielle: "Partiellement réglée",
  payee: "Réglée",
  impayee: "Impayée",
  annulee: "ANNULÉE",
};

function fmt(n) {
  return Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/ /g, " ");
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
}

// Renvoie true si la facture existe et a été streamée dans `res`, false si
// introuvable (laisse l'appelant renvoyer 404 sans avoir touché à `res`).
async function envoyerFacturePdf(pool, factureId, res) {
  const f = await pool.query(
    `SELECT f.*,
            COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom,
            c.adresse AS client_adresse, c.ville AS client_ville, c.pays AS client_pays,
            c.rccm AS client_rccm, c.nif AS client_nif,
            d.numero AS dossier_numero, d.intitule AS dossier_intitule
     FROM factures f
     JOIN clients c ON c.id = f.client_id
     LEFT JOIN dossiers d ON d.id = f.dossier_id
     WHERE f.id = $1`,
    [factureId]
  );
  if (!f.rows[0]) return false;
  const fac = f.rows[0];

  const [cabinet, temps, debours, paiements] = await Promise.all([
    pool.query("SELECT * FROM parametres_cabinet WHERE id = 1"),
    pool.query(
      `SELECT t.date_saisie, t.duree_minutes, t.taux_horaire, t.description, u.prenom || ' ' || u.nom AS auteur
       FROM temps t JOIN utilisateurs u ON u.id = t.utilisateur_id
       WHERE t.facture_id = $1 ORDER BY t.date_saisie`,
      [factureId]
    ),
    pool.query(
      "SELECT libelle, montant, date_depense FROM depenses WHERE facture_id = $1 ORDER BY date_depense",
      [factureId]
    ),
    pool.query("SELECT montant, mode, date_paiement FROM paiements WHERE facture_id = $1 ORDER BY date_paiement", [factureId]),
  ]);
  const cab = cabinet.rows[0] || {};

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${fac.numero}.pdf"`);

  // compress:false — fichier texte-only d'une page, différence de taille
  // négligeable ; en échange le flux reste lisible tel quel (débogage,
  // tests de non-régression sur le contenu sans dépendre d'un parseur PDF).
  const doc = new PDFDocument({ size: "A4", margin: 50, compress: false });
  doc.pipe(res);

  // --- En-tête cabinet ---
  doc.fontSize(14).font("Helvetica-Bold").text(cab.raison_sociale || "Cabinet", { continued: false });
  doc.fontSize(9).font("Helvetica").fillColor("#444");
  if (cab.forme) doc.text(cab.forme);
  const ligneCoord = [cab.adresse, cab.telephone, cab.email].filter(Boolean).join(" — ");
  if (ligneCoord) doc.text(ligneCoord);
  const ligneId = [cab.rccm && `RCCM ${cab.rccm}`, cab.nif && `NIF ${cab.nif}`].filter(Boolean).join(" · ");
  if (ligneId) doc.text(ligneId);
  doc.fillColor("#000");

  // --- Titre + statut ---
  doc.moveDown(1.2);
  const titre = fac.type_document === "note_de_frais" ? "NOTE DE FRAIS" : fac.type_document === "avoir" ? "AVOIR" : "FACTURE";
  doc.fontSize(20).font("Helvetica-Bold").text(`${titre} ${fac.numero}`);
  doc.fontSize(10).font("Helvetica").fillColor(fac.statut === "annulee" ? "#b00020" : "#444")
    .text(`Statut : ${LABELS_STATUT[fac.statut] || fac.statut}`);
  doc.fillColor("#000");
  doc.fontSize(9).text(`Date d'émission : ${fmtDate(fac.date_emission)}     Échéance : ${fmtDate(fac.date_echeance)}`);
  if (fac.dossier_numero) doc.text(`Dossier : ${fac.dossier_numero}${fac.dossier_intitule ? " — " + fac.dossier_intitule : ""}`);

  // --- Bloc client ---
  doc.moveDown(1);
  doc.fontSize(10).font("Helvetica-Bold").text("Facturé à :");
  doc.font("Helvetica").fontSize(9);
  doc.text(fac.client_nom || "—");
  const adresseFacturation = fac.adresse_facturation || fac.client_adresse;
  if (adresseFacturation) doc.text(adresseFacturation);
  const villePays = [fac.client_ville, fac.client_pays].filter(Boolean).join(", ");
  if (villePays) doc.text(villePays);
  const idClient = [fac.client_rccm && `RCCM ${fac.client_rccm}`, fac.client_nif && `NIF ${fac.client_nif}`].filter(Boolean).join(" · ");
  if (idClient) doc.text(idClient);

  // --- Détail honoraires ---
  doc.moveDown(1.2);
  const xLabel = 50, xMontant = 470, largeurPage = 495;
  function ligneTableau(label, montant, opts = {}) {
    doc.font(opts.gras ? "Helvetica-Bold" : "Helvetica").fontSize(opts.petit ? 8 : 9);
    doc.text(label, xLabel, doc.y, { width: xMontant - xLabel - 10 });
    doc.text(`${fmt(montant)} ${fac.devise}`, xMontant, doc.y - (doc.currentLineHeight()), { width: largeurPage - xMontant + xLabel, align: "right" });
  }

  doc.font("Helvetica-Bold").fontSize(11).text("Honoraires", xLabel);
  doc.moveTo(xLabel, doc.y + 2).lineTo(xLabel + largeurPage, doc.y + 2).strokeColor("#ccc").stroke();
  doc.moveDown(0.4);

  if (temps.rows.length) {
    temps.rows.forEach((t) => {
      const montant = Math.round((Number(t.duree_minutes) / 60) * Number(t.taux_horaire));
      const heures = (Number(t.duree_minutes) / 60).toFixed(2).replace(".", ",");
      const label = `${fmtDate(t.date_saisie)} — ${t.auteur} — ${heures} h${t.description ? " — " + t.description : ""}`;
      ligneTableau(label, montant, { petit: true });
      doc.moveDown(0.15);
    });
  } else {
    ligneTableau(`${LABELS_MODE[fac.mode] || fac.mode}`, fac.montant_ht);
  }
  doc.moveDown(0.3);
  ligneTableau("Total honoraires HT", fac.montant_ht, { gras: true });

  // --- Frais (montant global, pas de détail nommé dans cette passe) ---
  if (Number(fac.montant_frais) > 0) {
    doc.moveDown(0.6);
    ligneTableau("Frais", fac.montant_frais, { gras: true });
  }

  // --- Débours (avancés pour le compte du client, hors TVA) ---
  if (debours.rows.length || Number(fac.montant_debours) > 0) {
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).text("Débours avancés pour le client (hors TVA)", xLabel);
    doc.moveDown(0.2);
    debours.rows.forEach((d) => {
      ligneTableau(`${fmtDate(d.date_depense)} — ${d.libelle}`, d.montant, { petit: true });
      doc.moveDown(0.15);
    });
    doc.moveDown(0.2);
    ligneTableau("Total débours", fac.montant_debours, { gras: true });
  }

  // --- Récapitulatif ---
  doc.moveDown(0.8);
  doc.moveTo(xLabel, doc.y).lineTo(xLabel + largeurPage, doc.y).strokeColor("#000").stroke();
  doc.moveDown(0.4);
  ligneTableau(`TVA (${Number(fac.taux_tva)} %)`, fac.montant_tva);
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(12);
  ligneTableau("TOTAL TTC", fac.montant_ttc, { gras: true });
  if (fac.devise !== "XOF") {
    doc.moveDown(0.2);
    doc.font("Helvetica").fontSize(8).fillColor("#666");
    doc.text(`Contre-valeur FCFA : ${fmt(fac.montant_ttc_xof)} XOF (taux verrouillé à l'émission : 1 ${fac.devise} = ${Number(fac.taux_applique)} XOF)`, xLabel, doc.y, { width: largeurPage });
    doc.fillColor("#000");
  }

  // --- Règlement ---
  const regle = paiements.rows.reduce((s, p) => s + Number(p.montant), 0);
  doc.moveDown(1);
  if (paiements.rows.length) {
    doc.font("Helvetica-Bold").fontSize(9).text(`Réglé à ce jour : ${fmt(regle)} ${fac.devise}` + (regle < Number(fac.montant_ttc) ? ` — Reste dû : ${fmt(Number(fac.montant_ttc) - regle)} ${fac.devise}` : ""));
  }
  if (fac.mode_reglement) {
    doc.font("Helvetica").fontSize(8).fillColor("#666").text(`Mode de règlement : ${fac.mode_reglement}`);
    doc.fillColor("#000");
  }

  // --- Pied de page ---
  if (cab.mentions_legales) {
    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(7).fillColor("#666").text(cab.mentions_legales, xLabel, doc.y, { width: largeurPage });
    doc.fillColor("#000");
  }

  doc.end();
  return true;
}

module.exports = { envoyerFacturePdf };
