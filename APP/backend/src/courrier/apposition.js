// JURIA — Générateur de courriers : apposition du cachet et de la signature (lot 5, 05/11/2026).
//
// Le cachet du cabinet et la signature scannée du signataire sont des images PRIVÉES (jamais renvoyées par l'API) :
// le serveur les relit ici, au moment d'apercevoir ou de signer, et les place dans le PDF. Les réglages de taille et
// de position (ensemble, signature seule, décalages) sont bornés et mémorisés par signataire.
const R = require("./reglages");
const { ErreurRedaction } = require("./erreurs");

const BORNES = { ens: [0.7, 1.3], ts: [0.6, 1.4], ox: [-40, 40], oy: [-40, 40] };
const DEFAUTS = { ens: 1, ts: 1, ox: 0, oy: 0 };
const NOMS = { ens: "Taille de l'ensemble", ts: "Taille de la signature", ox: "Décalage horizontal", oy: "Décalage vertical" };

// Valide les réglages reçus (les valeurs absentes prennent les valeurs mémorisées du signataire).
function normaliser(corps, defauts = DEFAUTS) {
  const out = {};
  for (const cle of Object.keys(BORNES)) {
    const brut = corps && corps[cle] !== undefined && corps[cle] !== null && corps[cle] !== "" ? corps[cle] : defauts[cle];
    const n = Number(brut);
    const [min, max] = BORNES[cle];
    if (!Number.isFinite(n) || n < min || n > max) throw new ErreurRedaction(400, NOMS[cle] + " : entre " + min + " et " + max + ".");
    out[cle] = Math.round(n * 100) / 100;
  }
  return out;
}

async function defautsUtilisateur(db, userId) {
  const { rows: [u] } = await db.query("SELECT apposition_defaut FROM utilisateurs WHERE id = $1::uuid", [userId]);
  return { ...DEFAUTS, ...((u && u.apposition_defaut) || {}) };
}

// Prépare l'option « signature » du moteur PDF : images relues côté serveur, géométrie par défaut (signature centrée,
// recouvrant le bas du cachet comme sur le papier), réglages de l'utilisateur par-dessus.
async function construireSignature(db, userId, reglages) {
  const cachetBuf = await R.lireCachet(db);
  const sigBuf = await R.lireSignature(userId, db);
  if (!cachetBuf || !sigBuf) {
    throw new ErreurRedaction(409, "Cachet ou signature non déposé(s) : demandez à l'administration de les déposer (Accès & permissions › Courriers).");
  }
  const c = R.validerPng(cachetBuf), s = R.validerPng(sigBuf);
  if (c.erreur || s.erreur) throw new ErreurRedaction(409, "Cachet ou signature illisible(s) : redéposez-les (PNG à fond transparent).");
  return {
    cachetBuf, sigBuf,
    cachet: { largeur: c.largeur, hauteur: c.hauteur },
    sig: { largeur: s.largeur, hauteur: s.hauteur, dx: (c.largeur - s.largeur) / 2, dy: c.hauteur - 0.14 * s.hauteur },
    ens: reglages.ens, ts: reglages.ts, ox: reglages.ox, oy: reglages.oy,
  };
}

module.exports = { BORNES, DEFAUTS, normaliser, defautsUtilisateur, construireSignature };
