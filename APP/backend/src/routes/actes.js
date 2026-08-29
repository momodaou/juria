// JURIA — Atelier d'actes : génération d'actes à partir d'un modèle (fusion
// avec les données du dossier/client et l'en-tête du cabinet) ou d'un brouillon IA.
// Le résultat est enregistré dans la GED (table documents, statut « brouillon »).
const express = require("express");
const { pool } = require("../db");
const { saveObject } = require("../storage");
const { generer } = require("../ia");
const { requirePermission } = require("../permissions");
const router = express.Router();

function fmtDate(d) {
  return new Date(d).toLocaleDateString("fr-FR");
}

// Modèles disponibles (fusion de champs {{...}}, pas de moteur de template externe
// pour rester sans dépendance supplémentaire).
const MODELES = {
  mise_en_demeure: {
    nom: "Mise en demeure (recouvrement)",
    categorie: "correspondance",
    corps: (ctx) => `${ctx.cabinet.raison_sociale}
${ctx.cabinet.forme || ""}
${ctx.cabinet.adresse || ""} — ${ctx.cabinet.telephone || ""} — ${ctx.cabinet.email || ""}
RCCM ${ctx.cabinet.rccm || "—"} · NIF ${ctx.cabinet.nif || "—"}

Bamako, le ${ctx.date}

À l'attention de : ${ctx.partieAdverse || ctx.client}
Réf. dossier : ${ctx.dossier.numero}

Objet : MISE EN DEMEURE — ${ctx.dossier.objet || ctx.dossier.intitule}

Maître,

Nous avons été saisis par notre client ${ctx.client} dans le cadre du dossier référencé en objet.

Malgré nos précédentes relances, nous constatons à ce jour l'absence de règlement de la créance
due, ainsi que le rappellent les pièces du dossier.

En conséquence, nous vous mettons en demeure, par la présente, de bien vouloir régulariser
votre situation dans un délai de QUINZE (15) jours à compter de la réception des présentes,
faute de quoi nous serons contraints d'engager toute voie de droit utile, y compris judiciaire,
sans autre avis ni sommation, aux frais, risques et périls du débiteur.

Sous toutes réserves.

Visas : Code civil (obligations), Acte uniforme OHADA portant organisation des procédures
simplifiées de recouvrement et des voies d'exécution.

${ctx.avocat}
${ctx.cabinet.forme || "Avocat au Barreau du Mali"}`,
  },
  lettre_mission: {
    nom: "Lettre de mission / d'engagement",
    categorie: "correspondance",
    corps: (ctx) => `${ctx.cabinet.raison_sociale}
${ctx.cabinet.adresse || ""} — ${ctx.cabinet.telephone || ""} — ${ctx.cabinet.email || ""}

Bamako, le ${ctx.date}

À l'attention de : ${ctx.client}
Réf. dossier : ${ctx.dossier.numero}

Objet : Lettre de mission — ${ctx.dossier.intitule}

Cher client, chère cliente,

Nous vous confirmons par la présente les termes de notre mission dans le dossier référencé
en objet : ${ctx.dossier.objet || "à préciser"}.

Cette lettre a pour objet de préciser l'étendue de notre mandat, les modalités d'intervention
du cabinet ${ctx.cabinet.raison_sociale}, ainsi que les conditions de facturation applicables
(mode d'honoraires : ${ctx.dossier.mode_honoraires || "à convenir"}).

Nous vous remercions de nous retourner un exemplaire signé pour accord.

${ctx.avocat}
Pour ${ctx.cabinet.raison_sociale}`,
  },
  demande_provision: {
    nom: "Demande de provision",
    categorie: "correspondance",
    corps: (ctx) => `${ctx.cabinet.raison_sociale}
Compte CARPA : ${ctx.cabinet.compte_carpa || "—"}

Bamako, le ${ctx.date}

À l'attention de : ${ctx.client}
Réf. dossier : ${ctx.dossier.numero} — ${ctx.dossier.intitule}

Objet : Demande de provision sur honoraires et frais

Cher client, chère cliente,

Dans le cadre du suivi de votre dossier, nous vous prions de bien vouloir procéder au
versement d'une provision destinée à couvrir les diligences à venir ainsi que les frais
et débours prévisibles (huissier, greffe, expertise, le cas échéant).

Nous restons à votre disposition pour toute précision.

${ctx.avocat}`,
  },
  conclusions_trame: {
    nom: "Trame de conclusions",
    categorie: "conclusions",
    corps: (ctx) => `POUR : ${ctx.client}
CONTRE : ${ctx.partieAdverse || "—"}

CONCLUSIONS

Dossier : ${ctx.dossier.numero} — ${ctx.dossier.intitule}
Juridiction : ${ctx.dossier.juridiction || "—"}

PLAISE À LA JURIDICTION

RAPPEL DES FAITS ET DE LA PROCÉDURE
[à compléter]

DISCUSSION
[à compléter]

PAR CES MOTIFS

Il est demandé à la juridiction de :
- [à compléter]

SOUS TOUTES RÉSERVES

${ctx.avocat}
${ctx.cabinet.forme || "Avocat au Barreau du Mali"}
Fait à Bamako, le ${ctx.date}`,
  },
};

