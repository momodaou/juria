// JURIA — Génération du PDF du Rôle d'audience (support « papier »).
//
// Contexte (23/09/2026, demande utilisateur) : le bouton « Imprimer le
// rôle » ouvrait une fenêtre HTML et laissait le navigateur gérer
// l'impression — `@page { size: landscape }` est une simple suggestion
// que Chrome respecte assez bien, mais que Safari (navigateur par défaut
// sur Mac) n'honore pas de façon fiable pour présélectionner
// l'orientation dans sa boîte de dialogue. Remplacé par un vrai PDF
// généré côté serveur (pdfkit, même choix que les Factures le
// 25/08/2026 et l'Atelier d'actes le 13/09/2026) : l'orientation
// paysage est imposée dans le fichier lui-même, plus jamais dépendante
// du navigateur qui l'ouvre.
//
// Le contenu et la mise en page reprennent fidèlement les décisions déjà
// prises sur plusieurs passes de l'ancienne version HTML (Date en
// cellule fusionnée par jour, Heure collée à côté, Parties en texte
// fluide avec « (client) » et référence détachée, Motif dernier renvoi +
// Instructions fusionnés sous « Notes ») — pas une nouvelle conception.
// Simplification assumée par rapport au HTML : pas de style mixte au
// sein d'une même ligne de texte (pdfkit ne permet pas facilement de
// changer de police en cours de `.text()`) — « (client) » reste en gras
// comme le reste de la ligne des parties, les libellés « Motif dernier
// renvoi »/« Instructions » ne sont plus mis en gras dans la colonne
// Notes.
const PDFDocument = require("pdfkit");

const STYLE = {
  texte: "#1F2A44",
  gris: "#6B7280",
  ligne: "#C7CDD6",
  enteteFond: "#1F2A44",
  enteteTexte: "#FFFFFF",
  or: "#B08D57",
};

// ---------------------------------------------------------------------
// Formateurs — portés depuis role-audience.component.ts (écran/ancien
// HTML), même logique, réécrite en JS simple côté serveur.
// ---------------------------------------------------------------------
function formaterHeure(h) {
  return h ? String(h).slice(0, 5) : "—";
}

function formaterJour(d) {
  if (!d) return "—";
  const date = new Date(d);
  const jour = date.toLocaleDateString("fr-FR", { weekday: "long", timeZone: "UTC" });
  return jour.charAt(0).toUpperCase() + jour.slice(1) + " " + date.toLocaleDateString("fr-FR", { timeZone: "UTC" });
}

function formaterDate(d) {
  return d ? new Date(d).toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "—";
}

// Abrégé d'affichage uniquement (jamais écrit en base) — ne couvre que le
// motif décrit par l'utilisateur (« TGI CI, CII... TGI Kati ») ; toute
// autre juridiction reste affichée telle que saisie.
function abregeJuridiction(j) {
  if (!j) return "—";
  let m = j.match(/^Tribunal de Grande Instance de la Commune\s+([IVXLCDM]+)$/i);
  if (m) return `TGI C${m[1].toUpperCase()}`;
  m = j.match(/^Tribunal de Grande Instance de\s+(.+)$/i);
  if (m) return `TGI ${m[1]}`;
  return j;
}

// Découpage de l'intitulé du dossier (« Client c/ Partie adverse »,
// convention du cabinet depuis le 31/08/2026) — pas de champ structuré
// côté API, simple partage sur le séparateur littéral.
function partiesGauche(intitule) {
  if (!intitule) return "—";
  const i = intitule.indexOf(" c/ ");
  return i === -1 ? intitule : intitule.slice(0, i);
}
function partiesDroite(intitule) {
  if (!intitule) return null;
  const i = intitule.indexOf(" c/ ");
  return i === -1 ? null : intitule.slice(i + 4);
}
function texteParties(l) {
  const gauche = partiesGauche(l.dossier_intitule);
  const droite = partiesDroite(l.dossier_intitule);
  return droite ? `${gauche} (client) c/ ${droite}` : `${gauche} (client)`;
}

const LABELS_TYPE_AUDIENCE = {
  mise_en_etat: "Mise en état", plaidoirie: "Plaidoirie", conciliation: "Conciliation",
  refere: "Référé", prononce: "Prononcé", autre: "Autre",
};
function libelleTypeAudience(code) {
  return LABELS_TYPE_AUDIENCE[code] || code || "—";
}

