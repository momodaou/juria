// JURIA — moteur partagé de périodicité (05/10/2026)
//
// Extrait de routes/echeances-administratives.js (11/09/2026, échéances
// fiscales/sociales/ordinales du cabinet) pour être réutilisé tel quel par
// abonnements.js (facturation périodique des clients sous convention-cadre,
// 05/10/2026) — même notion de "prochaine occurrence d'une formule
// récurrente", même edge cases déjà couvertes par les tests existants
// (jour 31 un mois de 30 jours, ancrage mensuel qui ne doit JAMAIS dépendre
// du mois de création). Partagé plutôt que dupliqué : contrairement aux
// petits helpers d'affichage (niveauAlerte, libellé*) dupliqués à dessein
// dans ce projet, cette logique est correctness-critique et déjà source
// d'un bug réel une fois (voir deriverFormule ci-dessous) — un seul endroit
// à corriger si un nouveau cas limite apparaît, même principe que
// facturationDiscipline.js/instanceActuelle.js.
"use strict";

// `pg` renvoie une colonne DATE comme un objet Date JS (minuit UTC), pas une
// chaîne — normalise en 'YYYY-MM-DD' partout où ce module manipule des dates
// en provenance de la base.
function versDateISO(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Calcule la prochaine occurrence d'une formule récurrente (périodicité +
// jour du mois + mois d'ancrage pour l'annuelle/semestrielle/trimestrielle)
// à partir de la dernière période effectivement close — plutôt que de
// faire confiance à une date stockée qu'il faudrait avancer manuellement.
// Retourne null pour une périodicité ponctuelle/inconnue ou des données
// insuffisantes. `aujourdHui`/`dernierTraiteLe` : chaînes 'YYYY-MM-DD' (ou
// null, Date, etc. — normalisées via versDateISO).
function calculerProchaineEcheance({ periodicite, jour_echeance, mois_echeance, dernier_traite_le }, aujourdHui) {
  const pasMois = { mensuelle: 1, trimestrielle: 3, semestrielle: 6, annuelle: 12 }[periodicite];
  if (!pasMois || !jour_echeance) return null;
  const today = new Date(versDateISO(aujourdHui) + "T00:00:00Z");
  const dernierTraiteIso = versDateISO(dernier_traite_le);
  const dernierTraite = dernierTraiteIso ? new Date(dernierTraiteIso + "T00:00:00Z") : null;

  let annee = today.getUTCFullYear();
  let moisIndex = (mois_echeance ?? today.getUTCMonth() + 1) - 1; // 0-indexé

  function occurrence(a, mIdx) {
    const dernierJourDuMois = new Date(Date.UTC(a, mIdx + 1, 0)).getUTCDate();
    return new Date(Date.UTC(a, mIdx, Math.min(jour_echeance, dernierJourDuMois)));
  }

  let candidate = occurrence(annee, moisIndex);
  while (dernierTraite && candidate <= dernierTraite) {
    moisIndex += pasMois;
    annee += Math.floor(moisIndex / 12);
    moisIndex = ((moisIndex % 12) + 12) % 12;
    candidate = occurrence(annee, moisIndex);
  }
  return candidate.toISOString().slice(0, 10);
}

// Déduit (jour_echeance, mois_echeance) d'une date + une périodicité — la
// personne qui saisit continue de ne choisir qu'une seule date comme point
// d'ancrage, jamais un jour/mois séparés. Le mois d'ancrage n'a de sens que
// pour une périodicité >= annuelle (semestrielle/trimestrielle/annuelle) :
// une périodicité MENSUELLE ne doit jamais être ancrée à son mois de
// création — sinon calculerProchaineEcheance() la fait redémarrer chaque
// année sur CE mois-là au lieu de flotter sur le mois courant (bug trouvé
// en testant echeances_administratives le 11/09/2026 : une échéance
// mensuelle créée en janvier restait bloquée en janvier).
function deriverFormule(prochaineDate, periodicite) {
  const d = new Date(prochaineDate + "T00:00:00Z");
  const jourEcheance = d.getUTCDate();
  const moisEcheance = periodicite === "mensuelle" ? null : d.getUTCMonth() + 1;
  return { jourEcheance, moisEcheance };
}

module.exports = { versDateISO, calculerProchaineEcheance, deriverFormule };
