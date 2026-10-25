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
// Le style mixte au sein d'une même ligne (nom en gras + « (client) » en
// gras+italique/petit/gris, étiquettes « Motif dernier renvoi »/
// « Instructions » en gras dans la colonne Notes) est bien reproduit —
// voir dessinerLigneParties()/dessinerParagrapheEtiquette() plus bas :
// pdfkit ne change pas de police EN COURS d'un seul appel `.text()`, mais
// y parvient en enchaînant plusieurs appels avec `{ continued: true }`,
// qui se comportent comme un seul paragraphe (retour à la ligne normal,
// pas de rupture forcée entre les segments).
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
// Proportions reprises À L'IDENTIQUE du <colgroup> de l'ancienne version
// HTML (8/6/22/10/10/8/20/8/8 — voir git a18b5ba) : ma 1re passe du PDF les
// avait dérivées sans base (25/…/6/5), ce qui a fini par casser le mot
// "Audiencier" en 2 lignes ("Audie"/"ncier", colonne trop étroite pour un
// mot sans espace) — trouvé en vérifiant les autres écarts avec l'original
// (retour utilisateur du 23/09/2026).
const COLONNES = [
  { cle: "date", label: "Date", pct: 10 },
  { cle: "heure", label: "Heure", pct: 6 },
  { cle: "parties", label: "Parties", pct: 23 },
  { cle: "juridiction", label: "Juridiction", pct: 12 },
  { cle: "procedure", label: "Procédure", pct: 9 },
  { cle: "type", label: "Type audience", pct: 8 },
  { cle: "notes", label: "Notes (audience du jour)", pct: 16 },
  { cle: "resp", label: "Resp dossier", pct: 7 },
  { cle: "audiencier", label: "Audiencier", pct: 9 },
];
// 23/09/2026 (2e passe, retour utilisateur « écritures en petits
// caractères, tableau qui ne remplit pas assez la feuille ») — comparé à
// l'ancienne version HTML (police 12px de base pour le tableau, en-têtes
// padding 5px/8px), la police 8.5pt/padding 4pt d'origine du PDF étaient
// nettement en retrait (12px CSS ≈ 9pt en points PDF à 72dpi). Remonté à
// une échelle plus proche de l'original, avec plus de respiration par
// ligne — HAUTEUR_ENTETE doublée car les intitulés de colonne à 2 mots
// ("Type audience", "Resp dossier") s'enroulent désormais sur 2 lignes à
// cette taille et débordaient de la bande d'en-tête sinon.
// 21/10/2026 (3e passe, retour utilisateur « caractères en miniature à
// l'édition/impression ») : mesuré sur un rôle fictif, le texte à 9,5 pt
// sur A4 paysage restait petit à l'écran (aperçu réduit à la largeur de la
// fenêtre) comme sur papier. Texte 12 pt, marges 24 pt, interlignes plus
// généreux ; toutes les tailles passent par ces constantes pour que la
// mesure des hauteurs et le dessin ne divergent jamais.
const TAILLE_TEXTE = 12;
const TAILLE_PETIT = 10;
const TAILLE_ENTETE_COL = 10.5;
const TAILLE_TITRE = 18;
const TAILLE_SOUS_TITRE = 11;
const MARGE_PAGE = 24;
const PADDING = 7;
const HAUTEUR_MIN_LIGNE = 30;
const HAUTEUR_ENTETE = 36;

// `minima` (optionnel, par clé de colonne) : largeur plancher en points, pour
// qu'aucun mot ne soit coupé en plein milieu (« Conciliation » dans « Type
// audience », retour utilisateur du 25/10/2026). Les colonnes sous leur
// plancher sont portées à celui-ci ; l'excédent est retiré aux autres
// colonnes, proportionnellement à leur marge au-dessus de leur propre plancher.
function calculerColonnes(largeurTable, xDepart, minima = {}) {
  let largeurs = COLONNES.map((c) => (largeurTable * c.pct) / 100);
  const planchers = COLONNES.map((c, i) => Math.min(minima[c.cle] || 0, largeurTable / 2));
  let manque = 0;
  largeurs = largeurs.map((w, i) => {
    if (w >= planchers[i]) return w;
    manque += planchers[i] - w;
    return planchers[i];
  });
  if (manque > 0) {
    const marges = largeurs.map((w, i) => Math.max(0, w - Math.max(planchers[i], 0) - 0));
    const totalMarges = marges.reduce((a, b) => a + b, 0);
    if (totalMarges > 0) {
      const retrait = Math.min(manque, totalMarges);
      largeurs = largeurs.map((w, i) => w - (retrait * marges[i]) / totalMarges);
    }
  }
  let x = xDepart;
  return COLONNES.map((c, i) => {
    const colonne = { ...c, x, w: largeurs[i] };
    x += largeurs[i];
    return colonne;
  });
}

