// JURIA — moteur des modèles d'actes (28/10/2026).
//
// Étend la simple substitution {{cle}} de l'Atelier d'actes avec :
//   {{#si cle}} … {{#sinon}} … {{/si}}      bloc conditionnel (« sinon » facultatif)
//   {{#si cle=valeur}}, {{#si cle!=valeur}}  comparaison avec une valeur littérale
//   {{#chaque liste}} … {{/chaque}}          bloc répété pour chaque élément d'une liste
//   {{@n}}                                   dans un « chaque » : rang de l'élément (1, 2, …)
// Les blocs peuvent s'imbriquer. Une balise de bloc seule sur sa ligne disparaît avec son
// saut de ligne (le texte généré ne garde pas de lignes vides parasites). Une balise
// {{cle}} inconnue reste visible dans le texte plutôt que d'être silencieusement vidée
// (comportement historique de l'Atelier, utile à l'auteur du modèle).
//
// Pur : aucune lecture de base, aucun effet de bord.

const BLOC = /\{\{\s*(#si\s+[^}]+|#sinon|\/si|#chaque\s+[^}]+|\/chaque)\s*\}\}/;
const LIGNE_BLOC = /^[ \t]*(\{\{\s*(?:#si\s+[^}]+|#sinon|\/si|#chaque\s+[^}]+|\/chaque)\s*\}\})[ \t]*\r?\n/gm;
const VARIABLE = /\{\{\s*(@?\w+)\s*\}\}/g;

function erreur(message) {
  const e = new Error(`Modèle invalide : ${message}`);
  e.status = 400;
  return e;
}

// Analyse le corps en arbre ; lève une erreur (400) si les blocs sont mal fermés ou mal imbriqués.
function analyser(corps) {
  const source = String(corps).replace(LIGNE_BLOC, "$1");
  const racine = { type: "racine", enfants: [] };
  const pile = [racine];
  let reste = source;
  while (reste.length) {
    const m = BLOC.exec(reste);
    const courant = pile[pile.length - 1];
    const cible = courant.type === "si" && courant.dansSinon ? courant.sinon : courant.enfants;
    if (!m) { cible.push({ type: "texte", valeur: reste }); break; }
    if (m.index > 0) cible.push({ type: "texte", valeur: reste.slice(0, m.index) });
    const balise = m[1].trim();
    reste = reste.slice(m.index + m[0].length);
    if (balise.startsWith("#si ")) {
      const noeud = { type: "si", condition: balise.slice(4).trim(), enfants: [], sinon: [], dansSinon: false };
      cible.push(noeud);
      pile.push(noeud);
    } else if (balise === "#sinon") {
      if (courant.type !== "si" || courant.dansSinon) throw erreur("« {{#sinon}} » en dehors d'un « {{#si}} », ou en double");
      courant.dansSinon = true;
    } else if (balise === "/si") {
      if (courant.type !== "si") throw erreur("« {{/si}} » sans « {{#si}} » correspondant");
      pile.pop();
    } else if (balise.startsWith("#chaque ")) {
      const noeud = { type: "chaque", liste: balise.slice(8).trim(), enfants: [] };
      cible.push(noeud);
      pile.push(noeud);
    } else if (balise === "/chaque") {
      if (courant.type !== "chaque") throw erreur("« {{/chaque}} » sans « {{#chaque}} » correspondant");
      pile.pop();
    }
  }
  if (pile.length > 1) {
    const ouvert = pile[pile.length - 1];
    throw erreur(`bloc « ${ouvert.type === "si" ? "{{#si " + ouvert.condition : "{{#chaque " + ouvert.liste}}} » non fermé`);
  }
  return racine;
}

const FAUX = new Set(["", "non", "false", "faux", "0", "[à compléter]"]);

function vrai(valeur) {
  if (valeur === undefined || valeur === null) return false;
  if (Array.isArray(valeur)) return valeur.length > 0;
  if (typeof valeur === "boolean") return valeur;
  if (typeof valeur === "number") return valeur !== 0;
  return !FAUX.has(String(valeur).trim().toLowerCase());
}

function evaluer(condition, portee) {
  let m = /^(\w+)\s*!=\s*(.+)$/.exec(condition);
  if (m) return String(portee[m[1]] ?? "") !== m[2].trim();
  m = /^(\w+)\s*=\s*(.+)$/.exec(condition);
  if (m) return String(portee[m[1]] ?? "") === m[2].trim();
  return vrai(portee[condition]);
}

function rendreNoeuds(noeuds, portee) {
  let sortie = "";
  for (const n of noeuds) {
    if (n.type === "texte") {
      sortie += n.valeur.replace(VARIABLE, (brut, cle) => (cle in portee && portee[cle] !== undefined && portee[cle] !== null ? String(portee[cle]) : brut));
    } else if (n.type === "si") {
      sortie += rendreNoeuds(evaluer(n.condition, portee) ? n.enfants : n.sinon, portee);
    } else if (n.type === "chaque") {
      const liste = Array.isArray(portee[n.liste]) ? portee[n.liste] : [];
      liste.forEach((element, i) => {
        const item = element && typeof element === "object" ? element : { valeur: element };
        sortie += rendreNoeuds(n.enfants, { ...portee, ...item, "@n": i + 1 });
      });
    }
  }
  return sortie;
}

function rendre(corps, portee) {
  return rendreNoeuds(analyser(corps).enfants, portee || {});
}

module.exports = { analyser, rendre, vrai };
