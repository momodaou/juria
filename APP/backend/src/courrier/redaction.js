// JURIA — Générateur de courriers : rédaction d'un courrier départ (lot 3, 05/11/2026).
//
// Un courrier rédigé dans JURIA :
//   - reçoit sa référence DEP-AAAA-NNNNNN à la création (même numérotation et même verrou que le registre),
//     DANS la même transaction que la génération : si la mise en page échoue, aucun numéro n'est consommé ;
//   - est inscrit au registre (avec ou sans dossier : courrier général du cabinet possible) ;
//   - garde son contenu (valeurs saisies) et ses options ; chaque génération Word + PDF est une VERSION
//     conservée (courrier_versions), stockée de façon privée ;
//   - passe par trois états : brouillon → à signer → signée (la signature elle-même est le lot 5).
// Les brouillons ne vont pas dans la GED : seule la pièce définitive y entrera (lot 5).
const { pool } = require("../db");
const { saveObject, readObject, deleteObject } = require("../storage");
const { genererReference } = require("../referenceCourrier");
const { estAutorise } = require("../permissions");
const { logAudit } = require("../audit");
const { genererCourrier } = require("./composer");
const { ErreurRedaction } = require("./erreurs");
const crypto = require("crypto");
const A = require("./apposition");


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SORTIES = ["A", "B"];
const LOGOS = ["mali", "std"];
const BLOCS = ["psc", "con"];

function options(p, precedentes = {}) {
  const o = { ...precedentes };
  if (p.sortie !== undefined) {
    if (!SORTIES.includes(p.sortie)) throw new ErreurRedaction(400, "Sortie : A (papier à en-tête) ou B (en-tête numérique).");
    o.sortie = p.sortie;
  }
  if (p.logo !== undefined && p.logo !== null) {
    if (!LOGOS.includes(p.logo)) throw new ErreurRedaction(400, "Logo : mali ou std.");
    o.logo = p.logo;
  }
  if (p.decor !== undefined && p.decor !== null) o.decor = p.decor === true || p.decor === "true";
  if (p.bloc_signature !== undefined && p.bloc_signature !== null) {
    if (!BLOCS.includes(p.bloc_signature)) throw new ErreurRedaction(400, "Bloc de signature : psc ou con.");
    o.bloc_signature = p.bloc_signature;
  }
  if (!o.sortie) o.sortie = "A";
  return o;
}

async function verifierSignataire(db, id) {
  if (!id || !UUID.test(id)) throw new ErreurRedaction(400, "Signataire requis.");
  const { rows: [u] } = await db.query("SELECT role, actif FROM utilisateurs WHERE id = $1::uuid", [id]);
  if (!u || !u.actif) throw new ErreurRedaction(400, "Signataire introuvable ou inactif.");
  if (!(await estAutorise(u.role, "courriers.signer", id))) throw new ErreurRedaction(400, "Le signataire doit être habilité à signer un courrier.");
}