function libelleNatureProcedure(code, precision, natures) {
  if (!code) return "—";
  if (code === "autre") return precision || "Autre";
  const trouve = natures.find((n) => n.code === code);
  return (trouve && trouve.libelle) || code;
}

// "motifs_renvoi" est un catalogue de base (id + libellé), pas un ENUM
// avec un code stable : "Autre (préciser)" ne se repère que par
// correspondance exacte de libellé — même limite que côté écran
// (motifEstAutre()/libelleMotif() dans role-audience.component.ts).
function libelleMotif(libelle, precision) {
  if (!libelle) return null;
  if (libelle === "Autre (préciser)") return precision || "Autre";
  return libelle;
}

function segmentsNotes(l) {
  const segments = [];
  const motif = libelleMotif(l.motif_dernier_renvoi, l.dernier_motif_precision);
  if (motif) segments.push(`Motif dernier renvoi : ${motif}`);
  if (l.instructions) segments.push(`Instructions : ${l.instructions}`);
  return segments.length ? segments : ["—"];
}

// ---------------------------------------------------------------------
// Chargement des données — séparé du dessin, même principe que
// facturePdf.js. Requête volontairement plus légère que GET
// /api/roles-audience (pas besoin du statut de facturation ni de
// l'instance : jamais affichés à l'impression).
// ---------------------------------------------------------------------
async function chargerDonnees(pool, roleId) {
  const role = await pool.query("SELECT * FROM roles_audience WHERE id = $1", [roleId]);
  if (!role.rows[0]) return null;

  const [cabinet, lignes, natures] = await Promise.all([
    pool.query("SELECT raison_sociale FROM parametres_cabinet WHERE id = 1"),
    pool.query(
      `SELECT l.date_prevue::text AS date_prevue, l.juridiction, l.type,
              d.numero AS dossier_numero, d.intitule AS dossier_intitule,
              u.code AS avocat_code, ur.code AS responsable_dossier_code,
              a.heure, a.instructions, a.nature_procedure, a.nature_precision,
              mrd.libelle AS motif_dernier_renvoi, a.dernier_motif_precision
       FROM role_audience_lignes l
       JOIN dossiers d ON d.id = l.dossier_id
       LEFT JOIN utilisateurs u ON u.id = l.avocat_id
       LEFT JOIN utilisateurs ur ON ur.id = d.responsable_id
       LEFT JOIN audiences a ON a.id = l.audience_id
       LEFT JOIN motifs_renvoi mrd ON mrd.id = a.dernier_motif_id
       WHERE l.role_id = $1
       ORDER BY l.date_prevue, l.juridiction`,
      [roleId]
    ),
    pool.query("SELECT code, libelle FROM listes_valeurs WHERE domaine = 'nature_procedure' AND actif = TRUE ORDER BY ordre, libelle"),
  ]);

  return {
    role: role.rows[0],
    raisonSociale: (cabinet.rows[0] || {}).raison_sociale || "JFC AVOCATS MALI",
    lignes: lignes.rows,
    natures: natures.rows,
  };
}

// ---------------------------------------------------------------------
// Dessin — table roulée à la main (pdfkit n'a pas de widget de tableau
// natif) : colonnes à largeur fixe (proportions reprises du "colgroup"
// de l'ancienne version HTML), hauteur de chaque ligne calculée à partir
// du texte le plus haut de la ligne (mesuré via heightOfString, sans
// dessiner), Date en cellule fusionnée par jour (même regroupement que
// l'écran/l'ancien HTML : les lignes d'un même jour sont déjà
// consécutives grâce à l'ORDER BY). Pagine automatiquement si le rôle
// déborde d'une page (redessine l'en-tête de colonnes sur chaque
// nouvelle page) — un jour scindé entre 2 pages n'aurait que sa 1re
// partie sous l'étiquette du jour, cas limite jugé rare et acceptable
// pour un rôle hebdomadaire.
// ---------------------------------------------------------------------
const COLONNES = [
  { cle: "date", label: "Date", pct: 8 },
  { cle: "heure", label: "Heure", pct: 6 },
  { cle: "parties", label: "Parties", pct: 25 },
  { cle: "juridiction", label: "Juridiction", pct: 10 },
  { cle: "procedure", label: "Procédure", pct: 11 },
  { cle: "type", label: "Type audience", pct: 8 },
  { cle: "notes", label: "Notes (audience du jour)", pct: 21 },
  { cle: "resp", label: "Resp dossier", pct: 6 },
  { cle: "audiencier", label: "Audiencier", pct: 5 },
];
const PADDING = 4;
const HAUTEUR_MIN_LIGNE = 20;
const HAUTEUR_ENTETE = 18;

