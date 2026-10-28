// JURIA — balises des modèles d'actes (Atelier d'actes, 27/10/2026).
//
// Catalogue unique des balises {{cle}} disponibles dans le corps d'un modèle :
// il alimente l'aide affichée à l'écran (GET /api/actes/balises) ET sert de
// référence au test qui vérifie que chaque balise annoncée est bien fournie
// par applatirContexte() (actes.js). Ajouter une balise = une ligne ici + la
// valeur dans applatirContexte().
//
// Convention : une donnée d'identité manquante apparaît « [à compléter] »
// dans l'acte généré (visible et corrigible), jamais vide ni silencieusement
// omise — un acte de procédure avec une identité incomplète doit se voir.

const A_COMPLETER = "[à compléter]";

const BALISES = [
  // Dossier
  { cle: "dossier_numero", groupe: "Dossier", description: "Référence du dossier" },
  { cle: "dossier_intitule", groupe: "Dossier", description: "Intitulé du dossier" },
  { cle: "dossier_objet", groupe: "Dossier", description: "Objet du dossier" },
  { cle: "dossier_objet_ou_intitule", groupe: "Dossier", description: "Objet, ou à défaut l'intitulé" },
  { cle: "dossier_juridiction", groupe: "Dossier", description: "Juridiction du dossier" },
  { cle: "dossier_pole", groupe: "Dossier", description: "Pôle (conseil ou contentieux)" },
  { cle: "dossier_montant_litige", groupe: "Dossier", description: "Montant du litige (FCFA)" },
  { cle: "dossier_date_ouverture", groupe: "Dossier", description: "Date d'ouverture du dossier" },
  { cle: "dossier_responsable", groupe: "Dossier", description: "Avocat responsable du dossier" },
  { cle: "dossier_mode_honoraires", groupe: "Dossier", description: "Mode d'honoraires" },
  { cle: "dossier_montant_convenu", groupe: "Dossier", description: "Montant d'honoraires convenu" },
  // Client
  { cle: "client", groupe: "Client", description: "Nom ou dénomination du client" },
  { cle: "client_type", groupe: "Client", description: "Personne morale ou personne physique" },
  { cle: "client_forme_juridique", groupe: "Client", description: "Forme juridique (personne morale)" },
  { cle: "client_rccm", groupe: "Client", description: "N° RCCM" },
  { cle: "client_nif", groupe: "Client", description: "NIF" },
  { cle: "client_adresse", groupe: "Client", description: "Adresse" },
  { cle: "client_ville", groupe: "Client", description: "Ville" },
  { cle: "client_pays", groupe: "Client", description: "Pays" },
  { cle: "client_nationalite", groupe: "Client", description: "Nationalité (personne physique)" },
  { cle: "client_email", groupe: "Client", description: "E-mail" },
  { cle: "client_telephone", groupe: "Client", description: "Téléphone" },
  { cle: "client_civilite", groupe: "Client", description: "Monsieur / Madame / Mademoiselle" },
  { cle: "client_date_naissance", groupe: "Client", description: "Date de naissance (personne physique)" },
  { cle: "client_lieu_naissance", groupe: "Client", description: "Lieu de naissance" },
  { cle: "client_naissance", groupe: "Client", description: "« né(e) le … à … » accordé selon la civilité" },
  { cle: "client_filiation", groupe: "Client", description: "« fils/fille de … et de … »" },
  { cle: "client_profession", groupe: "Client", description: "Profession" },
  { cle: "client_capital_social", groupe: "Client", description: "Capital social (personne morale)" },
  { cle: "client_representant", groupe: "Client", description: "Représentant légal et sa qualité" },
  { cle: "client_boite_postale", groupe: "Client", description: "Boîte postale" },
  { cle: "client_droit_applicable", groupe: "Client", description: "Droit applicable / immatriculation (société étrangère)" },
  { cle: "client_identification", groupe: "Client", description: "Identité complète en une phrase, telle qu'en tête d'un acte (personne physique ou morale)" },
  // Partie adverse
  { cle: "partie_adverse", groupe: "Partie adverse", description: "Première partie adverse" },
  { cle: "parties_adverses", groupe: "Partie adverse", description: "Toutes les parties adverses, séparées par « et »" },
  { cle: "partie_adverse_identification", groupe: "Partie adverse", description: "Identité complète de la première partie adverse" },
  { cle: "parties_adverses_identification", groupe: "Partie adverse", description: "Identité complète de chaque partie adverse (une par ligne)" },
  { cle: "conseil_adverse", groupe: "Partie adverse", description: "Conseil de la première partie adverse" },
  { cle: "conseil_adverse_adresse", groupe: "Partie adverse", description: "Adresse du conseil de la première partie adverse" },
  { cle: "destinataire", groupe: "Partie adverse", description: "Partie adverse, ou à défaut le client" },
  // Instance et audience
  { cle: "instance_degre", groupe: "Instance", description: "Degré de l'instance en cours (première instance, appel…)" },
  { cle: "instance_juridiction", groupe: "Instance", description: "Juridiction de l'instance en cours" },
  { cle: "instance_numero_role", groupe: "Instance", description: "N° de rôle de l'instance en cours" },
  { cle: "instance_date_debut", groupe: "Instance", description: "Date de début de l'instance en cours" },
  { cle: "client_qualite", groupe: "Instance", description: "Qualité du client dans l'instance (demandeur, appelant, intimé…)" },
  { cle: "audience_prochaine_date", groupe: "Instance", description: "Date de la prochaine audience" },
  { cle: "audience_prochaine_juridiction", groupe: "Instance", description: "Juridiction de la prochaine audience" },
  // Pièces (saisies à la génération)
  { cle: "pieces_liste", groupe: "Pièces", description: "« Pièce n° 1 : … » une par ligne, pour l'exposé" },
  { cle: "bordereau_pieces", groupe: "Pièces", description: "Bordereau numéroté « BORDEREAU DES PIÈCES / 1. … »" },
  { cle: "pieces_nombre", groupe: "Pièces", description: "Nombre de pièces" },
  // Cabinet et rédacteur
  { cle: "date", groupe: "Cabinet", description: "Date du jour" },
  { cle: "avocat", groupe: "Cabinet", description: "Utilisateur qui génère l'acte" },
  { cle: "avocat_titre", groupe: "Cabinet", description: "Titre de l'avocat (Mon compte), ex. Avocat au Barreau du Mali" },
  { cle: "avocat_initiales", groupe: "Cabinet", description: "Code (initiales) de l'avocat, pour les N/Réf." },
  { cle: "avocat_identification", groupe: "Cabinet", description: "Nom et titre de l'avocat" },
  { cle: "cabinet_raison_sociale", groupe: "Cabinet", description: "Raison sociale du cabinet" },
  { cle: "cabinet_forme", groupe: "Cabinet", description: "Forme / qualité du cabinet" },
  { cle: "cabinet_adresse", groupe: "Cabinet", description: "Adresse du cabinet" },
  { cle: "cabinet_telephone", groupe: "Cabinet", description: "Téléphone du cabinet" },
  { cle: "cabinet_email", groupe: "Cabinet", description: "E-mail du cabinet" },
  { cle: "cabinet_rccm", groupe: "Cabinet", description: "RCCM du cabinet" },
  { cle: "cabinet_nif", groupe: "Cabinet", description: "NIF du cabinet" },
  { cle: "cabinet_compte_carpa", groupe: "Cabinet", description: "Compte CARPA du cabinet" },
];

