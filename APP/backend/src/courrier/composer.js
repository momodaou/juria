// JURIA — Générateur de courriers : service de composition (lot 2, 05/11/2026).
//
// Assemble : gabarit + valeurs saisies + signataire (nom, mention : base de données) + réglages du cabinet
// (mesures du papier, logo par défaut, décor) → lettre mise en page en PDF et en Word. Ne touche ni au registre
// ni au stockage : la réservation du numéro, l'inscription au registre et le rattachement des pièces sont le lot 3 ;
// l'apposition du cachet et de la signature le lot 5.
const { pool } = require("../db");
const { genererPdf } = require("./moteurPdf");
const { genererDocx } = require("./moteurDocx");
const { validerContenu, composerLettre, signataireAffiche, gabarit } = require("./gabarits");
const { lireReglages, mesuresEffectives } = require("./reglages");

class ErreurContenu extends Error {
  constructor(erreurs) { super("Contenu du courrier invalide : " + erreurs.map((e) => e.message).join(" ; ")); this.erreurs = erreurs; }
}

// params : { gabarit, valeurs, signataireId, nref?, blocSignature?, sortie? ('A'|'B'), logo?, decor?, trace?, signature? (lot 5), filigrane? }
async function genererCourrier(params, db = pool) {
  const g = gabarit(params.gabarit);
  if (!g) throw new ErreurContenu([{ cle: "gabarit", message: "Gabarit inconnu." }]);
  const { contenu, erreurs } = validerContenu(params.gabarit, params.valeurs);
  if (erreurs.length) throw new ErreurContenu(erreurs);

  const { rows: [u] } = await db.query(
    "SELECT prenom, nom, role, nom_signature, qualite_signature FROM utilisateurs WHERE id = $1::uuid AND actif = TRUE", [params.signataireId]);
  if (!u) throw new ErreurContenu([{ cle: "signataire", message: "Signataire introuvable ou inactif." }]);

  const reglages = await lireReglages(db);
  const mesures = await mesuresEffectives(db);
  const annee = new Date().getFullYear();
  const lettre = composerLettre(params.gabarit, contenu, {
    nref: params.nref || "DEP-" + annee + "-…… (numéro attribué à l'enregistrement)",
    signataire: signataireAffiche(u),
    blocSignature: params.blocSignature,
  });
  const options = {
    sortie: params.sortie === "B" ? "B" : "A",
    logo: params.logo || reglages.logo_defaut,
    decor: params.decor === undefined ? reglages.decor : params.decor,
    mesures,
    trace: params.trace,
    signature: params.signature,
    filigrane: params.filigrane,
  };
  const { buffer: pdf, pages } = await genererPdf(lettre, options);
  const docx = await genererDocx(lettre, { ...options, pages });
  return { pdf, docx, pages, lettre, contenu };
}

module.exports = { genererCourrier, ErreurContenu };