function calculerColonnes(largeurTable, xDepart) {
  let x = xDepart;
  return COLONNES.map((c) => {
    const w = (largeurTable * c.pct) / 100;
    const colonne = { ...c, x, w };
    x += w;
    return colonne;
  });
}

function dessinerEnTeteColonnes(doc, colonnes, y) {
  doc.rect(colonnes[0].x, y, colonnes.reduce((s, c) => s + c.w, 0), HAUTEUR_ENTETE).fill(STYLE.enteteFond);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(STYLE.enteteTexte);
  colonnes.forEach((c) => doc.text(c.label, c.x + PADDING, y + 5, { width: c.w - PADDING * 2 }));
  doc.fillColor(STYLE.texte);
  return y + HAUTEUR_ENTETE;
}

// Contenu de chaque colonne pour une ligne — texte simple, ou tableau de
// paragraphes (Parties : nom + référence ; Notes : motif/instructions).
function contenuColonnes(l, natures) {
  return {
    heure: formaterHeure(l.heure),
    parties: [texteParties(l), l.dossier_numero || "—"],
    juridiction: abregeJuridiction(l.juridiction),
    procedure: libelleNatureProcedure(l.nature_procedure, l.nature_precision, natures),
    type: libelleTypeAudience(l.type),
    notes: segmentsNotes(l),
    resp: l.responsable_dossier_code || "—",
    audiencier: l.avocat_code || "—",
  };
}

function hauteurCellule(doc, colonne, valeur) {
  const largeurUtile = colonne.w - PADDING * 2;
  if (Array.isArray(valeur)) {
    doc.font("Helvetica").fontSize(8.5);
    return valeur.reduce((s, ligne) => s + doc.heightOfString(ligne, { width: largeurUtile }), 0) + (valeur.length - 1) * 2;
  }
  doc.font("Helvetica").fontSize(8.5);
  return doc.heightOfString(String(valeur), { width: largeurUtile });
}

function dessinerCellule(doc, colonne, valeur, y, hauteurLigne) {
  const largeurUtile = colonne.w - PADDING * 2;
  doc.font("Helvetica").fontSize(8.5).fillColor(STYLE.texte);
  if (Array.isArray(valeur)) {
    let curY = y + PADDING;
    valeur.forEach((ligne, i) => {
      if (i === 1 && colonne.cle === "parties") { doc.fontSize(7.5).fillColor(STYLE.gris); }
      doc.text(ligne, colonne.x + PADDING, curY, { width: largeurUtile });
      curY += doc.heightOfString(ligne, { width: largeurUtile }) + 2;
    });
    doc.fillColor(STYLE.texte);
  } else {
    doc.text(String(valeur), colonne.x + PADDING, y + PADDING, { width: largeurUtile });
  }
  doc.rect(colonne.x, y, colonne.w, hauteurLigne).strokeColor(STYLE.ligne).lineWidth(0.5).stroke();
}

