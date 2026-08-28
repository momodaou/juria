// JURIA — matrice de permissions configurable par rôle.
//
// Catalogue des actions "métier" pouvant être activées/désactivées par
// rôle depuis l'écran Accès & permissions (réservé Associé + Administrateur
// IT — voir routes/acces.js). Le module Accès & permissions lui-même
// (comptes, rôles, cette matrice) N'EST PAS dans ce catalogue : il reste
// gardé par requireRole() en dur, pour qu'une erreur de manipulation dans
// la matrice ne puisse jamais retirer à tout le monde le moyen de la
// corriger.
//
// Chaque entrée correspond à une ligne du registre des commandes manuelles ;
// les entrées marquées "restreinte: true" sont réservées par défaut à la
// direction/comptabilité (voir schema.sql pour les valeurs de départ
// exactes) — 10 actions de création/décaissement (dès la mise en place de
// la matrice), + 4 actions de simple CONSULTATION ajoutées le 18/08/2026
// (factures/dépenses/rétrocessions/bulletins de paie « des autres ») après
// une demande explicite de « role level security » plus poussée : la
// matrice ne portait jusque-là que sur les actions de création/modification,
// jamais sur le simple fait de voir une liste sensible.
const { pool } = require("./db");

const CATALOGUE = [
  { code: "documents.creer", module: "Dossiers 360", label: "Déposer un document" },
  { code: "communications.creer", module: "Dossiers 360", label: "Ajouter une communication" },
  { code: "dossiers.modifier", module: "Dossiers 360", label: "Modifier la fiche du dossier" },
  { code: "dossiers.archiver", module: "Dossiers 360", label: "Archiver un dossier clôturé", restreinte: true },
  { code: "dossiers.supprimer", module: "Dossiers 360", label: "Supprimer un dossier (sans activité enregistrée)", restreinte: true },
  { code: "dossiers.clients_additionnels.gerer", module: "Dossiers 360", label: "Ajouter/retirer un client supplémentaire sur le dossier" },
  { code: "dossiers.instances.gerer", module: "Dossiers 360", label: "Ajouter/modifier une instance (1re instance, appel, cassation…)" },
  { code: "dossiers.parties.gerer", module: "Dossiers 360", label: "Ajouter/rectifier/retirer une partie adverse après la création" },

  { code: "conflits.soumettre", module: "Nouveau dossier", label: "Soumettre un contrôle de conflit" },
  { code: "conflits.decision", module: "Nouveau dossier", label: "Décider sur un conflit potentiel", restreinte: true },
  { code: "dossiers.creer", module: "Nouveau dossier", label: "Créer le dossier" },
  { code: "dossiers.pro_bono.declarer", module: "Nouveau dossier", label: "Déclarer un dossier pro bono (réservé aux avocats)", restreinte: true },

  { code: "clients.creer", module: "Clients & KYC", label: "Créer un client" },
  { code: "clients.modifier", module: "Clients & KYC", label: "Modifier la fiche client" },
  { code: "clients.supprimer", module: "Clients & KYC", label: "Supprimer un client (sans activité enregistrée)", restreinte: true },
  { code: "clients.kyc_piece.ajouter", module: "Clients & KYC", label: "Ajouter une pièce KYC" },
  { code: "clients.kyc_piece.supprimer", module: "Clients & KYC", label: "Supprimer une pièce KYC" },
  { code: "originaux.creer", module: "Clients & KYC", label: "Enregistrer un original confié" },
  { code: "originaux.restituer", module: "Clients & KYC", label: "Restituer un original" },

  { code: "evenements.creer", module: "Échéancier", label: "Ajouter une échéance" },
  { code: "evenements.jobs.declencher", module: "Échéancier", label: "Déclencher manuellement le job d'alertes de délais", restreinte: true },

  { code: "audiences.ligne.creer", module: "Rôle d'audience", label: "Inscrire une audience au rôle" },
  { code: "audiences.role.valider", module: "Rôle d'audience", label: "Valider le rôle de la semaine", restreinte: true },
  { code: "audiences.role.diffuser", module: "Rôle d'audience", label: "Diffuser le rôle", restreinte: true },
  { code: "audiences.retour.saisir", module: "Rôle d'audience", label: "Saisir un retour d'audience" },

  { code: "courriers.creer", module: "Registre du courrier", label: "Enregistrer un courrier" },
  { code: "courriers.statut.modifier", module: "Registre du courrier", label: "Faire évoluer le statut" },

  { code: "actes.generer", module: "Atelier d'actes", label: "Générer un acte" },

  { code: "biblio.creer", module: "Bibliothèque", label: "Ajouter une ressource" },
  { code: "biblio.supprimer", module: "Bibliothèque", label: "Supprimer une ressource" },

  { code: "taches.creer", module: "Plan d'action", label: "Créer une tâche" },
  { code: "taches.statut.modifier", module: "Plan d'action", label: "Déplacer une tâche" },
  { code: "taches.valider", module: "Plan d'action", label: "Valider une tâche", restreinte: true },

  { code: "factures.consulter", module: "Chrono & Facturation", label: "Consulter les factures (liste, montants)", restreinte: true },
  { code: "temps.creer", module: "Chrono & Facturation", label: "Saisir du temps passé" },
  { code: "factures.creer", module: "Chrono & Facturation", label: "Émettre une facture" },
  { code: "factures.paiement.ajouter", module: "Chrono & Facturation", label: "Encaisser un paiement" },
  { code: "factures.annuler", module: "Chrono & Facturation", label: "Annuler une facture émise (non réglée)", restreinte: true },

  { code: "depenses.consulter", module: "Dépenses & caisse", label: "Consulter les dépenses (liste, montants)", restreinte: true },
  { code: "depenses.creer", module: "Dépenses & caisse", label: "Soumettre une dépense" },
  { code: "depenses.decision", module: "Dépenses & caisse", label: "Valider / rejeter une dépense", restreinte: true },
  { code: "depenses.decaisser", module: "Dépenses & caisse", label: "Décaisser une dépense", restreinte: true },
  { code: "depenses.petite_caisse.doter", module: "Dépenses & caisse", label: "Doter la petite caisse du mois", restreinte: true },
  { code: "depenses.vignettes.mouvement", module: "Dépenses & caisse", label: "Mouvement de vignettes" },

  { code: "retrocessions.consulter", module: "Rétrocessions", label: "Consulter les rétrocessions de tous (montants, rémunération)", restreinte: true },
  { code: "retrocessions.creer", module: "Rétrocessions", label: "Enregistrer une rétrocession" },
  { code: "retrocessions.decaisser", module: "Rétrocessions", label: "Décaisser une rétrocession", restreinte: true },

  { code: "cabinet.conge.demander", module: "Cabinet (RH)", label: "Demander un congé" },
  { code: "cabinet.conge.decision", module: "Cabinet (RH)", label: "Valider / rejeter un congé", restreinte: true },
  { code: "cabinet.presence.pointer", module: "Cabinet (RH)", label: "Pointer (présence)" },
  { code: "cabinet.bulletin.generer", module: "Cabinet (RH)", label: "Générer un bulletin", restreinte: true },
  { code: "cabinet.bulletins.consulter", module: "Cabinet (RH)", label: "Consulter les bulletins de paie de tous (au-delà des siens)", restreinte: true },

  { code: "ia.resume", module: "Assistant IA", label: "Résumer" },
  { code: "ia.chronologie", module: "Assistant IA", label: "Reconstituer une chronologie" },
  { code: "ia.extraction_faits", module: "Assistant IA", label: "Extraire des faits" },
  { code: "ia.analyse_contrat", module: "Assistant IA", label: "Analyser un contrat" },
  { code: "ia.traduction", module: "Assistant IA", label: "Traduire" },
  { code: "ia.comparaison", module: "Assistant IA", label: "Comparer deux textes" },

  { code: "messagerie.creer_conversation", module: "Messagerie", label: "Créer une conversation" },
  { code: "messagerie.envoyer_message", module: "Messagerie", label: "Envoyer un message" },

  // Code inchangé depuis sa création (18/08/2026) pour éviter une migration
  // de renommage ; le périmètre s'est réduit au pro bono depuis l'abandon
  // du seuil classique (150 000 FCFA) le même jour.
  { code: "parametres.honoraires.modifier", module: "Paramètres cabinet", label: "Modifier le seuil de frais pro bono et le quota mensuel", restreinte: true },

  // Ajout 28/08/2026 (facture PDF enrichie) : identité du cabinet (en-tête
  // facture) + comptes bancaires (RIB imprimé sur la facture) n'avaient
  // aucune route d'écriture jusqu'ici — voir schema.sql.
  { code: "parametres.cabinet.modifier", module: "Paramètres cabinet", label: "Modifier l'identité du cabinet et les comptes bancaires", restreinte: true },
];