const DEGRES = {
  premiere_instance: "première instance", appel: "appel", cassation: "cassation",
  opposition: "opposition", refere: "référé", execution: "exécution", autre: "autre",
};

// Même table que l'écran (dossier-detail.component.ts, libelleStatutPartie) :
// demandeur/défendeur se relabellisent selon le degré.
const STATUTS_PARTIE = {
  demandeur: { appel: "Appelant", cassation: "Demandeur au pourvoi", opposition: "Demandeur en opposition", default: "Demandeur" },
  defendeur: { appel: "Intimé", cassation: "Défendeur au pourvoi", opposition: "Défendeur en opposition", default: "Défendeur" },
  intervenant_volontaire: { default: "Intervenant volontaire" },
  intervenant_force: { default: "Intervenant forcé" },
  prevenu: { default: "Prévenu" },
  partie_civile: { default: "Partie civile" },
};

function libelleStatutPartie(statut, degre, precision) {
  if (!statut) return "";
  if (statut === "autre") return precision && precision.trim() ? precision.trim() : "Autre";
  const table = STATUTS_PARTIE[statut];
  if (!table) return statut;
  return table[degre || ""] || table.default;
}

function libelleDegre(degre) {
  return degre ? (DEGRES[degre] || degre) : "";
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString("fr-FR") : "";
}

function ou(v) {
  return v && String(v).trim() ? String(v).trim() : A_COMPLETER;
}

function jointureEt(noms) {
  if (noms.length <= 1) return noms[0] || "";
  return `${noms.slice(0, -1).join(", ")} et ${noms[noms.length - 1]}`;
}

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// « 1985-12-14 » -> « 14 décembre 1985 » (« 1er » pour le premier du mois).
function dateLongue(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  const jour = Number(m[3]);
  return `${jour === 1 ? "1er" : jour} ${MOIS[Number(m[2]) - 1]} ${m[1]}`;
}

