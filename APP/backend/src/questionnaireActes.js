// JURIA — questionnaire d'un modèle d'acte (28/10/2026).
//
// Un modèle déclare ses champs (modeles_actes.champs, JSONB) :
//   { cle, libelle, type, requis?, defaut?, defaut_balise?, options?, sous_champs?, si?, aide? }
// types : texte | texte_long | date | choix | oui_non | nombre | juridiction | montant | liste | calcul
//  - choix : options = [{ valeur, libelle }] ; balises « cle » (valeur) et « cle_libelle »
//  - date : AAAA-MM-JJ (ou JJ/MM/AAAA pour une valeur par défaut tirée d'une balise) ;
//           balises « cle » (« 14 décembre 1985 ») et « cle_iso »
//  - juridiction : code de listes_valeurs('juridiction') ; balises « cle » (libellé) et « cle_code »
//  - montant : { valeur, devise: XOF|EUR|autre, contrevaleur? } ; balises « cle_phrase »
//    (« EUR 3 743 146 (Trois Millions … Euros), soit F.CFA 2 455 342 732 (… Francs CFA) »),
//    « cle_chiffres », « cle_lettres », « cle_fcfa », « cle_fcfa_lettres »
//  - liste : éléments { sous_champs } (types texte | date | pieces) ; le sous-champ « pieces »
//    (une pièce par ligne) est numéroté en continu sur tout l'acte et alimente aussi le bordereau ;
//    chaque élément reçoit « pieces_texte » (« Pièce N°1 : … ») et « pieces_refs » (« n° 1, n° 2 »)
//  - montant : « devise_fixe: "XOF" » impose la devise (champ utilisé dans un calcul) ;
//  - calcul : montant en F CFA calculé, sans saisie : { formule: "enfants_nombre*(pension+complement)" } — + - * /
//    et parenthèses sur des champs « nombre » ou « montant », sur « liste_nombre » ou sur un autre calcul
//    (un champ absent vaut 0 ; à placer après les champs qu'il utilise) ; mêmes balises qu'un montant ;
//  - sous-champs d'une liste : texte | date | pieces | choix (options { valeur, libelle } ; balises « cle » et « cle_libelle ») ;
//  - si : « autre_cle=valeur » — le champ n'est demandé (et requis) que si la condition est vraie.
// Les clés ne doivent pas entrer en collision avec une balise du catalogue (balisesActes.js).

const { montantEnLettres } = require("./nombreEnLettres");
const { dateLongue, BALISES } = require("./balisesActes");

const TYPES = ["texte", "texte_long", "date", "choix", "oui_non", "nombre", "juridiction", "montant", "liste", "calcul"];
const TYPES_SOUS_CHAMP = ["texte", "date", "pieces", "choix"];
const TAUX_EURO_XOF = 655.957;       // parité fixe (règle du projet)
const CLE = /^[a-z][a-z0-9_]{0,40}$/;
const RESERVEES = new Set(BALISES.map((b) => b.cle));

