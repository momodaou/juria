// JURIA — saisie des numéros de vignettes de plaidoirie (16/10/2026).
// Un numéro = exactement 7 chiffres (zéros initiaux possibles, stocké en
// entier). Les lots achetés ne sont pas forcément continus : on accepte une
// liste de numéros isolés et/ou de plages, ex. "1000200-1000204, 1000300".
const NB_CHIFFRES = 7;
const MAX_PAR_ACHAT = 5000;

function parserNumeros(texte) {
  const jetons = String(texte).split(/[\s,;]+/).filter(Boolean);
  if (!jetons.length) return { erreur: "Aucun numéro saisi." };
  const re = new RegExp(`^\\d{${NB_CHIFFRES}}$`);
  const vus = new Set();
  for (const j of jetons) {
    const [a, b, ...reste] = j.split("-");
    if (reste.length || !re.test(a) || (b !== undefined && !re.test(b))) {
      return { erreur: `« ${j} » invalide : chaque numéro doit avoir exactement ${NB_CHIFFRES} chiffres (plage : début-fin).` };
    }
    const debut = Number(a);
    const fin = b === undefined ? debut : Number(b);
    if (fin < debut) return { erreur: `Plage « ${j} » : la fin est inférieure au début.` };
    if (vus.size + (fin - debut + 1) > MAX_PAR_ACHAT) {
      return { erreur: `Trop de numéros dans un seul achat (maximum ${MAX_PAR_ACHAT}).` };
    }
    for (let n = debut; n <= fin; n++) {
      if (vus.has(n)) return { erreur: `Le numéro ${String(n).padStart(NB_CHIFFRES, "0")} est saisi deux fois.` };
      vus.add(n);
    }
  }
  return { numeros: [...vus].sort((x, y) => x - y) };
}

module.exports = { parserNumeros, NB_CHIFFRES };
