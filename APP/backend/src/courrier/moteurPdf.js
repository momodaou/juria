// JURIA — Générateur de courriers : rendu PDF (lot 0, 04/11/2026).
//
// Mise en page maison (pas de flux automatique de pdfkit) : chaque ligne est placée à la main pour que la
// largeur et la marge gauche changent d'une page à l'autre (page 1 : texte à 6,2 cm, à droite du filet du
// papier à en-tête ; pages suivantes : marge normale). Même modèle de mise en page que le Word
// (moteurDocx.js). Police Helvetica (métriquement compatible avec l'Arial du cabinet).
//
// Sortie A : papier à en-tête préimprimé — seul le texte est imprimé.
// Sortie B : en-tête numérique — logo, filet, coordonnées, barre (+ décor pâle en option) dessinés par les
//            calques de assets/courrier/ ; pages suivantes : référence en petit.
// Numérotation « n/N » dès qu'il y a au moins deux pages.
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { MESURES, pt, bordDroit } = require("./mesures");

const ASSETS = path.join(__dirname, "../../assets/courrier");
const TAILLE = MESURES.police.taille;
const LH = TAILLE * MESURES.police.interligne;           // hauteur d'une ligne : 13,8 pt
const GRIS = "#555555";

const POLICES = { n: "Helvetica", b: "Helvetica-Bold", i: "Helvetica-Oblique", bi: "Helvetica-BoldOblique" };

// « du **gras** » → [{ t, b }]
function segmenter(texte, gras = false) {
  const morceaux = String(texte).split("**");
  const segs = [];
  morceaux.forEach((m, k) => { if (m) segs.push({ t: m, b: gras ? true : k % 2 === 1 }); });
  return segs;
}

