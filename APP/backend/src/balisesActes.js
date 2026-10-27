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
  { cle: "client_identification", groupe: "Client", description: "Identité complète en une phrase (dénomination, forme, RCCM, NIF, siège ou domicile)" },
  // Partie adverse
  { cle: "partie_adverse", groupe: "Partie adverse", description: "Première partie adverse" },
  { cle: "parties_adverses", groupe: "Partie adverse", description: "Toutes les parties adverses, séparées par « et »" },
  { cle: "conseil_adverse", groupe: "Partie adverse", description: "Conseil de la première partie adverse" },
  { cle: "destinataire", groupe: "Partie adverse", description: "Partie adverse, ou à défaut le client" },
  // Instance et audience
  { cle: "instance_degre", groupe: "Instance", description: "Degré de l'instance en cours (première instance, appel…)" },
  { cle: "instance_juridiction", groupe: "Instance", description: "Juridiction de l'instance en cours" },
  { cle: "instance_numero_role", groupe: "Instance", description: "N° de rôle de l'instance en cours" },
  { cle: "instance_date_debut", groupe: "Instance", description: "Date de début de l'instance en cours" },
  { cle: "client_qualite", groupe: "Instance", description: "Qualité du client dans l'instance (demandeur, appelant, intimé…)" },
  { cle: "audience_prochaine_date", groupe: "Instance", description: "Date de la prochaine audience" },
  { cle: "audience_prochaine_juridiction", groupe: "Instance", description: "Juridiction de la prochaine audience" },
  // Cabinet et rédacteur
  { cle: "date", groupe: "Cabinet", description: "Date du jour" },
  { cle: "avocat", groupe: "Cabinet", description: "Utilisateur qui génère l'acte" },
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

// Identité du client en une phrase, telle qu'on l'écrit en tête d'un acte.
// Seules les rubriques renseignées sont reprises (pas de « RCCM [à compléter] »
// en plein milieu de phrase pour une donnée qui n'existe pas) ; ce sont les
// balises unitaires (client_rccm…) qui signalent un manque.
function identificationClient(c) {
  if (!c) return A_COMPLETER;
  const lieu = [c.adresse, c.ville].filter((x) => x && String(x).trim()).join(", ");
  if (c.type === "morale") {
    const parts = [c.denomination, c.forme_juridique];
    if (c.rccm) parts.push(`immatriculée au RCCM sous le n° ${c.rccm}`);
    if (c.nif) parts.push(`NIF ${c.nif}`);
    if (lieu) parts.push(`dont le siège social est situé à ${lieu}`);
    return parts.filter((x) => x && String(x).trim()).join(", ");
  }
  const parts = [[c.prenom, c.nom].filter(Boolean).join(" ")];
  if (c.nationalite) parts.push(`de nationalité ${c.nationalite}`);
  if (lieu) parts.push(`demeurant à ${lieu}`);
  return parts.filter((x) => x && String(x).trim()).join(", ");
}

module.exports = {
  BALISES, A_COMPLETER, DEGRES, libelleStatutPartie, libelleDegre, fmtDate, ou, jointureEt, identificationClient,
};