const CODES_VALIDES = new Set(CATALOGUE.map((a) => a.code));

// Middleware : autorise req.user.role à passer si (role, actionCode) est
// marqué autorise=TRUE dans permissions_role. Refuse par défaut si aucune
// ligne n'existe (jamais d'accès implicite) — voir schema.sql pour le
// remplissage initial qui reproduit le comportement d'avant cette matrice.
// Version "inline" du même contrôle, pour les cas où l'autorisation dépend
// d'une condition dans le body (ex. dossiers.js : seule la déclaration
// pro_bono=true exige la permission, pas la création elle-même) et ne peut
// donc pas être un simple middleware de route.
async function estAutorise(role, actionCode) {
  const { rows } = await pool.query(
    "SELECT autorise FROM permissions_role WHERE role = $1 AND action_code = $2",
    [role, actionCode]
  );
  return !!(rows[0] && rows[0].autorise);
}

function requirePermission(actionCode) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Non authentifié" });
    try {
      if (!(await estAutorise(req.user.role, actionCode))) {
        return res.status(403).json({ error: "Accès refusé (fonctionnalité non autorisée pour ce rôle)" });
      }
      next();
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Erreur serveur" });
    }
  };
}

module.exports = { CATALOGUE, CODES_VALIDES, requirePermission, estAutorise };
