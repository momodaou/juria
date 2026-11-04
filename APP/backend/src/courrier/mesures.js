// JURIA — Générateur de courriers : mesures de la mise en page (lot 0, 04/11/2026).
//
// Toutes les valeurs viennent de la lettre modèle du cabinet et de la feuille vierge du papier à
// en-tête (scan, mesures du 04/11/2026). Elles sont exprimées en CENTIMÈTRES depuis le bord de la
// feuille ; `pt()` convertit en points PDF. Elles deviendront des réglages du cabinet (page de
// calibrage) aux lots suivants : rien ici n'est supposé définitif avant l'essai d'impression.
const CM_PT = 72 / 2.54;
const pt = (cm) => cm * CM_PT;

const MESURES = {
  page: { largeur: 21.0, hauteur: 29.7 },
  police: { taille: 12, interligne: 1.15 },                    // Arial 12, interligne 1,15 (modèle du cabinet)
  page1: {
    texteX: 6.2,            // retrait de 3,0 cm + marge 3,18 cm : jeu de ≥ 3 mm avec le filet vertical (5,86 cm)
    haut: 3.5,              // première ligne (le logo s'arrête à 3,0 cm)
    bas: 27.1,              // dernière ligne (la barre du bas commence à 28,94 cm)
  },
  suivantes: { texteX: 3.175, haut: 2.54, bas: 27.2 },
  droiteX: 10.3,            // colonne de droite (date, « À l'attention de », signature)
  margeDroite: 3.2,         // le texte s'arrête à 17,8 cm
  numero: { y: 28.1 },      // « n/N » au-dessus de la barre du bas
  papier: {
    filetX: 5.86, filetY: [6.6, 23.0],
    logo: { x: 1.3, y: 1.15, l: 4.3, h: 1.9 },
    coordonnees: { x: [0.6, 5.1], y: [24.5, 27.4] },
    barre: { y: [28.94, 29.68], coupure: 6.1 },
    decor: { x: [13.6, 21.0], y: [19.8, 28.7] },
  },
  cachet: { largeur: 5.4 }, // largeur du cachet à 100 %
};

const bordDroit = () => MESURES.page.largeur - MESURES.margeDroite;

module.exports = { MESURES, CM_PT, pt, bordDroit };
