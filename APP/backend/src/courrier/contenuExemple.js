// JURIA — jeux de contenu d'essai du générateur de courriers (lot 0) : reprennent les deux lettres types du cabinet
// (« Lettre - Correpondance modèle standard » et « Lettre de constitution Standard »).
// Le balisage **gras** met un passage en gras dans les paragraphes.
const NREF = "DEP-2026-000046";

const standard = {
  date: "Bamako, le 5 novembre 2026",
  destinataire: ["Monsieur le Directeur", "du Recouvrement", "de la BDM SA"],
  ville: "BAMAKO",
  nref: NREF,
  affaire: "BDM SA c/ PREMIUM INTERNATIONAL MINING COMPANY",
  objet: "Constitution aux fins de recouvrement de créance",
  precision: "(Transmission de note d'honoraires)",
  appel: "Monsieur le Directeur,",
  paragraphes: [
    "Nous accusons bonne réception de votre courrier en date du **3 novembre 2026** référencé **000230**, par lequel vous nous constituez aux fins du recouvrement de votre créance d'un montant de **FCFA 1 238 635 841** (Un Milliard Deux Cent Trente-Huit Millions Six Cent Trente-Cinq Mille Huit Cent Quarante-Et-Un) à l'encontre de la Société **PREMIUM INTERNATIONAL MINING COMPANY**.",
    "Pour y faire suite, nous allons prendre dès à présent les dispositions nécessaires afin d'engager, après les formalités d'usage de mise en demeure, les actions requises en vue du recouvrement de la totalité de cette créance.",
    "À cet effet, et conformément à l'article 7.1 de la Convention d'assistance juridique et judiciaire conclue le **1er août 2023**, nous vous prions de bien vouloir trouver sous ce pli, pour votre aimable règlement, notre note d'honoraires d'un montant de **FCFA 18 579 538 HT** (Dix-Huit Millions Cinq Cent Soixante-Dix-Neuf Mille Cinq Cent Trente-Huit Francs CFA Hors Taxes), à titre d'avance de 30 % sur nos honoraires de résultat fixés à 5 % du montant de la créance, exigible à l'ouverture du dossier.",
    "Conformément à l'article 5 de ladite Convention, nous ne manquerons pas de vous tenir régulièrement informés du déroulement de la procédure.",
    "Nous restons à votre entière disposition pour tout complément d'information.",
  ],
  politesse: "Dans cette attente, nous vous prions d'agréer, Monsieur le Directeur, l'expression de nos salutations distinguées.",
  signature: { bloc: "psc", nom: "Mahamane DJITEYE", qualite: "Avocat au Barreau du Mali" },
  pj: "Note d'honoraires N°....... du 5 novembre 2026",
};

// Version courte (tient sur une page) : sert à vérifier l'absence de numérotation « n/N ».
const courte = {
  ...standard,
  paragraphes: standard.paragraphes.slice(3),
  pj: "",
};

const constitution = {
  date: "Bamako, le 5 novembre 2026",
  destinataire: ["Monsieur le Président", "du Tribunal de Grande Instance", "de la Commune VI du District de Bamako"],
  ville: "",
  nref: NREF,
  affaire: "Hawa F. COULIBALY c/ XXXXXXXXXX",
  objet: "Lettre de constitution",
  precision: "",
  motif: "Rectification d'état civil (précision du prénom « Fassoum » en lieu et place de « F. »)",
  appel: "Monsieur le Président,",
  paragraphes: [
    "Nous avons l'honneur par la présente, de vous informer de notre constitution pour la défense des intérêts de Mme Hawa F. COULIBALY.",
    "Afin de nous permettre de pourvoir, au mieux, à la sauvegarde et à la défense desdits intérêts, qu'il vous plaise, Monsieur le Président, nous associer aux suites de la procédure et nous faire notifier les dates d'audience.",
  ],
  politesse: "Comptant sur votre compréhension habituelle, veuillez recevoir, Monsieur le Président, l'expression de notre profond respect.",
  signature: { bloc: "con", nom: "Mohamed DAOU", qualite: "Avocat aux Barreaux du Mali & de Paris" },
  pj: "",
};

module.exports = { standard, courte, constitution };