// Largeur du mot le plus long de chaque colonne (en-tête + contenus), aux
// polices réellement utilisées au dessin, plus le padding des deux côtés.
function minimaColonnes(doc, lignes, natures) {
  const minima = {};
  const mesurer = (cle, police, taille, texte) => {
    doc.font(police).fontSize(taille);
    const m = String(texte || "").split(/\s+/).reduce((mx, mot) => Math.max(mx, mot ? doc.widthOfString(mot) : 0), 0);
    minima[cle] = Math.max(minima[cle] || 0, m + PADDING * 2 + 1);
  };
  COLONNES.forEach((c) => mesurer(c.cle, "Helvetica-Bold", TAILLE_ENTETE_COL, c.label));
  (lignes || []).forEach((l) => {
    const contenu = contenuColonnes(l, natures);
    ["juridiction", "procedure", "type", "resp", "audiencier", "heure"].forEach((cle) =>
      mesurer(cle, "Helvetica-Bold", TAILLE_TEXTE, contenu[cle]));
  });
  return minima;
}

function dessinerEnTeteColonnes(doc, colonnes, y) {
  doc.rect(colonnes[0].x, y, colonnes.reduce((s, c) => s + c.w, 0), HAUTEUR_ENTETE).fill(STYLE.enteteFond);
  doc.font("Helvetica-Bold").fontSize(TAILLE_ENTETE_COL).fillColor(STYLE.enteteTexte);
  colonnes.forEach((c) => doc.text(c.label, c.x + PADDING, y + 8, { width: c.w - PADDING * 2 }));
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

// Reprend l'accent décidé le 21/09/2026 pour la version imprimée : les
// parties en gras (info prioritaire à la lecture d'un rôle), la référence
// du dossier reléguée en dessous, plus petite et en italique (repère de
// recherche secondaire) — inversé par rapport à une version antérieure.
// Centralisé ici pour que hauteurCellule (mesure) et dessinerCellule
// (rendu) ne divergent jamais sur la police utilisée.
//
// "parties" ligne 0 et "notes" sont en réalité des lignes à styles MIXTES
// (voir dessinerLigneParties/dessinerParagrapheEtiquette) — cette fonction
// sert uniquement à fixer une police de MESURE (hauteurCellule) volontai-
// rement conservatrice : tout en gras majore l'estimation de hauteur
// plutôt que de la sous-estimer (jamais de texte coupé en bas de cellule),
// le gras étant systématiquement égal ou plus large que le normal/italique.
function styleLigne(doc, colonne, i) {
  if (colonne.cle === "parties") {
    if (i === 0) { doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte); return; }
    doc.font("Helvetica-Oblique").fontSize(TAILLE_PETIT).fillColor(STYLE.gris);
    return;
  }
  if (colonne.cle === "notes") { doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte); return; }
  doc.font("Helvetica").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte);
}

// Ligne "Parties" (index 0 de la colonne "parties") : reprend le mélange de
// styles de l'ancienne version imprimée — nom + "c/ adverse" en gras,
// "(client)" en gras+italique/petit/gris (span imbriqué dans le <b>
// d'origine). pdfkit ne permet pas de changer de police au milieu d'un
// .text() : on découpe la chaîne déjà formatée par texteParties() et on
// enchaîne 2-3 appels en { continued: true }, qui se comportent comme un
// seul paragraphe qui s'enroule normalement (pas de rupture de ligne forcée
// entre les segments).
function dessinerLigneParties(doc, texte, x, y, width) {
  const i = texte.indexOf(" (client)");
  if (i === -1) {
    // Repli défensif — texteParties() ajoute toujours ce suffixe ;
    // ne devrait jamais se produire.
    doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte).text(texte, x, y, { width });
    return;
  }
  const gauche = texte.slice(0, i);
  const reste = texte.slice(i + " (client)".length); // "" ou " c/ Partie adverse"
  doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte)
    .text(`${gauche} `, x, y, { width, continued: true });
  doc.font("Helvetica-BoldOblique").fontSize(TAILLE_PETIT).fillColor(STYLE.gris)
    .text("(client)", { continued: !!reste });
  if (reste) {
    doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte).text(reste);
  }
}

