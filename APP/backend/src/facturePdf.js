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
// Enrichi le 28/08/2026 (demande utilisateur : « informations manquantes »,
// à partir du modèle de note d'honoraires papier fourni en référence —
// DOC/CLAUDE CODE - JURIA/Modèle - Note d'honoraires...) : logo + couleurs
// du cabinet, bloc « DOIT » client, dossier suivi par (responsable +
// intervenants), objet, montant en toutes lettres, coordonnées bancaires du
// cabinet pour le règlement, mention libre, signature. Le contenu et la
// mise en page reprennent l'esprit du modèle, pas son gabarit exact (pas de
// nouvelle numérotation) — voir CLAUDE.md.
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
const path = require("path");
const PDFDocument = require("pdfkit");
const { montantEnLettres } = require("./nombreEnLettres");

const LOGO_PATH = path.join(__dirname, "../assets/logo-jfc.png");

// Palette du cabinet (extraite du logo — orange #DB8B2D / bleu #005DAC des
// deux anneaux entrelacés) : utilisée avec parcimonie (titre, filet
// d'accent, encadré du total), jamais sur de longs blocs de texte.
const STYLE = {
  bleu: "#005DAC",
  orange: "#DB8B2D",
  texte: "#1a1a1a",
  gris: "#555555",
  grisClair: "#888888",
  ligne: "#cccccc",
  rouge: "#b00020",
  fondTotal: "#eef5fb",
};

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

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet",
  "août", "septembre", "octobre", "novembre", "décembre"];