async function stocker(courrierId, numero, pdf, docx, deposes) {
  const base = "courrier/brouillons/" + courrierId + "/v" + numero;
  const pdfChemin = await saveObject(pdf, base + ".pdf", "application/pdf"); deposes.push(pdfChemin);
  const docxChemin = await saveObject(docx, base + ".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); deposes.push(docxChemin);
  return { pdfChemin, docxChemin };
}

async function nettoyer(deposes) {
  for (const chemin of deposes) { try { await deleteObject(chemin); } catch (e) { /* au mieux */ } }
}

async function peutModifier(utilisateur, courrier) {
  return courrier.cree_par === utilisateur.sub || (await estAutorise(utilisateur.role, "courriers.statut.modifier", utilisateur.sub));
}

// p : { gabarit, valeurs, signataire_id, dossier_id?, sortie?, logo?, decor?, bloc_signature? }
async function creer(utilisateur, p) {
  const opt = options(p);
  await verifierSignataire(pool, p.signataire_id);
  if (p.dossier_id) {
    if (!UUID.test(p.dossier_id)) throw new ErreurRedaction(400, "Dossier invalide.");
    const { rows } = await pool.query("SELECT 1 FROM dossiers WHERE id = $1::uuid", [p.dossier_id]);
    if (!rows.length) throw new ErreurRedaction(400, "Dossier introuvable.");
  }
  const client = await pool.connect();
  const deposes = [];
  try {
    await client.query("BEGIN");
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const reference = await genererReference(client, "depart", aujourdhui);
    const g = await genererCourrier({
      gabarit: p.gabarit, valeurs: p.valeurs, signataireId: p.signataire_id, nref: reference,
      sortie: opt.sortie, logo: opt.logo, decor: opt.decor, blocSignature: opt.bloc_signature,
    }, client);
    const correspondant = g.contenu.destinataire.join(", ").slice(0, 240);
    const { rows: [c] } = await client.query(
      "INSERT INTO courriers (reference, sens, type, date_courrier, correspondant, objet, dossier_id, support, statut, a_numeriser, " +
      "recu_par, cree_par, gabarit_code, contenu, options_redaction, etat_redaction, signataire_id) " +
      "VALUES ($1,'depart','lettre',$2,$3,$4,$5::uuid,'numerique','recu',FALSE,$6::uuid,$6::uuid,$7,$8::jsonb,$9::jsonb,'brouillon',$10::uuid) " +
      "RETURNING id, reference, date_courrier, correspondant, objet, dossier_id, etat_redaction, signataire_id",
      [reference, aujourdhui, correspondant, String(g.contenu.objet).slice(0, 300), p.dossier_id || null, utilisateur.sub,
       p.gabarit, JSON.stringify(g.contenu), JSON.stringify(opt), p.signataire_id]);
    const f = await stocker(c.id, 1, g.pdf, g.docx, deposes);
    await client.query(
      "INSERT INTO courrier_versions (courrier_id, numero, contenu, options, signataire_id, pages, pdf_chemin, docx_chemin, cree_par) " +
      "VALUES ($1::uuid,1,$2::jsonb,$3::jsonb,$4::uuid,$5,$6,$7,$8::uuid)",
      [c.id, JSON.stringify(g.contenu), JSON.stringify(opt), p.signataire_id, g.pages, f.pdfChemin, f.docxChemin, utilisateur.sub]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: utilisateur.sub, action: "rediger_courrier", entite: "courriers", entiteId: c.id,
      details: { reference, gabarit: p.gabarit, sortie: opt.sortie, signataire_id: p.signataire_id } });
    return { courrier: c, version: { numero: 1, pages: g.pages } };
  } catch (e) {
    await client.query("ROLLBACK");
    await nettoyer(deposes);
    throw e;
  } finally {
    client.release();
  }
}

// p : { valeurs?, signataire_id?, sortie?, logo?, decor?, bloc_signature? } — crée une NOUVELLE version, les précédentes restent.
async function modifier(utilisateur, id, p) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const client = await pool.connect();
  const deposes = [];
  try {
    await client.query("BEGIN");
    const { rows: [c] } = await client.query("SELECT * FROM courriers WHERE id = $1::uuid FOR UPDATE", [id]);
    if (!c) throw new ErreurRedaction(404, "Courrier introuvable.");
    if (!c.etat_redaction) throw new ErreurRedaction(409, "Ce courrier n'a pas été rédigé dans JURIA.");
    if (c.annule_le) throw new ErreurRedaction(409, "Ce courrier est annulé.");
    if (c.etat_redaction === "signee") throw new ErreurRedaction(409, "Lettre signée : modification impossible.");
    if (c.etat_redaction === "a_signer") throw new ErreurRedaction(409, "La lettre est à signer : renvoyez-la en brouillon pour la modifier.");
    if (!(await peutModifier(utilisateur, c))) throw new ErreurRedaction(403, "Seul l'auteur (ou la gestion du registre) peut modifier ce brouillon.");
    const opt = options(p, c.options_redaction || {});
    const signataireId = p.signataire_id || c.signataire_id;
    if (p.signataire_id) await verifierSignataire(client, signataireId);
    const valeurs = p.valeurs !== undefined ? p.valeurs : c.contenu;
    const g = await genererCourrier({
      gabarit: c.gabarit_code, valeurs, signataireId, nref: c.reference,
      sortie: opt.sortie, logo: opt.logo, decor: opt.decor, blocSignature: opt.bloc_signature,
    }, client);
    const { rows: [{ n }] } = await client.query("SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM courrier_versions WHERE courrier_id = $1::uuid", [id]);
    const f = await stocker(id, n, g.pdf, g.docx, deposes);
    await client.query(
      "INSERT INTO courrier_versions (courrier_id, numero, contenu, options, signataire_id, pages, pdf_chemin, docx_chemin, cree_par) " +
      "VALUES ($1::uuid,$2,$3::jsonb,$4::jsonb,$5::uuid,$6,$7,$8,$9::uuid)",
      [id, n, JSON.stringify(g.contenu), JSON.stringify(opt), signataireId, g.pages, f.pdfChemin, f.docxChemin, utilisateur.sub]);
    await client.query(
      "UPDATE courriers SET contenu = $1::jsonb, options_redaction = $2::jsonb, signataire_id = $3::uuid, objet = $4, correspondant = $5 WHERE id = $6::uuid",
      [JSON.stringify(g.contenu), JSON.stringify(opt), signataireId, String(g.contenu.objet).slice(0, 300), g.contenu.destinataire.join(", ").slice(0, 240), id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: utilisateur.sub, action: "modifier_brouillon_courrier", entite: "courriers", entiteId: id, details: { reference: c.reference, version: n } });
    return { version: { numero: Number(n), pages: g.pages } };
  } catch (e) {
    await client.query("ROLLBACK");
    await nettoyer(deposes);
    throw e;
  } finally {
    client.release();
  }
}