async function genererPdf(lettre, opts = {}) {
  const sortie = opts.sortie === "B" ? "B" : "A";
  const logo = opts.logo === "std" ? "std" : "mali";
  const decor = opts.decor !== false;
  const doc = new PDFDocument({
    size: "A4", margin: 0, autoFirstPage: false, bufferPages: true, compress: opts.compress !== false,
    info: { Title: `Courrier ${lettre.nref || ""}`.trim(), Author: "JURIA — JFC Avocats Mali" },
  });
  const morceaux = [];
  doc.on("data", (c) => morceaux.push(c));
  const fini = new Promise((res) => doc.on("end", () => res(Buffer.concat(morceaux))));

  const calque = (nom) => fs.readFileSync(path.join(ASSETS, nom));
  const L = pt(MESURES.page.largeur), H = pt(MESURES.page.hauteur);
  let page = 0;
  let y = 0;

  // --- géométrie par page -------------------------------------------------------------------
  const haut = () => pt(page === 1 ? MESURES.page1.haut : MESURES.suivantes.haut);
  const bas = () => pt(page === 1 ? MESURES.page1.bas : MESURES.suivantes.bas);
  function colonne(nom, retrait = 0) {
    const gauche = nom === "droite" ? MESURES.droiteX : (page === 1 ? MESURES.page1.texteX : MESURES.suivantes.texteX);
    const x = pt(gauche + retrait);
    return { x, w: pt(bordDroit()) - x };
  }

  function decorer() {
    if (sortie !== "B") return;
    if (page === 1) {
      if (decor) doc.image(calque("entete-b-decor.png"), 0, 0, { width: L, height: H });
      doc.image(calque(`entete-b-base-${logo}.png`), 0, 0, { width: L, height: H });
    } else {
      doc.font(POLICES.n).fontSize(8).fillColor(GRIS)
        .text(lettre.nref || "", pt(MESURES.suivantes.texteX), pt(1.2), { lineBreak: false });
      doc.fillColor("#000000");
    }
  }
  function nouvellePage() { doc.addPage({ size: "A4", margin: 0 }); page += 1; decorer(); y = haut(); }

  // --- jetons et lignes ---------------------------------------------------------------------
  function mesurer(texte, police) { return doc.font(police).fontSize(TAILLE).widthOfString(texte); }
  // spec : tableau de { t, b, i, ul } ; les espaces insécables restent dans le jeton (libellés soulignés d'un seul tenant).
  // Un jeton peut regrouper plusieurs morceaux de styles différents quand aucun espace ne les sépare
  // (ex. « **000230**, » : le gras et la virgule restent collés).
  function jetons(spec) {
    const out = [];
    let courant = null;
    spec.forEach((s) => {
      const police = POLICES[(s.b ? "b" : "") + (s.i ? "i" : "") || "n"];
      String(s.t).split(/( +)/).forEach((morceau) => {
        if (!morceau) return;
        if (/^ +$/.test(morceau)) { courant = null; return; }
        const part = { t: morceau, police, ul: !!s.ul, w: mesurer(morceau, police) };
        if (!courant) { courant = { parts: [], w: 0 }; out.push(courant); }
        courant.parts.push(part); courant.w += part.w;
      });
    });
    return out;
  }
  const espace = () => mesurer(" ", POLICES.n);

  // Écrit un bloc de jetons à partir de la colonne choisie ; renvoie quand tout est placé.
  function bloc(spec, { col = "texte", align = "left", retrait = 0, decalX = 0 } = {}) {
    const js = jetons(spec);
    const sp = espace();
    let i = 0;
    while (i < js.length) {
      const { x, w } = colonne(col, retrait);
      const largeur = w - decalX;
      let ligne = [], somme = 0, j = i;
      while (j < js.length) {
        const ajout = (ligne.length ? sp : 0) + js[j].w;
        if (ligne.length && somme + ajout > largeur) break;
        ligne.push(js[j]); somme += ajout; j += 1;
      }
      if (y + LH > bas()) { nouvellePage(); continue; }
      const derniere = j >= js.length;
      let pas = sp;
      if (align === "justify" && !derniere && ligne.length > 1) {
        pas = (largeur - ligne.reduce((a, t) => a + t.w, 0)) / (ligne.length - 1);
      }
      let cx = x + decalX;
      ligne.forEach((t) => {
        let px = cx;
        t.parts.forEach((pa) => {
          doc.font(pa.police).fontSize(TAILLE).fillColor("#000000").text(pa.t, px, y, { lineBreak: false });
          if (pa.ul) {                                      // soulignement maison : juste sous la ligne de base
            const yb = y + doc._font.ascender / 1000 * TAILLE + 1.6;
            doc.save().lineWidth(0.7).strokeColor("#000000").moveTo(px, yb).lineTo(px + pa.w, yb).stroke().restore();
          }
          px += pa.w;
        });
        if (opts.trace) opts.trace.push({ page, x: cx, y, w: t.w, t: t.parts.map((q) => q.t).join(""), col });
        cx += t.w + pas;
      });
      y += LH; i = j;
    }
  }
  const vide = (n = 1) => { y += LH * n; if (y > bas()) { nouvellePage(); } };
  const libelle = (mot) => ({ t: mot.replace(/ /g, " "), b: true, ul: true });

  // --- bloc de signature (colonne de droite, calé sur la ligne la plus longue) --------------------
  function apposition(x, yBox) {
    const s = opts.signature;
    if (!s) return 0;
    const ens = s.ens || 1, ts = s.ts || 1;
    const k = pt(MESURES.cachet.largeur * ens) / s.cachet.largeur;
    doc.image(s.cachetBuf, x, yBox, { width: s.cachet.largeur * k });
    const sw = s.sig.largeur * k * ts, sh = s.sig.hauteur * k * ts;
    const sx = x + s.sig.dx * k + (s.sig.largeur * k - sw) / 2 + (s.ox || 0);
    const sy = yBox + s.sig.dy * k + (s.sig.hauteur * k - sh) / 2 + (s.oy || 0);
    doc.image(s.sigBuf, sx, sy, { width: sw });
    return Math.max(s.cachet.hauteur * k, sy - yBox + sh) + 4;
  }
  function hauteurAppo() {
    const s = opts.signature;
    if (!s) return pt(3.0);                                   // place laissée à la signature (la même pour A et B : mise en page identique)
    const ens = s.ens || 1, ts = s.ts || 1;
    const k = pt(MESURES.cachet.largeur * ens) / s.cachet.largeur;
    const sh = s.sig.hauteur * k * ts;
    const sy = s.sig.dy * k + (s.sig.hauteur * k - sh) / 2 + (s.oy || 0);
    return Math.max(s.cachet.hauteur * k, sy + sh) + 4;
  }
  function blocSignature(sig) {
    const psc = sig.bloc !== "con";
    const lignes = psc
      ? [[libelle("P/SCPA JFC AVOCATS-MALI"), "b"], [{ t: sig.nom, b: true }, "b"], [{ t: sig.qualite || "", i: true }, "i"]]
      : [[{ t: "Le Conseil" }, "n"], [{ t: "SCPA JFC AVOCATS - MALI", b: true }, "b"], [{ t: `Me ${sig.nom}` }, "n"], [{ t: sig.qualite || "", i: true }, "i"]];
    const maxW = Math.max(...lignes.map(([spec, f]) => {
      const j = jetons([spec]); return j.reduce((a, t) => a + t.w, 0) + espace() * (j.length - 1);
    }));
    const x0 = pt(MESURES.droiteX);
    const dispo = pt(bordDroit()) - x0;
    const decale = Math.max(0, Math.ceil(maxW + 2 - dispo));         // règle de secours : seul le bloc se décale
    const hBox = hauteurAppo();
    const hauteur = lignes.length * LH + hBox + LH;
    if (y + hauteur > bas()) nouvellePage();                          // le bloc ne reste jamais seul en bas de page
    const idxApres = psc ? 1 : 2;                                     // le cachet/signature se pose après la formule d'en-tête du bloc
    lignes.forEach(([spec], k) => {
      if (k === idxApres) { apposition(pt(MESURES.droiteX) - decale, y); y += hBox; }
      bloc([spec], { col: "droite", decalX: -decale });
    });
  }

  // --- composition de la lettre -------------------------------------------------------------------------------
  nouvellePage();
  bloc([{ t: lettre.date }], { col: "droite" });
  vide();
  bloc([libelle("À l’attention de"), { t: " :", b: true }], { col: "droite" });
  vide();
  lettre.destinataire.forEach((l) => bloc([{ t: l, b: true }], { col: "droite" }));
  if (lettre.ville) bloc([{ t: lettre.ville, b: true, ul: true }], { col: "droite" });
  vide();
  bloc([libelle("N/R"), { t: " :", b: true }, { t: ` ${lettre.nref}`, b: true }]);
  vide();
  if (lettre.affaire) { bloc([libelle("Affaire"), { t: " :", b: true }, { t: ` ${lettre.affaire}` }]); vide(); }
  bloc([libelle("Objet"), { t: " :", b: true }, { t: ` ${lettre.objet}` }]);
  if (lettre.precision) bloc([{ t: lettre.precision, i: true }], { retrait: 1.5 });
  vide();
  if (lettre.motif) { bloc([libelle("Motif"), { t: " :", b: true }, { t: ` ${lettre.motif}` }]); vide(); }
  bloc([{ t: lettre.appel, b: true }]);
  vide();
  lettre.paragraphes.forEach((p) => { bloc(segmenter(p), { align: "justify" }); vide(); });
  bloc(segmenter(lettre.politesse), { align: "justify" });
  vide(2);
  blocSignature(lettre.signature);
  if (lettre.pj) { vide(); bloc([libelle("P.J."), { t: " :", b: true }, { t: ` ${lettre.pj}` }]); }

  // --- numérotation « n/N » (au moins deux pages) --------------------------------------------------------------
  const total = doc.bufferedPageRange().count;
  if (total > 1) {
    for (let k = 0; k < total; k += 1) {
      doc.switchToPage(k);
      doc.font(POLICES.n).fontSize(9).fillColor("#333333");
      const txt = `${k + 1}/${total}`;
      doc.text(txt, pt(bordDroit()) - doc.widthOfString(txt), pt(MESURES.numero.y), { lineBreak: false });
    }
  }
  doc.end();
  const buffer = await fini;
  return { buffer, pages: total };
}

module.exports = { genererPdf, segmenter };