// Segment "Notes" (ex. "Motif dernier renvoi : Grève des greffiers") :
// même principe — étiquette (avec son " : ") en gras, valeur en normal,
// repris tel quel de l'ancienne version imprimée (<b>Étiquette :</b>
// valeur). "—" (aucun motif/instructions) n'a pas de " : " → repli en
// texte simple, jamais mis en gras à tort.
function dessinerParagrapheEtiquette(doc, texte, x, y, width) {
  const i = texte.indexOf(" : ");
  if (i === -1) {
    doc.font("Helvetica").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte).text(texte, x, y, { width });
    return;
  }
  const etiquette = texte.slice(0, i + 3); // inclut " : "
  const valeur = texte.slice(i + 3);
  doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte)
    .text(etiquette, x, y, { width, continued: true });
  doc.font("Helvetica").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte).text(valeur);
}

function hauteurCellule(doc, colonne, valeur) {
  const largeurUtile = colonne.w - PADDING * 2;
  if (Array.isArray(valeur)) {
    return valeur.reduce((s, ligne, i) => {
      styleLigne(doc, colonne, i);
      return s + doc.heightOfString(ligne, { width: largeurUtile });
    }, 0) + (valeur.length - 1) * 2;
  }
  styleLigne(doc, colonne, 0);
  return doc.heightOfString(String(valeur), { width: largeurUtile });
}

function dessinerCellule(doc, colonne, valeur, y, hauteurLigne) {
  const largeurUtile = colonne.w - PADDING * 2;
  if (Array.isArray(valeur)) {
    let curY = y + PADDING;
    valeur.forEach((ligne, i) => {
      styleLigne(doc, colonne, i); // fixe aussi la police utilisée par heightOfString ci-dessous
      if (colonne.cle === "parties" && i === 0) {
        dessinerLigneParties(doc, ligne, colonne.x + PADDING, curY, largeurUtile);
      } else if (colonne.cle === "notes") {
        dessinerParagrapheEtiquette(doc, ligne, colonne.x + PADDING, curY, largeurUtile);
      } else {
        doc.text(ligne, colonne.x + PADDING, curY, { width: largeurUtile });
      }
      // 🐛 Bug trouvé le 09/10/2026 (cas réel : dossier "Moumouni Konaté",
      // intitulé SANS " c/ " — reproduit avec un intitulé long à une seule
      // partie) : dessinerLigneParties()/dessinerParagrapheEtiquette()
      // changent la police EN COURS DE DESSIN (mélange gras/italique) sans
      // la restaurer après coup — sans "c/ Partie" à la suite, la dernière
      // police posée est l'italique 8pt de "(client)", plus étroite que le
      // gras 9.5pt qui a dessiné le nom. heightOfString() ci-dessous
      // mesurait alors avec CETTE police résiduelle au lieu de celle
      // réellement utilisée pour l'essentiel du texte, sous-estimant le
      // nombre de lignes réellement occupées et faisant chevaucher la
      // référence du dossier (ligne suivante) sur le texte encore affiché.
      // Corrigé en réappliquant systématiquement la police de mesure
      // (même styleLigne() que juste avant le dessin) avant de mesurer —
      // cohérent avec hauteurCellule(), qui fait déjà ainsi.
      styleLigne(doc, colonne, i);
      curY += doc.heightOfString(ligne, { width: largeurUtile }) + 2;
    });
  } else {
    styleLigne(doc, colonne, 0);
    doc.text(String(valeur), colonne.x + PADDING, y + PADDING, { width: largeurUtile });
  }
  doc.fillColor(STYLE.texte);
  doc.rect(colonne.x, y, colonne.w, hauteurLigne).strokeColor(STYLE.ligne).lineWidth(0.5).stroke();
}