async function changerEtat(utilisateur, id, de, vers, verifier) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const { rows: [c] } = await pool.query("SELECT id, reference, cree_par, signataire_id, etat_redaction, annule_le FROM courriers WHERE id = $1::uuid", [id]);
  if (!c) throw new ErreurRedaction(404, "Courrier introuvable.");
  if (!c.etat_redaction) throw new ErreurRedaction(409, "Ce courrier n'a pas été rédigé dans JURIA.");
  if (c.annule_le) throw new ErreurRedaction(409, "Ce courrier est annulé.");
  if (c.etat_redaction !== de) throw new ErreurRedaction(409, "État actuel : " + c.etat_redaction + ".");
  await verifier(c);
  await pool.query("UPDATE courriers SET etat_redaction = $1 WHERE id = $2::uuid AND etat_redaction = $3", [vers, id, de]);
  await logAudit({ utilisateurId: utilisateur.sub, action: vers === "a_signer" ? "soumettre_signature_courrier" : "retour_brouillon_courrier", entite: "courriers", entiteId: id, details: { reference: c.reference } });
  return { id, etat_redaction: vers };
}

const soumettre = (u, id) => changerEtat(u, id, "brouillon", "a_signer", async (c) => {
  if (!(await peutModifier(u, c))) throw new ErreurRedaction(403, "Seul l'auteur (ou la gestion du registre) peut soumettre cette lettre.");
  if (!c.signataire_id) throw new ErreurRedaction(409, "Aucun signataire désigné.");
  await verifierSignataire(pool, c.signataire_id);
});
const retourBrouillon = (u, id) => changerEtat(u, id, "a_signer", "brouillon", async (c) => {
  if (c.signataire_id !== u.sub && !(await peutModifier(u, c))) throw new ErreurRedaction(403, "Seuls l'auteur, le signataire ou la gestion du registre peuvent renvoyer cette lettre en brouillon.");
});

async function lire(id) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const { rows: [c] } = await pool.query(
    "SELECT c.id, c.reference, c.gabarit_code, c.contenu, c.options_redaction, c.etat_redaction, c.signataire_id, c.dossier_id, c.cree_par, c.cree_le, " +
    "c.signee_le, c.annule_le, c.apposition, c.pdf_signe_chemin IS NOT NULL AS pdf_signe, s.prenom || ' ' || s.nom AS signataire_nom " +
    "FROM courriers c LEFT JOIN utilisateurs s ON s.id = c.signataire_id WHERE c.id = $1::uuid", [id]);
  if (!c) throw new ErreurRedaction(404, "Courrier introuvable.");
  if (!c.etat_redaction) throw new ErreurRedaction(404, "Ce courrier n'a pas été rédigé dans JURIA.");
  const { rows: versions } = await pool.query(
    "SELECT v.numero, v.pages, v.cree_le, u.prenom || ' ' || u.nom AS cree_par_nom, v.options->>'sortie' AS sortie " +
    "FROM courrier_versions v LEFT JOIN utilisateurs u ON u.id = v.cree_par WHERE v.courrier_id = $1::uuid ORDER BY v.numero", [id]);
  return { ...c, versions };
}

