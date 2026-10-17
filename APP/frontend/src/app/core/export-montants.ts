// JURIA — export Excel/CSV : montants en nombres purs, devise conservée
// (16/10/2026). Une cellule « 1470000 FCFA » est du texte pour Excel ; on la
// transforme en nombre exploitable SANS perdre la devise :
//  - colonne dont tous les montants sont dans la même devise → nombres purs,
//    devise reportée dans l'en-tête (« TTC (FCFA) ») ;
//  - colonnes à devises mélangées → nombres purs + une colonne « Devise »
//    (une seule si toutes ces colonnes partagent la devise de la ligne,
//    comme HT/TTC/Encaissé/Reliquat d'une facture ; sinon une par colonne).
const MONTANT = /^(-?\d+(?:,\d+)?) (FCFA|XOF|EUR|USD|GBP)$/;

export function transformerMontants(lignes: string[][]): string[][] {
  if (lignes.length < 2) return lignes;
  const nbCol = lignes[0].length;
  const regulieres = lignes.map((l, i) => i > 0 && l.length === nbCol);
  // Détection : colonnes où toutes les cellules (corps) sont soit un montant, soit vides/« — ».
  const colonnes: { index: number; unites: Set<string> }[] = [];
  for (let c = 0; c < nbCol; c++) {
    const unites = new Set<string>();
    let montants = 0;
    let autre = false;
    lignes.forEach((l, i) => {
      if (!regulieres[i]) return;
      const v = l[c] ?? '';
      const m = MONTANT.exec(v);
      if (m) { montants++; unites.add(m[2] === 'XOF' ? 'FCFA' : m[2]); }
      else if (v !== '' && v !== '—') autre = true;
    });
    if (montants > 0 && !autre) colonnes.push({ index: c, unites });
  }
  if (!colonnes.length) return lignes;
  const mixtes = colonnes.filter((x) => x.unites.size > 1);
  const uniteCellule = (v: string): string => { const m = MONTANT.exec(v ?? ''); return m ? (m[2] === 'XOF' ? 'FCFA' : m[2]) : ''; };
  // Une seule colonne « Devise » si, ligne par ligne, toutes les colonnes mixtes portent la même devise.
  let devisePartagee = mixtes.length > 1;
  if (devisePartagee) {
    lignes.forEach((l, i) => {
      if (!regulieres[i]) return;
      const us = new Set(mixtes.map((x) => uniteCellule(l[x.index])).filter(Boolean));
      if (us.size > 1) devisePartagee = false;
    });
  }
  const derniereMixte = mixtes.length ? mixtes[mixtes.length - 1].index : -1;
  const resultat = lignes.map((l) => [] as string[]);
  for (let c = 0; c < nbCol; c++) {
    const col = colonnes.find((x) => x.index === c);
    lignes.forEach((l, i) => {
      const v = l[c] ?? '';
      if (!col) { if (c < l.length) resultat[i].push(v); }
      else {
        const unique = col.unites.size === 1 ? Array.from(col.unites)[0] : null;
        if (i === 0) {
          // L'unité entre dans l'en-tête, sauf si l'en-tête la mentionne déjà.
          resultat[i].push(unique && !v.includes(unique) ? `${v} (${unique})` : v);
          if (!unique && !devisePartagee) resultat[i].push('Devise');
        } else if (!regulieres[i]) {
          resultat[i].push(v);
        } else {
          const m = MONTANT.exec(v);
          resultat[i].push(m ? m[1] : v);
          if (!unique && !devisePartagee) resultat[i].push(uniteCellule(v));
        }
      }
      if (devisePartagee && c === derniereMixte) {
        if (i === 0) resultat[i].push('Devise');
        else if (regulieres[i]) resultat[i].push(mixtes.map((x) => uniteCellule(l[x.index])).find(Boolean) ?? '');
      }
    });
  }
  return resultat;
}
