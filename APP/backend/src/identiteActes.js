// JURIA — identité détaillée des parties pour les actes (27/10/2026).
//
// Champs facultatifs portés par `clients` et `dossier_parties` (voir le bloc
// « IDENTITÉ DÉTAILLÉE POUR LES ACTES » de schema.sql). Ce module factorise :
//  - la liste des champs et leur type, pour les écritures (POST/PUT) ;
//  - la construction d'un SET dynamique : un champ absent du corps n'est pas
//    touché, un champ envoyé vide ('') est effacé (NULL) — contrairement au
//    motif COALESCE des autres champs, qui ne permet jamais de vider.

const TYPES = { texte: "text", date: "date" };

const CHAMPS_CLIENT = [
  ["civilite", "texte"], ["date_naissance", "date"], ["lieu_naissance", "texte"], ["pere", "texte"],
  ["mere", "texte"], ["profession", "texte"], ["capital_social", "texte"], ["rccm_date", "date"],
  ["representant_nom", "texte"], ["representant_qualite", "texte"], ["boite_postale", "texte"],
  ["droit_applicable", "texte"],
];

const CHAMPS_PARTIE = [
  ["type_partie", "texte"], ["civilite", "texte"], ["date_naissance", "date"], ["lieu_naissance", "texte"],
  ["pere", "texte"], ["mere", "texte"], ["profession", "texte"], ["nationalite", "texte"], ["adresse", "texte"],
  ["boite_postale", "texte"], ["forme_juridique", "texte"], ["rccm", "texte"], ["rccm_date", "date"],
  ["capital_social", "texte"], ["representant_nom", "texte"], ["representant_qualite", "texte"],
  ["droit_applicable", "texte"], ["conseil_adresse", "texte"],
];

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

// Renvoie { sets: ["col = NULLIF($n::text,'')::date", ...], params: [...] } pour les seuls champs présents
// dans le corps ; premierIndice = numéro du premier paramètre libre ($n).
function clausesMaj(corps, champs, premierIndice) {
  const sets = [];
  const params = [];
  for (const [col, type] of champs) {
    if (!Object.prototype.hasOwnProperty.call(corps, col) || corps[col] === undefined) continue;
    const valeur = corps[col] === null ? "" : String(corps[col]).trim();
    if (type === "date" && valeur && !DATE_ISO.test(valeur)) {
      const err = new Error(`${col} : date invalide (AAAA-MM-JJ attendu)`);
      err.status = 400;
      throw err;
    }
    params.push(valeur);
    const i = premierIndice + params.length - 1;
    sets.push(type === "date" ? `${col} = NULLIF($${i}::text,'')::date` : `${col} = NULLIF($${i}::text,'')`);
  }
  return { sets, params };
}

// Colonnes à sélectionner : les dates en texte AAAA-MM-JJ (pas de décalage de fuseau à la sérialisation JSON).
function selectChamps(champs, alias = "", prefixe = "") {
  const p = alias ? `${alias}.` : "";
  return champs
    .map(([col, type]) => {
      const expr = type === "date" ? `to_char(${p}${col}, 'YYYY-MM-DD')` : `${p}${col}`;
      return expr === `${col}` && !prefixe ? col : `${expr} AS ${prefixe}${col}`;
    })
    .join(", ");
}

module.exports = { CHAMPS_CLIENT, CHAMPS_PARTIE, clausesMaj, selectChamps, TYPES };