async function fichierVersion(id, numero, format) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const n = Number(numero);
  if (!Number.isInteger(n) || n < 1) throw new ErreurRedaction(400, "Numéro de version invalide.");
  if (!["pdf", "docx"].includes(format)) throw new ErreurRedaction(400, "Format : pdf ou docx.");
  const { rows: [v] } = await pool.query(
    "SELECT v.pdf_chemin, v.docx_chemin, c.reference FROM courrier_versions v JOIN courriers c ON c.id = v.courrier_id WHERE v.courrier_id = $1::uuid AND v.numero = $2", [id, n]);
  if (!v) throw new ErreurRedaction(404, "Version introuvable.");
  const buffer = await readObject(format === "pdf" ? v.pdf_chemin : v.docx_chemin);
  return {
    buffer, nom: v.reference + "-v" + n + "." + format,
    mime: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Signature (lot 5). Sortie B : cachet + signature scannée apposés sur le PDF (figé, empreinte SHA-256 tracée), pièce
// rattachée à la GED du dossier ou au courrier. Sortie A : lettre imprimée sur le papier à en-tête et signée à la main ;
// JURIA enregistre seulement la signature (la copie signée se joint ensuite comme pièce du courrier).
// Seul le signataire désigné, habilité (courriers.signer), peut signer, et seulement une lettre « à signer ».
// ---------------------------------------------------------------------------------------------------------------------
async function chargerPourSignature(db, utilisateur, id, verrou) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const { rows: [c] } = await db.query("SELECT * FROM courriers WHERE id = $1::uuid" + (verrou ? " FOR UPDATE" : ""), [id]);
  if (!c) throw new ErreurRedaction(404, "Courrier introuvable.");
  if (!c.etat_redaction) throw new ErreurRedaction(409, "Ce courrier n'a pas été rédigé dans JURIA.");
  if (c.annule_le) throw new ErreurRedaction(409, "Ce courrier est annulé.");
  if (c.etat_redaction === "signee") throw new ErreurRedaction(409, "Cette lettre est déjà signée.");
  if (c.etat_redaction !== "a_signer") throw new ErreurRedaction(409, "La lettre doit d'abord être soumise à signature.");
  if (c.signataire_id !== utilisateur.sub) throw new ErreurRedaction(403, "Seul le signataire désigné peut signer cette lettre.");
  return c;
}

async function infoApposition(utilisateur, id) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const { rows: [c] } = await pool.query(
    "SELECT etat_redaction, signataire_id, options_redaction, annule_le, apposition, pdf_signe_chemin IS NOT NULL AS pdf_signe FROM courriers WHERE id = $1::uuid", [id]);
  if (!c || !c.etat_redaction) throw new ErreurRedaction(404, "Courrier introuvable.");
  const { rows: [r] } = await pool.query(
    "SELECT (SELECT courrier_cachet_chemin IS NOT NULL FROM parametres_cabinet WHERE id = 1) AS cachet, " +
    "(SELECT signature_chemin IS NOT NULL FROM utilisateurs WHERE id = $1::uuid) AS signature", [utilisateur.sub]);
  const sortie = (c.options_redaction || {}).sortie || "A";
  return {
    etat_redaction: c.etat_redaction,
    mode: sortie === "B" ? "image" : "manuscrite",
    peut_signer: c.etat_redaction === "a_signer" && !c.annule_le && c.signataire_id === utilisateur.sub,
    cachet_present: !!r.cachet, signature_presente: !!r.signature,
    defauts: await A.defautsUtilisateur(pool, utilisateur.sub),
    pdf_signe: c.pdf_signe, apposition: c.apposition,
  };
}

async function genererSigne(db, c, utilisateur, reglages, filigrane) {
  const sig = await A.construireSignature(db, utilisateur.sub, reglages);
  const o = c.options_redaction || {};
  return genererCourrier({
    gabarit: c.gabarit_code, valeurs: c.contenu, signataireId: c.signataire_id, nref: c.reference,
    sortie: "B", logo: o.logo, decor: o.decor, blocSignature: o.bloc_signature, signature: sig, filigrane,
  }, db);
}