function fmt(n) {
  // toLocaleString("fr-FR") sépare les milliers par une espace insécable
  // (U+00A0) ou fine (U+202F) selon l'ICU du runtime — absente de la police
  // standard Helvetica de pdfkit, elle s'affichait comme un caractère
  // fautif (« / ») plutôt qu'un espace. Toujours normaliser vers une
  // espace ASCII simple.
  return Math.round(Number(n) || 0).toLocaleString("fr-FR").replace(/\s/g, " ");
}
function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("fr-FR") : "—";
}
// Date en toutes lettres (pas de dépendance à l'ICU du runtime, écrite à la
// main pour un document à valeur légale) — ex. « 13 août 2026 ».
function fmtDateLettres(d) {
  if (!d) return "—";
  const dt = new Date(d);
  return `${dt.getDate()} ${MOIS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function nomComplet(u) {
  return `${u.prenom} ${(u.nom || "").toUpperCase()}`;
}

// ---------------------------------------------------------------------
// Chargement des données depuis la base — séparé du dessin (dessinerFacture
// ci-dessous) pour pouvoir prévisualiser des variantes de mise en page sur
// des données fictives sans toucher à la base (scripts/preview-facture).
// ---------------------------------------------------------------------
async function chargerDonnees(pool, factureId) {
  const f = await pool.query(
    `SELECT f.*,
            COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom,
            c.adresse AS client_adresse, c.ville AS client_ville, c.pays AS client_pays,
            c.rccm AS client_rccm, c.nif AS client_nif,
            d.numero AS dossier_numero, d.intitule AS dossier_intitule, d.objet AS dossier_objet
     FROM factures f
     JOIN clients c ON c.id = f.client_id
     LEFT JOIN dossiers d ON d.id = f.dossier_id
     WHERE f.id = $1`,
    [factureId]
  );
  if (!f.rows[0]) return null;
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

  // Équipe du dossier (« Dossier suivi par ») : responsable en premier, puis
  // intervenants, dédoublonnés — dossier_intervenants prévue au schéma dès
  // le premier commit mais jamais lue par facturePdf.js avant ce jour.
  let equipe = [];
  if (fac.dossier_id) {
    const [resp, interv] = await Promise.all([
      pool.query(
        `SELECT u.id, u.prenom, u.nom FROM dossiers d JOIN utilisateurs u ON u.id = d.responsable_id WHERE d.id = $1`,
        [fac.dossier_id]
      ),
      pool.query(
        `SELECT u.id, u.prenom, u.nom FROM dossier_intervenants di JOIN utilisateurs u ON u.id = di.utilisateur_id WHERE di.dossier_id = $1`,
        [fac.dossier_id]
      ),
    ]);
    const vus = new Set();
    for (const u of [...resp.rows, ...interv.rows]) {
      if (vus.has(u.id)) continue;
      vus.add(u.id);
      equipe.push(u);
    }
  }

  // Compte à créditer : celui choisi explicitement à l'émission, sinon le
  // premier compte actif de fonctionnement/CARPA du cabinet (repli — pas de
  // RIB inventé si aucun compte n'existe en base).
  let compte = null;
  if (fac.compte_reglement_id) {
    const r = await pool.query("SELECT * FROM comptes_bancaires WHERE id = $1", [fac.compte_reglement_id]);
    compte = r.rows[0] || null;
  } else {
    const r = await pool.query(
      "SELECT * FROM comptes_bancaires WHERE actif = TRUE AND type IN ('fonctionnement','carpa') ORDER BY type, intitule LIMIT 1"
    );
    compte = r.rows[0] || null;
  }

  return { fac, cab, temps: temps.rows, debours: debours.rows, paiements: paiements.rows, equipe, compte };
}

// ---------------------------------------------------------------------
// Dessin — pure fonction de (doc, données) -> contenu PDF. Ne fait aucun
// accès base ni réseau : réutilisable telle quelle pour une prévisualisation
// hors ligne.
// ---------------------------------------------------------------------
function dessinerFacture(doc, { fac, cab, temps, debours, paiements, equipe, compte }) {
  // xMontant à 470 (colonne de 75pt) faisait déborder les gros montants
  // (« 27 397 306 XOF » en gras 12pt) hors du cadre TOTAL TTC — élargi à
  // 400 (colonne de 145pt) pour que le montant tienne sur une seule ligne.
  const xLabel = 50, xMontant = 400, largeurPage = 495;

  // --- En-tête : logo + identité minimale ---
  // Positions explicites (pas de dépendance à doc.y, peu fiable ici : ce
  // bloc mélange une image, du texte aligné à droite et du texte aligné à
  // gauche sur les mêmes lignes).
  const yHeader = 42;
  try {
    doc.image(LOGO_PATH, xLabel, yHeader, { width: 95 });
  } catch (e) {
    // Pas de logo trouvé (environnement de test, etc.) : on continue sans —
    // jamais bloquant pour l'émission d'une facture.
  }
  doc.fontSize(8).font("Helvetica").fillColor(STYLE.grisClair);
  const detailsCabinet = [cab.forme, cab.adresse, [cab.telephone, cab.email].filter(Boolean).join(" — ")].filter(Boolean);
  let yDetail = yHeader + 58;
  for (const ligne of detailsCabinet) { doc.text(ligne, xLabel, yDetail, { width: 280 }); yDetail += 11; }
  doc.fillColor(STYLE.texte);

  // Date d'émission, alignée à droite du même bandeau.
  doc.fontSize(9).font("Helvetica").fillColor(STYLE.gris)
    .text(`Bamako, le ${fmtDateLettres(fac.date_emission)}`, xLabel, yHeader + 3, { width: largeurPage, align: "right" });
  doc.fillColor(STYLE.texte);

  // Filet d'accent bicolore (clin d'œil aux deux anneaux du logo), sous le
  // plus bas des deux blocs (logo / détails cabinet).
  const yFilet = Math.max(yHeader + 58, yDetail) + 6;
  doc.rect(xLabel, yFilet, largeurPage * 0.62, 2.5).fill(STYLE.bleu);
  doc.rect(xLabel + largeurPage * 0.62, yFilet, largeurPage * 0.38, 2.5).fill(STYLE.orange);
  doc.fillColor(STYLE.texte);
  doc.y = yFilet + 14;

  // --- Titre + référence ---
  const titre = fac.type_document === "note_de_frais" ? "NOTE DE FRAIS" : fac.type_document === "avoir" ? "AVOIR" : "NOTE D'HONORAIRES";
  doc.fontSize(18).font("Helvetica-Bold").fillColor(STYLE.bleu).text(titre, xLabel, doc.y, { width: largeurPage, align: "center" });
  doc.fillColor(STYLE.texte);
  doc.fontSize(11).font("Helvetica-Bold").text(`N° ${fac.numero}`, xLabel, doc.y + 2, { width: largeurPage, align: "center" });
  doc.fontSize(9).font("Helvetica").fillColor(fac.statut === "annulee" ? STYLE.rouge : STYLE.gris)
    .text(`Statut : ${LABELS_STATUT[fac.statut] || fac.statut}`, xLabel, doc.y + 2, { width: largeurPage, align: "center" });
  doc.fillColor(STYLE.texte);
  doc.moveDown(1);

  // --- Bloc « DOIT » (client) ---
  doc.fontSize(10).font("Helvetica-Bold").text("DOIT :", xLabel);
  doc.font("Helvetica-Bold").fontSize(10).text(fac.client_nom || "—");
  doc.font("Helvetica").fontSize(9);
  const adresseFacturation = fac.adresse_facturation || fac.client_adresse;
  if (adresseFacturation) doc.text(adresseFacturation);
  const villePays = [fac.client_ville, fac.client_pays].filter(Boolean).join(", ");
  if (villePays) doc.text(villePays);
  const idClient = [fac.client_rccm && `RCCM ${fac.client_rccm}`, fac.client_nif && `NIF ${fac.client_nif}`].filter(Boolean).join(" · ");
  if (idClient) doc.text(idClient);

  // --- Dossier suivi par / Objet ---
  doc.moveDown(0.6);
  if (equipe && equipe.length) {
    doc.font("Helvetica-Bold").fontSize(9).text("Dossier suivi par : ", xLabel, doc.y, { continued: true });
    doc.font("Helvetica").text(equipe.map(nomComplet).join(" – "));
  }
  const objet = fac.objet || fac.dossier_objet || fac.dossier_intitule;
  if (objet) {
    doc.font("Helvetica-Bold").fontSize(9).text("Objet : ", xLabel, doc.y, { continued: true });
    doc.font("Helvetica-Oblique").text(objet);
  }
  if (fac.dossier_numero) {
    doc.font("Helvetica").fontSize(8).fillColor(STYLE.grisClair).text(`Réf. dossier : ${fac.dossier_numero}`, xLabel, doc.y);
    doc.fillColor(STYLE.texte);
  }

  // --- Détail honoraires ---
  doc.moveDown(1);
  function ligneTableau(label, montant, opts = {}) {
    doc.font(opts.gras ? "Helvetica-Bold" : "Helvetica").fontSize(opts.petit ? 8 : 9);
    doc.text(label, xLabel, doc.y, { width: xMontant - xLabel - 10 });
    doc.text(`${fmt(montant)} ${fac.devise}`, xMontant, doc.y - (doc.currentLineHeight()), { width: largeurPage - xMontant + xLabel, align: "right" });
  }

  doc.font("Helvetica-Bold").fontSize(11).fillColor(STYLE.bleu).text("Honoraires", xLabel);
  doc.fillColor(STYLE.texte);
  doc.moveTo(xLabel, doc.y + 2).lineTo(xLabel + largeurPage, doc.y + 2).strokeColor(STYLE.ligne).stroke();
  doc.moveDown(0.4);

  if (temps.length) {
    temps.forEach((t) => {
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
  if (debours.length || Number(fac.montant_debours) > 0) {
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(STYLE.bleu).text("Débours avancés pour le client (hors TVA)", xLabel);
    doc.fillColor(STYLE.texte);
    doc.moveDown(0.2);
    debours.forEach((d) => {
      ligneTableau(`${fmtDate(d.date_depense)} — ${d.libelle}`, d.montant, { petit: true });
      doc.moveDown(0.15);
    });
    doc.moveDown(0.2);
    ligneTableau("Total débours", fac.montant_debours, { gras: true });
  }

  // --- Récapitulatif (encadré) --- fond peint AVANT le texte (pdfkit ne
  // supporte pas de rect semi-transparent sous du texte déjà écrit).
  doc.moveDown(0.8);
  const yBox = doc.y;
  const hauteurBox = 42;
  doc.rect(xLabel - 6, yBox - 6, largeurPage + 12, hauteurBox).fill(STYLE.fondTotal);
  doc.fillColor(STYLE.texte);
  doc.font("Helvetica").fontSize(9);
  doc.text(`TVA (${Number(fac.taux_tva)} %)`, xLabel, yBox, { width: xMontant - xLabel - 10 });
  doc.text(`${fmt(fac.montant_tva)} ${fac.devise}`, xMontant, yBox, { width: largeurPage - xMontant + xLabel, align: "right" });
  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("TOTAL TTC", xLabel, yBox + 20, { width: xMontant - xLabel - 10 });
  doc.text(`${fmt(fac.montant_ttc)} ${fac.devise}`, xMontant, yBox + 20, { width: largeurPage - xMontant + xLabel, align: "right" });
  doc.lineWidth(1);
  doc.rect(xLabel - 6, yBox - 6, largeurPage + 12, hauteurBox).strokeColor(STYLE.bleu).stroke();
  doc.y = yBox + hauteurBox + 6;

  if (fac.devise !== "XOF") {
    doc.font("Helvetica").fontSize(8).fillColor(STYLE.grisClair);
    doc.text(`Contre-valeur FCFA : ${fmt(fac.montant_ttc_xof)} XOF (taux verrouillé à l'émission : 1 ${fac.devise} = ${Number(fac.taux_applique)} XOF)`, xLabel, doc.y, { width: largeurPage });
    doc.fillColor(STYLE.texte);
  }

  // --- Montant en toutes lettres ---
  doc.moveDown(1);
  // libelle_principal (« xof » ou « devise ») décide quel montant est
  // énoncé en premier quand la facture est en devise étrangère — champ
  // prévu au schéma depuis le 17/08/2026, jamais lu par aucun code avant
  // ce jour.
  let phrase, parenthese = null;
  if (fac.devise === "XOF") {
    phrase = montantEnLettres(fac.montant_ttc, "XOF");
  } else if (fac.libelle_principal === "xof") {
    phrase = montantEnLettres(fac.montant_ttc_xof, "XOF");
    parenthese = `soit l'équivalent de ${montantEnLettres(fac.montant_ttc, fac.devise)}`;
  } else {
    phrase = montantEnLettres(fac.montant_ttc, fac.devise);
    parenthese = `soit l'équivalent en Francs CFA de ${montantEnLettres(fac.montant_ttc_xof, "XOF")}`;
  }
  doc.font("Helvetica-Bold").fontSize(9).text(
    `Arrêtée la présente ${titre.toLowerCase()} à la somme de ${phrase}` + (parenthese ? "" : ".") ,
    xLabel, doc.y, { width: largeurPage }
  );
  if (parenthese) {
    doc.font("Helvetica-Oblique").fontSize(8).fillColor(STYLE.gris).text(`(${parenthese}).`, xLabel, doc.y, { width: largeurPage });
    doc.fillColor(STYLE.texte);
  }

  // --- Mention libre + formule de politesse ---
  doc.moveDown(0.8);
  if (fac.statut !== "annulee") {
    doc.font("Helvetica").fontSize(9).text("Pour votre aimable règlement.", xLabel);
  }
  if (fac.mention) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(9).text(`Mention : ${fac.mention}`, xLabel, doc.y, { width: largeurPage });
  }

  // --- Signature ---
  doc.moveDown(1.2);
  doc.font("Helvetica-Bold").fontSize(10).text(cab.raison_sociale || "", xLabel, doc.y, { width: largeurPage, align: "right" });

  // --- Règlement (paiements déjà reçus) ---
  const regle = paiements.reduce((s, p) => s + Number(p.montant), 0);
  doc.moveDown(1);
  if (paiements.length) {
    doc.font("Helvetica-Bold").fontSize(9).text(`Réglé à ce jour : ${fmt(regle)} ${fac.devise}` + (regle < Number(fac.montant_ttc) ? ` — Reste dû : ${fmt(Number(fac.montant_ttc) - regle)} ${fac.devise}` : ""));
  }

  // --- Informations de paiement (NIF + RIB) ---
  if (fac.statut !== "annulee" && (cab.nif || compte)) {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(STYLE.bleu).text("Informations de paiement", xLabel);
    doc.fillColor(STYLE.texte).font("Helvetica").fontSize(8);
    doc.text("Prière d'indiquer les références de la facture sur l'ordre de virement.");
    if (cab.nif) doc.text(`NIF ${cab.raison_sociale || "cabinet"} : ${cab.nif}`);
    if (compte) {
      doc.moveDown(0.3);
      doc.font("Helvetica-Bold").text(`${compte.intitule}${compte.banque ? " — " + compte.banque : ""}`);
      doc.font("Helvetica");
      if (compte.code_banque || compte.code_guichet || compte.numero || compte.cle_rib) {
        doc.text(
          `Code banque : ${compte.code_banque || "—"}    Code guichet : ${compte.code_guichet || "—"}    ` +
          `N° de compte : ${compte.numero || "—"}    Clé RIB : ${compte.cle_rib || "—"}`
        );
      }
      if (compte.iban) doc.text(`IBAN : ${compte.iban}`);
      if (compte.bic) doc.text(`BIC (SWIFT) : ${compte.bic}`);
    }
  }

  // --- Pied de page ---
  if (cab.mentions_legales) {
    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(7).fillColor(STYLE.grisClair).text(cab.mentions_legales, xLabel, doc.y, { width: largeurPage });
    doc.fillColor(STYLE.texte);
  }
}

// Renvoie true si la facture existe et a été streamée dans `res`, false si
// introuvable (laisse l'appelant renvoyer 404 sans avoir touché à `res`).
async function envoyerFacturePdf(pool, factureId, res) {
  const donnees = await chargerDonnees(pool, factureId);
  if (!donnees) return false;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${donnees.fac.numero}.pdf"`);

  // compress:false — fichier texte-only d'une page, différence de taille
  // négligeable ; en échange le flux reste lisible tel quel (débogage,
  // tests de non-régression sur le contenu sans dépendre d'un parseur PDF).
  const doc = new PDFDocument({ size: "A4", margin: 50, compress: false });
  doc.pipe(res);
  dessinerFacture(doc, donnees);
  doc.end();
  return true;
}

module.exports = { envoyerFacturePdf, chargerDonnees, dessinerFacture, STYLE };