// GET /api/actes/modeles
router.get("/modeles", requirePermission("actes.consulter"), (req, res) => {
  res.json(Object.entries(MODELES).map(([code, m]) => ({ code, nom: m.nom, categorie: m.categorie })));
});

async function construireContexte(dossierId, avocatNom) {
  const d = await pool.query(
    `SELECT d.*, COALESCE(NULLIF(c.denomination, ''), c.prenom || ' ' || c.nom) AS client_nom
     FROM dossiers d JOIN clients c ON c.id = d.client_id WHERE d.id = $1`,
    [dossierId]
  );
  if (!d.rows[0]) return null;
  const dossier = d.rows[0];
  const partie = await pool.query(
    `SELECT denomination FROM dossier_parties WHERE dossier_id = $1 AND role = 'adverse' LIMIT 1`,
    [dossierId]
  );
  const cab = await pool.query("SELECT * FROM parametres_cabinet WHERE id = 1");
  return {
    date: fmtDate(new Date()),
    client: dossier.client_nom,
    partieAdverse: partie.rows[0]?.denomination || null,
    dossier,
    cabinet: cab.rows[0] || {},
    avocat: avocatNom,
  };
}

// POST /api/actes/generer
// { dossier_id, mode: 'modele'|'ia', modele_code?, instructions_ia? }
router.post("/generer", requirePermission("actes.generer"), async (req, res) => {
  const b = req.body || {};
  if (!b.dossier_id) return res.status(400).json({ error: "dossier_id requis" });
  try {
    const avocat = await pool.query("SELECT prenom || ' ' || nom AS nom FROM utilisateurs WHERE id = $1", [req.user.sub]);
    const ctx = await construireContexte(b.dossier_id, avocat.rows[0]?.nom || "");
    if (!ctx) return res.status(404).json({ error: "Dossier introuvable" });

    let texte, nom, categorie;
    if (b.mode === "ia") {
      if (!b.instructions_ia) return res.status(400).json({ error: "instructions_ia requis en mode IA" });
      const instruction =
        "Tu es un assistant juridique pour un cabinet d'avocats au Mali (droit national et OHADA). " +
        "Rédige un projet d'acte en français, professionnel et sobre, sur la base des instructions et du contexte " +
        "du dossier fournis. N'invente aucun fait non mentionné. Termine impérativement par la mention : " +
        "« Projet à valider par l'avocat. »";
      const contexte =
        `Cabinet : ${ctx.cabinet.raison_sociale || ""}\n` +
        `Dossier : ${ctx.dossier.numero} — ${ctx.dossier.intitule}\nObjet : ${ctx.dossier.objet || "—"}\n` +
        `Client : ${ctx.client}\nPartie adverse : ${ctx.partieAdverse || "—"}\n\nInstructions : ${b.instructions_ia}`;
      texte = await generer(instruction, contexte);
      nom = `IA — ${b.instructions_ia.slice(0, 60)}`;
      categorie = "note_interne";
    } else {
      const modele = MODELES[b.modele_code];
      if (!modele) return res.status(400).json({ error: "Modèle inconnu" });
      texte = modele.corps(ctx);
      nom = `${modele.nom} — ${ctx.dossier.numero}`;
      categorie = modele.categorie;
    }

    const dest = `${b.dossier_id}/${Date.now()}_${nom}.txt`.replace(/\s+/g, "_");
    const chemin = await saveObject(Buffer.from(texte, "utf-8"), dest, "text/plain");
    const ins = await pool.query(
      `INSERT INTO documents (dossier_id, nom, categorie, statut, chemin_storage, type_mime, taille_octets, auteur_id, ocr_texte)
       VALUES ($1,$2,$3,'brouillon',$4,'text/plain',$5,$6,$7)
       RETURNING id, nom, categorie, statut, cree_le`,
      [b.dossier_id, nom, categorie, chemin, Buffer.byteLength(texte, "utf-8"), req.user.sub, texte]
    );
    res.status(201).json({ ...ins.rows[0], texte });
  } catch (e) {
    console.error(e);
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
