// JURIA — diffusion en direct de la messagerie interne.
//
// Repose sur Postgres LISTEN/NOTIFY plutôt qu'un service externe
// (Redis/Firestore/Pub-Sub) : une notification émise par une instance
// Cloud Run est reçue par TOUTES les connexions en écoute, quelle que soit
// l'instance qui les détient — ça résout la diffusion multi-instance sans
// composant d'infrastructure supplémentaire. Chaque instance garde une
// connexion PG dédiée (hors du pool de requêtes) pour LISTEN, et un
// registre en mémoire des flux SSE (Server-Sent Events) ouverts localement.
const { Client } = require("pg");

const CANAL = "messagerie";

// utilisateur_id -> Set<Response> (flux SSE ouverts sur CETTE instance)
const abonnes = new Map();

function abonner(utilisateurId, res) {
  if (!abonnes.has(utilisateurId)) abonnes.set(utilisateurId, new Set());
  abonnes.get(utilisateurId).add(res);
}

function desabonner(utilisateurId, res) {
  const set = abonnes.get(utilisateurId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) abonnes.delete(utilisateurId);
}

// Envoie l'événement aux abonnés connectés SUR CETTE INSTANCE seulement —
// la diffusion inter-instances passe par NOTIFY (voir demarrerEcoute), pas
// par cette fonction, qui ne fait que pousser vers des flux déjà locaux.
function pousserLocalement(destinataireIds, evenement) {
  const payload = `data: ${JSON.stringify(evenement)}\n\n`;
  for (const id of destinataireIds) {
    const set = abonnes.get(id);
    if (!set) continue;
    for (const res of set) res.write(payload);
  }
}

// Publie un événement : écrit sur NOTIFY (toutes les instances, y compris
// celle-ci, le recevront via demarrerEcoute) plutôt que d'appeler
// pousserLocalement() directement, pour que le comportement soit identique
// qu'il y ait une ou plusieurs instances actives.
async function publier(pool, destinataireIds, evenement) {
  const payload = JSON.stringify({ destinataireIds, evenement });
  // pg_notify() évite les soucis d'échappement de NOTIFY canal, 'texte'
  // pour un payload construit dynamiquement.
  await pool.query("SELECT pg_notify($1, $2)", [CANAL, payload]);
}

let clientEcoute = null;

function demarrerEcoute(config) {
  const client = new Client(config);
  clientEcoute = client;

  client.on("notification", (msg) => {
    if (msg.channel !== CANAL) return;
    try {
      const { destinataireIds, evenement } = JSON.parse(msg.payload);
      pousserLocalement(destinataireIds, evenement);
    } catch (e) {
      console.error("Payload de notification messagerie invalide :", e.message);
    }
  });

  client.on("error", (e) => {
    console.error("Connexion d'écoute messagerie perdue, reconnexion dans 3s :", e.message);
    setTimeout(() => demarrerEcoute(config), 3000);
  });

  client
    .connect()
    .then(() => client.query(`LISTEN ${CANAL}`))
    .catch((e) => {
      console.error("Échec de connexion d'écoute messagerie, nouvelle tentative dans 3s :", e.message);
      setTimeout(() => demarrerEcoute(config), 3000);
    });
}

module.exports = { abonner, desabonner, publier, demarrerEcoute };