// Aperçu avec filigrane « APERÇU » : n'est jamais enregistré.
async function apercuSignature(utilisateur, id, p) {
  const c = await chargerPourSignature(pool, utilisateur, id, false);
  if (((c.options_redaction || {}).sortie || "A") !== "B") throw new ErreurRedaction(409, "Sortie A : pas d'image à apposer, la lettre se signe à la main.");
  const reglages = A.normaliser(p, await A.defautsUtilisateur(pool, utilisateur.sub));
  return (await genererSigne(pool, c, utilisateur, reglages, "APERÇU — NON SIGNÉ")).pdf;
}

async function signer(utilisateur, id, p) {
  if (p.confirmer !== true) throw new ErreurRedaction(400, "Confirmation requise : cochez la case avant de signer.");
  const client = await pool.connect();
  const deposes = [];
  try {
    await client.query("BEGIN");
    const c = await chargerPourSignature(client, utilisateur, id, true);
    const sortie = (c.options_redaction || {}).sortie || "A";
    const { rows: [{ n }] } = await client.query("SELECT COALESCE(MAX(numero), 0) AS n FROM courrier_versions WHERE courrier_id = $1::uuid", [id]);
    let apposition, pdf = null, pdfChemin = null;
    if (sortie === "B") {
      const reglages = A.normaliser(p, await A.defautsUtilisateur(client, utilisateur.sub));
      const g = await genererSigne(client, c, utilisateur, reglages, null);
      pdf = g.pdf;
      const empreinte = crypto.createHash("sha256").update(pdf).digest("hex");
      pdfChemin = await saveObject(pdf, "courrier/signes/" + id + ".pdf", "application/pdf"); deposes.push(pdfChemin);
      apposition = { mode: "image", empreinte, version: Number(n), pages: g.pages, ...reglages };
      // pièce définitive : GED du dossier, sinon dépôt sur le courrier
      const nom = c.reference + "-signe.pdf";
      if (c.dossier_id) {
        const { classerDansGed } = require("../routes/courriers");
        const docId = await classerDansGed(client, c.dossier_id, nom, pdf, "application/pdf", pdf.length, utilisateur.sub);
        await client.query("UPDATE courriers SET document_id = $1::uuid, numerise = TRUE WHERE id = $2::uuid", [docId, id]);
      } else {
        const chemin = await saveObject(pdf, "courriers/" + id + "/" + Date.now() + "_" + nom, "application/pdf"); deposes.push(chemin);
        await client.query(
          "UPDATE courriers SET fichier_brut_chemin = $1, fichier_brut_nom = $2, fichier_brut_type_mime = 'application/pdf', fichier_brut_taille = $3, numerise = TRUE WHERE id = $4::uuid",
          [chemin, nom, pdf.length, id]);
      }
      await client.query("UPDATE utilisateurs SET apposition_defaut = $1::jsonb WHERE id = $2::uuid", [JSON.stringify(reglages), utilisateur.sub]);
    } else {
      apposition = { mode: "manuscrite", version: Number(n) };
    }
    await client.query(
      "UPDATE courriers SET etat_redaction = 'signee', signee_le = now(), signee_par = $1::uuid, apposition = $2::jsonb, pdf_signe_chemin = $3 WHERE id = $4::uuid",
      [utilisateur.sub, JSON.stringify(apposition), pdfChemin, id]);
    await client.query("COMMIT");
    await logAudit({ utilisateurId: utilisateur.sub, action: "signer_courrier", entite: "courriers", entiteId: id,
      details: { reference: c.reference, mode: apposition.mode, empreinte: apposition.empreinte || null, version: apposition.version } });
    return { id, etat_redaction: "signee", mode: apposition.mode, empreinte: apposition.empreinte || null, pdf_signe: !!pdf };
  } catch (e) {
    await client.query("ROLLBACK");
    await nettoyer(deposes);
    throw e;
  } finally {
    client.release();
  }
}

async function pdfSigne(id) {
  if (!UUID.test(id)) throw new ErreurRedaction(400, "Identifiant invalide.");
  const { rows: [c] } = await pool.query("SELECT reference, pdf_signe_chemin FROM courriers WHERE id = $1::uuid", [id]);
  if (!c || !c.pdf_signe_chemin) throw new ErreurRedaction(404, "Aucun PDF signé pour ce courrier.");
  return { buffer: await readObject(c.pdf_signe_chemin), nom: c.reference + "-signe.pdf" };
}

module.exports = { creer, modifier, soumettre, retourBrouillon, lire, fichierVersion, infoApposition, apercuSignature, signer, pdfSigne, ErreurRedaction };
