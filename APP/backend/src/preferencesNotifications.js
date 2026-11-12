// JURIA — réglages personnels de notification (12/11/2026).
// Un réglage ne décide JAMAIS si l'information arrive (cloche, bandeau des urgences et bulle du navigateur restent pour tous) :
// il décide seulement de recevoir, EN PLUS, un e-mail. Trois cases :
//   - recap_lundi     : e-mail du lundi (le point de la semaine) ;
//   - recap_quotidien : e-mails récapitulatifs du matin (dépenses en attente) et du soir (dossiers créés) ;
//   - email_urgence   : e-mail immédiat pour un délai de procédure ou un état de charges soumis à décision.
// Garde-fous : l'interrupteur général du cabinet passe avant tout ; les avocats (collaborateur, avocat stagiaire, Of Counsel) ne
// peuvent pas couper l'e-mail de délai de procédure (un délai manqué engage la responsabilité du cabinet) ; les relances demandées
// à la main par un collègue ne sont pas concernées. Sans ligne en base, on applique les valeurs par défaut du rôle.
const { pool } = require("./db");

const ASSOCIES = ["associe", "associe_fondateur"];
const URGENCE_VERROUILLEE = ["collaborateur", "avocat_stagiaire", "of_counsel"];
const URGENCE_PAR_DEFAUT = [...ASSOCIES, "admin_general", "comptable", ...URGENCE_VERROUILLEE];

function defautsPourRole(role) {
  return { recap_lundi: true, recap_quotidien: false, email_urgence: URGENCE_PAR_DEFAUT.includes(role) };
}
const verrouille = (role) => ({ email_urgence: URGENCE_VERROUILLEE.includes(role) });

// Valeurs effectives d'une personne (réglage enregistré, sinon défaut du rôle ; verrous appliqués).
function effectif(role, ligne) {
  const d = defautsPourRole(role);
  const v = ligne
    ? { recap_lundi: !!ligne.recap_lundi, recap_quotidien: !!ligne.recap_quotidien, email_urgence: !!ligne.email_urgence }
    : d;
  if (verrouille(role).email_urgence) v.email_urgence = true;
  return v;
}

// Map id -> valeurs effectives pour une liste de personnes { id, role }.
async function chargerPour(personnes, db = pool) {
  const ids = personnes.map((p) => p.id);
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await db.query("SELECT * FROM preferences_notifications WHERE utilisateur_id = ANY($1::uuid[])", [ids]);
  const parId = new Map(rows.map((r) => [r.utilisateur_id, r]));
  for (const p of personnes) out.set(p.id, effectif(p.role, parId.get(p.id)));
  return out;
}

// Filtre une liste de personnes { id, role } : ne garde que celles qui ont accepté ce canal ('recap_lundi' | 'recap_quotidien' | 'email_urgence').
async function filtrer(personnes, canal, db = pool) {
  const valeurs = await chargerPour(personnes, db);
  return personnes.filter((p) => valeurs.get(p.id)[canal]);
}

async function enregistrer(utilisateurId, role, corps, db = pool) {
  const actuel = effectif(role, (await db.query("SELECT * FROM preferences_notifications WHERE utilisateur_id = $1", [utilisateurId])).rows[0]);
  const bool = (cle) => (typeof corps[cle] === "boolean" ? corps[cle] : actuel[cle]);
  const v = { recap_lundi: bool("recap_lundi"), recap_quotidien: bool("recap_quotidien"), email_urgence: bool("email_urgence") };
  if (verrouille(role).email_urgence) v.email_urgence = true;
  await db.query(
    `INSERT INTO preferences_notifications (utilisateur_id, recap_lundi, recap_quotidien, email_urgence, modifie_le)
     VALUES ($1,$2,$3,$4,now())
     ON CONFLICT (utilisateur_id) DO UPDATE SET recap_lundi = EXCLUDED.recap_lundi, recap_quotidien = EXCLUDED.recap_quotidien,
       email_urgence = EXCLUDED.email_urgence, modifie_le = now()`,
    [utilisateurId, v.recap_lundi, v.recap_quotidien, v.email_urgence]);
  return v;
}

module.exports = { defautsPourRole, verrouille, effectif, chargerPour, filtrer, enregistrer };