// « de Berthe » / « d'Étienne » (élision devant voyelle ou h muet).
function de(nom) {
  return /^[aeiouyhâàéèêëîïôûAEIOUYHÂÀÉÈÊËÎÏÔÛ]/.test(nom) ? `d'${nom}` : `de ${nom}`;
}

const nonVide = (x) => x && String(x).trim();

function genre(civilite) {
  if (civilite === "M") return "m";
  if (civilite === "Mme" || civilite === "Mlle") return "f";
  return "";
}

const CIVILITES = { M: "Monsieur", Mme: "Madame", Mlle: "Mademoiselle" };

// « né le … à … » accordé selon la civilité ; « né(e) » quand elle n'est pas renseignée.
function naissance(p) {
  const g = genre(p.civilite);
  const ne = g === "m" ? "né" : g === "f" ? "née" : "né(e)";
  const date = dateLongue(p.date_naissance);
  if (!date && !nonVide(p.lieu_naissance)) return "";
  return `${ne}${date ? ` le ${date}` : ""}${nonVide(p.lieu_naissance) ? ` à ${p.lieu_naissance.trim()}` : ""}`;
}

function filiation(p) {
  const g = genre(p.civilite);
  const fils = g === "m" ? "fils" : g === "f" ? "fille" : "fils/fille";
  const parents = [p.pere, p.mere].filter(nonVide).map((n) => de(n.trim()));
  return parents.length ? `${fils} ${parents.join(" et ")}` : "";
}

function representant(p) {
  if (!nonVide(p.representant_nom)) return "";
  return nonVide(p.representant_qualite) ? `${p.representant_nom.trim()}, ${p.representant_qualite.trim()}` : p.representant_nom.trim();
}

// Identité d'une partie (client ou partie au dossier, mêmes noms de champs) en une
// phrase, telle qu'on l'écrit en tête d'un acte. Seules les rubriques renseignées
// sont reprises (pas de « RCCM [à compléter] » en plein milieu de phrase pour une
// donnée qui n'existe pas) ; ce sont les balises unitaires (client_rccm…) qui
// signalent un manque. p.type : 'morale' | 'physique' | null (inconnu : nom seul si
// aucun détail).
function identification(p) {
  if (!p) return A_COMPLETER;
  const lieu = [p.adresse, nonVide(p.boite_postale) ? `BP ${p.boite_postale.trim()}` : null, p.ville].filter(nonVide).join(", ");
  if (p.type === "morale") {
    const parts = [p.denomination, p.forme_juridique];
    if (nonVide(p.droit_applicable)) parts.push(p.droit_applicable.trim());
    if (nonVide(p.capital_social)) parts.push(`au capital de ${p.capital_social.trim()}`);
    if (nonVide(p.rccm)) {
      parts.push(`immatriculée au RCCM sous le numéro ${p.rccm.trim()}${p.rccm_date ? ` du ${dateLongue(p.rccm_date)}` : ""}`);
    }
    if (nonVide(p.nif)) parts.push(`NIF ${p.nif.trim()}`);
    if (lieu) parts.push(`ayant son siège social à ${lieu}`);
    const rep = representant(p);
    if (rep) parts.push(`représentée par ${rep}`);
    return parts.filter(nonVide).join(", ");
  }
  const nom = p.denomination || [p.prenom, p.nom].filter(nonVide).join(" ");
  const g = genre(p.civilite);
  const domicilie = g === "m" ? "domicilié" : g === "f" ? "domiciliée" : "domicilié(e)";
  const parts = [[CIVILITES[p.civilite], nom].filter(nonVide).join(" ")];
  if (nonVide(p.profession)) parts.push(p.profession.trim());
  const nais = naissance(p);
  if (nais) parts.push(nais);
  const fil = filiation(p);
  if (fil) parts.push(fil);
  if (nonVide(p.nationalite)) parts.push(`de nationalité ${p.nationalite.trim()}`);
  if (lieu) parts.push(`${domicilie} à ${lieu}`);
  return parts.filter(nonVide).join(", ");
}

// Un client : 'entrepreneur_individuel' s'écrit comme une personne physique.
function depuisClient(c) {
  return c ? { ...c, type: c.type === "morale" ? "morale" : "physique" } : null;
}

// Une partie au dossier : sans type enregistré, déduit des rubriques d'une société ; sans aucun détail, nom seul.
function depuisPartie(p) {
  if (!p) return null;
  const societe = p.type_partie === "morale" || (!p.type_partie && [p.forme_juridique, p.rccm, p.capital_social, p.representant_nom].some(nonVide));
  return { ...p, type: societe ? "morale" : "physique" };
}

module.exports = {
  BALISES, A_COMPLETER, DEGRES, libelleStatutPartie, libelleDegre, fmtDate, ou, jointureEt,
  dateLongue, naissance, filiation, representant, identification, depuisClient, depuisPartie, CIVILITES,
};