function dessinerRole(doc, { raisonSociale, role, lignes, natures }) {
  const marge = MARGE_PAGE;
  const largeurTable = doc.page.width - marge * 2;
  const basPage = doc.page.height - marge;
  const colonnes = calculerColonnes(largeurTable, marge, minimaColonnes(doc, lignes, natures));

  // --- En-tête cabinet ---
  doc.font("Helvetica-Bold").fontSize(TAILLE_TITRE).fillColor(STYLE.texte)
    .text(`${raisonSociale} — Rôle d'audience`, marge, marge);
  doc.moveTo(marge, doc.y + 3).lineTo(marge + largeurTable, doc.y + 3).strokeColor(STYLE.or).lineWidth(2).stroke();
  doc.font("Helvetica").fontSize(TAILLE_SOUS_TITRE).fillColor(STYLE.gris)
    .text(
      `Semaine du ${formaterDate(role.semaine_debut)} au ${formaterDate(role.semaine_fin)} — édité le ${new Date().toLocaleString("fr-FR")}`,
      marge, doc.y + 8
    );
  doc.fillColor(STYLE.texte);

  let y = doc.y + 14;
  y = dessinerEnTeteColonnes(doc, colonnes, y);

  if (!lignes.length) {
    doc.font("Helvetica-Oblique").fontSize(TAILLE_TEXTE).fillColor(STYLE.gris)
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
    // 23/09/2026 (2e bug de pagination, trouvé sur un rôle réel après le
    // grossissement de la police/hauteur de ligne) — cette vérification
    // comparait à `Math.min(hauteurGroupe, HAUTEUR_MIN_LIGNE)`, un seuil
    // optimiste supposant qu'"au moins une ligne minimale" tiendrait
    // toujours. Avec des lignes réelles bien plus hautes que le minimum
    // (Notes sur 2-3 lignes), ce seuil passait alors que la PREMIÈRE ligne
    // réelle ne tenait pas du tout : la boucle plus bas démarrait alors le
    // groupe avec 0 ligne dessinée, dessinait l'étiquette du jour dans un
    // espace quasi nul en bas de page — juste assez pour que pdfkit
    // déclenche SA PROPRE pagination automatique au milieu du texte
    // (comportement par défaut de `.text()` en dépassement de page, non
    // documenté comme tel mais observé), créant une page fantôme jamais
    // voulue ni gérée par ce code (sans en-tête de colonnes) avant que le
    // `doc.addPage()` explicite ci-dessous n'en crée une 2e, correcte.
    // Corrigé en comparant à la hauteur RÉELLE de la première ligne du
    // groupe plutôt qu'à un minimum optimiste — si elle ne tient pas,
    // tout le groupe part sur une page fraîche avant qu'aucune ligne (ni
    // aucune étiquette) n'ait été dessinée.
    if (y + hauteurs[0].h > basPage && y > marge + HAUTEUR_ENTETE + 20) {
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
      doc.font("Helvetica-Bold").fontSize(TAILLE_TEXTE).fillColor(STYLE.texte)
        .text(formaterJour(cleJour), colDate.x + PADDING, yDebutSegment + PADDING, { width: colDate.w - PADDING * 2 });
    }

    let yDebutSegment = y;
    hauteurs.forEach(({ l, contenu, h }) => {
      if (y + h > basPage) {
        // Filet de sécurité (même bug que ci-dessus, en profondeur) :
        // jamais de boîte pour un segment où 0 ligne n'a été dessinée
        // (yDebutSegment === y) — rien à étiqueter, et un rectangle
        // quasi nul en fin de page est justement ce qui déclenche la
        // pagination fantôme de pdfkit décrite plus haut.
        if (y > yDebutSegment) dessinerBoiteDate(yDebutSegment, y);
        doc.addPage();
        y = marge;
        y = dessinerEnTeteColonnes(doc, colonnes, y);
        yDebutSegment = y;
      }
      colonnes.forEach((c) => { if (c.cle !== "date") dessinerCellule(doc, c, contenu[c.cle], y, h); });
      y += h;
    });
    if (y > yDebutSegment) dessinerBoiteDate(yDebutSegment, y);

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

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGE_PAGE, compress: false });
  doc.pipe(res);
  dessinerRole(doc, donnees);
  doc.end();
  return true;
}

// Variante en mémoire (11/10/2026, diffusion par e-mail du rôle) : même
// contenu que envoyerRolePdf(), mais collecté dans un Buffer plutôt que
// streamé vers une réponse HTTP — pour une pièce jointe d'e-mail
// (mailer.js, attachments: [{filename, content}]). Renvoie null si le
// rôle n'existe pas, comme envoyerRolePdf() renvoie false.
async function genererRolePdfBuffer(pool, roleId) {
  const donnees = await chargerDonnees(pool, roleId);
  if (!donnees) return null;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: MARGE_PAGE, compress: false });
    const morceaux = [];
    doc.on("data", (m) => morceaux.push(m));
    doc.on("end", () => resolve(Buffer.concat(morceaux)));
    doc.on("error", reject);
    dessinerRole(doc, donnees);
    doc.end();
  });
}

// styleLigne/dessinerLigneParties/texteParties/calculerColonnes exportés en
// plus (09/10/2026) uniquement pour le test de non-régression dédié au bug
// de chevauchement ci-dessus (tests/rolePdf.test.js) — aucun autre appelant.
module.exports = { TAILLE_TEXTE, TAILLE_PETIT, envoyerRolePdf, genererRolePdfBuffer, chargerDonnees, dessinerRole, formaterDate, STYLE, styleLigne, dessinerLigneParties, texteParties, calculerColonnes, minimaColonnes };