function erreur(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

// Évaluateur arithmétique minimal (+ - * / parenthèses, nombres, identifiants) — pas d'eval.
// valeur(nom) donne la valeur numérique d'un identifiant.
function evaluerFormule(formule, valeur) {
  const jetons = formule.match(/\s*([A-Za-z_]\w*|\d+(?:\.\d+)?|[()+\-*/])/g);
  if (!jetons || jetons.join("").replace(/\s/g, "") !== formule.replace(/\s/g, "")) throw new Error("caractère non autorisé");
  const t = jetons.map((j) => j.trim());
  let i = 0;
  const facteur = () => {
    const j = t[i++];
    if (j === undefined) throw new Error("expression incomplète");
    if (j === "(") { const v = expression(); if (t[i++] !== ")") throw new Error("parenthèse non fermée"); return v; }
    if (j === "-") return -facteur();
    if (/^\d/.test(j)) return Number(j);
    if (/^[A-Za-z_]/.test(j)) return Number(valeur(j)) || 0;
    throw new Error(`« ${j} » inattendu`);
  };
  const terme = () => {
    let v = facteur();
    while (t[i] === "*" || t[i] === "/") {
      const op = t[i++];
      const d = facteur();
      if (op === "/" && d === 0) throw new Error("division par zéro");
      v = op === "*" ? v * d : v / d;
    }
    return v;
  };
  function expression() {
    let v = terme();
    while (t[i] === "+" || t[i] === "-") v = t[i++] === "+" ? v + terme() : v - terme();
    return v;
  }
  const resultat = expression();
  if (i !== t.length) throw new Error(`« ${t[i]} » inattendu`);
  return resultat;
}

// Valide la définition des champs d'un modèle à l'enregistrement.
function validerDefinition(champs) {
  if (!Array.isArray(champs)) throw erreur("champs : une liste est attendue");
  if (champs.length > 40) throw erreur("champs : 40 champs au plus");
  const vues = new Set();
  for (const c of champs) {
    if (!c || typeof c !== "object") throw erreur("champs : définition invalide");
    if (!CLE.test(c.cle || "")) throw erreur(`champs : clé « ${c.cle} » invalide (minuscules, chiffres et _ ; 41 caractères au plus)`);
    if (RESERVEES.has(c.cle)) throw erreur(`champs : la clé « ${c.cle} » est déjà une balise de JURIA`);
    if (vues.has(c.cle)) throw erreur(`champs : clé « ${c.cle} » en double`);
    vues.add(c.cle);
    if (!c.libelle || typeof c.libelle !== "string") throw erreur(`champs : « ${c.cle} » sans libellé`);
    if (!TYPES.includes(c.type)) throw erreur(`champs : type « ${c.type} » inconnu pour « ${c.cle} »`);
    if (c.type === "choix" && (!Array.isArray(c.options) || !c.options.length || c.options.some((o) => !o || !o.valeur || !o.libelle))) {
      throw erreur(`champs : « ${c.cle} » (choix) demande des options { valeur, libelle }`);
    }
    if (c.type === "liste") {
      if (!Array.isArray(c.sous_champs) || !c.sous_champs.length) throw erreur(`champs : « ${c.cle} » (liste) demande des sous_champs`);
      for (const s of c.sous_champs) {
        if (!CLE.test(s.cle || "") || !s.libelle || !TYPES_SOUS_CHAMP.includes(s.type)) throw erreur(`champs : sous-champ invalide dans « ${c.cle} »`);
        if (s.type === "choix" && (!Array.isArray(s.options) || !s.options.length || s.options.some((o) => !o || !o.valeur || !o.libelle))) {
          throw erreur(`champs : le sous-champ « ${s.cle} » (choix) demande des options { valeur, libelle }`);
        }
      }
    }
    if (c.type === "calcul") {
      if (typeof c.formule !== "string") throw erreur(`champs : « ${c.cle} » (calcul) demande une formule`);
      try { evaluerFormule(c.formule, () => 1); } catch (e) { throw erreur(`champs : formule de « ${c.cle} » invalide (${e.message})`); }
    }
    if (c.devise_fixe !== undefined && !["XOF", "EUR"].includes(c.devise_fixe)) throw erreur(`champs : devise_fixe de « ${c.cle} » : XOF ou EUR`);
    if (c.si !== undefined && !/^\w+\s*(!=|=)\s*.+$/.test(c.si)) throw erreur(`champs : condition « si » invalide pour « ${c.cle} »`);
  }
  return champs;
}

function milliers(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function versIso(texte) {
  const t = String(texte || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function conditionVraie(si, valeurs) {
  if (!si) return true;
  const m = /^(\w+)\s*(!=|=)\s*(.+)$/.exec(si);
  const egal = String(valeurs[m[1]] ?? "") === m[3].trim();
  return m[2] === "=" ? egal : !egal;
}

function traiterMontant(c, brut) {
  const valeur = Number(String((brut && brut.valeur) ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(valeur) || valeur <= 0) throw erreur(`« ${c.libelle} » : montant invalide`);
  const devise = c.devise_fixe || (brut && brut.devise) || "XOF";
  if (!["XOF", "EUR", "autre"].includes(devise)) throw erreur(`« ${c.libelle} » : devise invalide`);
  const libelleDevise = devise === "XOF" ? "F.CFA" : devise === "EUR" ? "EUR" : String((brut && brut.devise_libelle) || "").trim();
  if (devise === "autre" && !libelleDevise) throw erreur(`« ${c.libelle} » : précisez la devise`);
  let fcfa = valeur;
  if (devise === "EUR") fcfa = Math.round(valeur * TAUX_EURO_XOF);
  if (devise === "autre") {
    fcfa = Number(String((brut && brut.contrevaleur) ?? "").replace(/\s/g, "").replace(",", "."));
    if (!Number.isFinite(fcfa) || fcfa <= 0) throw erreur(`« ${c.libelle} » : contre-valeur en F.CFA requise pour cette devise`);
  }
  const lettresDevise = devise === "XOF" ? "XOF" : devise === "EUR" ? "EUR" : libelleDevise;
  const chiffres = `${libelleDevise} ${milliers(valeur)}`;
  const lettres = montantEnLettres(valeur, lettresDevise);
  const fcfaChiffres = `F.CFA ${milliers(fcfa)}`;
  const fcfaLettres = montantEnLettres(fcfa, "XOF");
  return {
    __n: valeur,
    [`${c.cle}_chiffres`]: chiffres,
    [`${c.cle}_lettres`]: lettres,
    [`${c.cle}_fcfa`]: fcfaChiffres,
    [`${c.cle}_fcfa_lettres`]: fcfaLettres,
    [c.cle]: chiffres,
    [`${c.cle}_phrase`]: devise === "XOF" ? `${chiffres} (${lettres})` : `${chiffres} (${lettres}), soit ${fcfaChiffres} (${fcfaLettres})`,
  };
}

// reponses : objet saisi à l'écran ; plat : balises déjà calculées (valeurs par défaut) ;
// juridictions : { code: libellé } (listes_valeurs). Renvoie { valeurs, pieces }.
function traiterReponses(champs, reponses, plat, juridictions) {
  const rep = reponses && typeof reponses === "object" ? reponses : {};
  const valeurs = {};
  const pieces = [];
  const numeriques = {};   // valeurs numériques disponibles pour les champs « calcul »
  for (const c of champs) {
    const demande = conditionVraie(c.si, valeurs);
    let brut = rep[c.cle];
    if ((brut === undefined || brut === null || brut === "") && demande) {
      if (c.defaut !== undefined) brut = c.defaut;
      else if (c.defaut_balise && plat[c.defaut_balise] && plat[c.defaut_balise] !== "[à compléter]") brut = plat[c.defaut_balise];
    }
    if (c.type === "calcul") {
      if (!demande) { valeurs[c.cle] = ""; continue; }
      const resultat = evaluerFormule(c.formule, (nom) => numeriques[nom]);
      if (!Number.isFinite(resultat) || resultat <= 0) { valeurs[c.cle] = ""; numeriques[c.cle] = 0; continue; }
      const { __n, ...balises } = traiterMontant({ ...c, devise_fixe: "XOF" }, { valeur: resultat, devise: "XOF" });
      Object.assign(valeurs, balises);
      numeriques[c.cle] = resultat;
      continue;
    }
    const vide = brut === undefined || brut === null || brut === "" || (Array.isArray(brut) && !brut.length);
    if (!demande || vide) {
      if (demande && c.requis) throw erreur(`« ${c.libelle} » est requis`);
      if (c.type === "liste") { valeurs[c.cle] = []; valeurs[`${c.cle}_nombre`] = "0"; numeriques[`${c.cle}_nombre`] = 0; }
      else if (c.type === "montant" || c.type === "nombre") { valeurs[c.cle] = ""; numeriques[c.cle] = 0; }
      else if (c.type === "oui_non") valeurs[c.cle] = "non";
      else valeurs[c.cle] = "";
      continue;
    }
    switch (c.type) {
      case "texte":
      case "texte_long": {
        const t = String(brut).trim();
        if (t.length > 4000) throw erreur(`« ${c.libelle} » : 4000 caractères au plus`);
        valeurs[c.cle] = t;
        break;
      }
      case "date": {
        const iso = versIso(brut);
        if (!iso) throw erreur(`« ${c.libelle} » : date invalide (AAAA-MM-JJ attendu)`);
        valeurs[c.cle] = dateLongue(iso);
        valeurs[`${c.cle}_iso`] = iso;
        break;
      }
      case "choix": {
        const o = c.options.find((x) => x.valeur === String(brut));
        if (!o) throw erreur(`« ${c.libelle} » : choix invalide`);
        valeurs[c.cle] = o.valeur;
        valeurs[`${c.cle}_libelle`] = o.libelle;
        break;
      }
      case "oui_non":
        valeurs[c.cle] = brut === true || String(brut).toLowerCase() === "oui" ? "oui" : "non";
        break;
      case "nombre": {
        const n = Number(String(brut).replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(n)) throw erreur(`« ${c.libelle} » : nombre invalide`);
        valeurs[c.cle] = String(n);
        numeriques[c.cle] = n;
        break;
      }
      case "juridiction": {
        const libelle = juridictions && juridictions[String(brut)];
        if (!libelle) throw erreur(`« ${c.libelle} » : juridiction inconnue`);
        valeurs[c.cle] = libelle;
        valeurs[`${c.cle}_code`] = String(brut);
        break;
      }
      case "montant": {
        const { __n, ...balises } = traiterMontant(c, brut);
        Object.assign(valeurs, balises);
        numeriques[c.cle] = __n;
        break;
      }
      case "liste": {
        if (!Array.isArray(brut) || brut.length > 60) throw erreur(`« ${c.libelle} » : liste invalide (60 éléments au plus)`);
        valeurs[c.cle] = brut.map((el) => {
          const item = {};
          const piecesItem = [];
          for (const s of c.sous_champs) {
            const v = el && el[s.cle] !== undefined && el[s.cle] !== null ? el[s.cle] : "";
            if (s.type === "pieces") {
              const lignes = (Array.isArray(v) ? v : String(v).split("\n")).map((l) => String(l).trim()).filter(Boolean);
              for (const intitule of lignes) { pieces.push(intitule); piecesItem.push({ n: pieces.length, intitule }); }
            } else if (s.type === "choix") {
              const o = v === "" ? null : s.options.find((x) => x.valeur === String(v));
              if (v !== "" && !o) throw erreur(`« ${c.libelle} » : choix invalide pour « ${s.libelle} »`);
              item[s.cle] = o ? o.valeur : "";
              item[`${s.cle}_libelle`] = o ? o.libelle : "";
            } else if (s.type === "date") {
              const iso = v === "" ? "" : versIso(v);
              if (v !== "" && !iso) throw erreur(`« ${c.libelle} » : date invalide (AAAA-MM-JJ attendu)`);
              item[s.cle] = iso ? dateLongue(iso) : "";
              item[`${s.cle}_iso`] = iso || "";
            } else {
              const t = String(v).trim();
              if (t.length > 4000) throw erreur(`« ${c.libelle} » : 4000 caractères au plus par champ`);
              item[s.cle] = t;
            }
          }
          item.pieces_texte = piecesItem.map((p) => `Pièce N°${p.n} : ${p.intitule}`).join("\n");
          item.pieces_refs = piecesItem.map((p) => `n° ${p.n}`).join(", ");
          return item;
        });
        valeurs[`${c.cle}_nombre`] = String(valeurs[c.cle].length);
        numeriques[`${c.cle}_nombre`] = valeurs[c.cle].length;
        break;
      }
    }
  }
  return { valeurs, pieces };
}

module.exports = { validerDefinition, traiterReponses, evaluerFormule, TYPES, TAUX_EURO_XOF };
