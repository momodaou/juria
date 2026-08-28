// JURIA — Conversion d'un montant en toutes lettres (français), pour
// l'« Arrêtée la présente facture à la somme de … » attendu sur une note
// d'honoraires (diagnostic Facturation, 28/08/2026 — voir facturePdf.js et
// le modèle de note d'honoraires fourni par l'utilisateur en référence).
//
// Règles orthographiques françaises traditionnelles suivies (celles du
// modèle de référence) :
//  - « quatre-vingts » prend un s seul, jamais suivi d'un autre nombre
//    (quatre-vingt-un, quatre-vingt-deux…) ;
//  - « cent » prend un s uniquement multiplié ET non suivi d'un autre
//    nombre (deux cents, mais deux cent trente) ;
//  - « mille » est invariable et ne prend jamais de « un » devant
//    (mille, deux mille — jamais un mille) ;
//  - « et » uniquement devant un/onze des dizaines 20-60 (vingt-et-un,
//    soixante-et-onze), jamais après quatre-vingt.
const UNITES = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf",
];
const DIZAINES = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante" };

function deuxChiffres(n) {
  if (n < 20) return UNITES[n];
  const d = Math.floor(n / 10);
  const u = n % 10;
  if (d === 7) return u === 1 ? "soixante et onze" : "soixante-" + UNITES[10 + u]; // 70-79
  if (d === 9) return "quatre-vingt-" + UNITES[10 + u]; // 90-99
  if (d === 8) return u === 0 ? "quatre-vingts" : "quatre-vingt-" + UNITES[u]; // 80-89
  const base = DIZAINES[d];
  if (u === 0) return base;
  if (u === 1) return base + " et un";
  return base + "-" + UNITES[u];
}

function troisChiffres(n) {
  const c = Math.floor(n / 100);
  const reste = n % 100;
  const mots = [];
  if (c > 0) mots.push(c === 1 ? "cent" : UNITES[c] + " cent" + (reste === 0 ? "s" : ""));
  if (reste > 0) mots.push(deuxChiffres(reste));
  return mots.join(" ");
}

const GROUPES = [
  { valeur: 1_000_000_000, nom: "milliard" },
  { valeur: 1_000_000, nom: "million" },
  { valeur: 1_000, nom: "mille" },
];

// Nombre entier positif -> toutes lettres, en minuscules (ex. 27397306 ->
// "vingt-sept millions trois cent quatre-vingt-dix-sept mille trois cent
// six").
function nombreEnLettres(n) {
  n = Math.round(Math.abs(Number(n) || 0));
  if (n === 0) return "zéro";
  let reste = n;
  const parties = [];
  for (const g of GROUPES) {
    const q = Math.floor(reste / g.valeur);
    if (q > 0) {
      if (g.nom === "mille") parties.push(q === 1 ? "mille" : troisChiffres(q) + " mille");
      else parties.push(troisChiffres(q) + " " + (q === 1 ? g.nom : g.nom + "s"));
      reste %= g.valeur;
    }
  }
  if (reste > 0 || parties.length === 0) parties.push(troisChiffres(reste));
  return parties.join(" ").trim();
}

// Met une majuscule après chaque espace ET chaque tiret (style du cabinet,
// cf. modèle de référence : « Vingt-Sept Millions Trois Cent
// Quatre-Vingt-Dix-Sept Mille Trois Cent Six »).
function capitaliserMots(str) {
  return str.replace(/(^|[\s-])([a-zà-ÿ])/g, (m, sep, c) => sep + c.toUpperCase());
}

const LIBELLES_DEVISE = {
  XOF: "Francs CFA",
  EUR: "Euros",
  USD: "Dollars US",
  GBP: "Livres Sterling",
};

// Phrase complète prête à imprimer, ex. « Vingt-Sept Millions Trois Cent
// Quatre-Vingt-Dix-Sept Mille Trois Cent Six Francs CFA ».
function montantEnLettres(montant, devise) {
  const mots = capitaliserMots(nombreEnLettres(montant));
  const libelle = LIBELLES_DEVISE[devise] || devise;
  return `${mots} ${libelle}`;
}

module.exports = { nombreEnLettres, capitaliserMots, montantEnLettres, LIBELLES_DEVISE };