function dessinerRole(doc, { raisonSociale, role, lignes, natures }) {
  const marge = 36;
  const largeurTable = doc.page.width - marge * 2;
  const basPage = doc.page.height - marge;
  const colonnes = calculerColonnes(largeurTable, marge);

  // --- En-tête cabinet ---
  doc.font("Helvetica-Bold").fontSize(14).fillColor(STYLE.texte)
    .text(`${raisonSociale} — Rôle d'audience`, marge, marge);
  doc.moveTo(marge, doc.y + 3).lineTo(marge + largeurTable, doc.y + 3).strokeColor(STYLE.or).lineWidth(2).stroke();
  doc.font("Helvetica").fontSize(9).fillColor(STYLE.gris)
    .text(
      `Semaine du ${formaterDate(role.semaine_debut)} au ${formaterDate(role.semaine_fin)} — édité le ${new Date().toLocaleString("fr-FR")}`,
      marge, doc.y + 8
    );
  doc.fillColor(STYLE.texte);

  let y = doc.y + 14;
  y = dessinerEnTeteColonnes(doc, colonnes, y);

  if (!lignes.length) {
    doc.font("Helvetica-Oblique").fontSize(10).fillColor(STYLE.gris)
      .text("Aucune audience programmée cette semaine.", marge, y + 10);
    doc.fillColor(STYLE.texte);
    return;
  }

  let i = 0;
  while (i < lignes.length) {
    const cleJour = (lignes[i].date_prevue || "").toString().slice(0, 10);
    let fin = i + 1;
    while (fin < lignes.length && (lignes[fin].date_prevue || "").toString().slice(0, 10) === cleJour) fin++;
    const groupe = lignes.slice(i, fin);

    // Hauteur de chaque ligne du groupe (avant de savoir si le groupe
    // entier tient sur la page courante).
    const hauteurs = groupe.map((l) => {
      const contenu = contenuColonnes(l, natures);
      const h = Math.max(HAUTEUR_MIN_LIGNE, ...colonnes.filter((c) => c.cle !== "date").map((c) => hauteurCellule(doc, c, contenu[c.cle]) + PADDING * 2));
      return { l, contenu, h };
    });
    const hauteurGroupe = hauteurs.reduce((s, h) => s + h.h, 0);

    // Saut de page si le groupe ne tient pas (et qu'on n'est pas déjà en
    // haut d'une page fraîche) — un jour scindé entre 2 pages redessine
    // simplement son étiquette sur la page suivante plutôt que de forcer
    // un espace vide en bas de la page courante.
    if (y + Math.min(hauteurGroupe, HAUTEUR_MIN_LIGNE) > basPage && y > marge + HAUTEUR_ENTETE + 20) {
      doc.addPage();
      y = marge;
      y = dessinerEnTeteColonnes(doc, colonnes, y);
    }

    // ⚠️ Bug trouvé en testant un rôle à 24 lignes (3 pages) : la cellule
    // Date fusionnée était dessinée UNE SEULE FOIS après la boucle, avec
    // "yDebutGroupe" capturé AVANT elle — si un saut de page survenait au
    // milieu du groupe, "yDebutGroupe" restait une coordonnée de la PAGE
    // PRÉCÉDENTE alors que "y" (fin) était désormais sur la page suivante
    // (les coordonnées pdfkit sont toujours relatives à la page courante,
    // remises à zéro par addPage()) : hauteur ("y - yDebutGroupe") négative
    // ou aberrante, rectangle démesuré/mal placé sur la dernière page.
    // Corrigé en dessinant la boîte Date par SEGMENT DE PAGE (une par
    // page traversée par le groupe, chacune avec ses propres coordonnées),
    // au lieu d'un seul rectangle supposé tenir sur une seule page.
    const colDate = colonnes[0];
    function dessinerBoiteDate(yDebutSegment, yFinSegment) {
      doc.rect(colDate.x, yDebutSegment, colDate.w, yFinSegment - yDebutSegment).strokeColor(STYLE.ligne).lineWidth(0.5).stroke();
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(STYLE.texte)
        .text(formaterJour(cleJour), colDate.x + PADDING, yDebutSegment + PADDING, { width: colDate.w - PADDING * 2 });
    }

    let yDebutSegment = y;
    hauteurs.forEach(({ l, contenu, h }) => {
      if (y + h > basPage) {
        dessinerBoiteDate(yDebutSegment, y);
        doc.addPage();
        y = marge;
        y = dessinerEnTeteColonnes(doc, colonnes, y);
        yDebutSegment = y;
      }
      colonnes.forEach((c) => { if (c.cle !== "date") dessinerCellule(doc, c, contenu[c.cle], y, h); });
      y += h;
    });
    dessinerBoiteDate(yDebutSegment, y);

    i = fin;
  }
}

// Renvoie true si le rôle existe et a été streamé dans `res`, false si
// introuvable (laisse l'appelant renvoyer 404 sans avoir touché à `res`).
async function envoyerRolePdf(pool, roleId, res) {
  const donnees = await chargerDonnees(pool, roleId);
  if (!donnees) return false;

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="Role-audience-${formaterDate(donnees.role.semaine_debut).replace(/\//g, "-")}.pdf"`
  );

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, compress: false });
  doc.pipe(res);
  dessinerRole(doc, donnees);
  doc.end();
  return true;
}

module.exports = { envoyerRolePdf, chargerDonnees, dessinerRole, STYLE };
