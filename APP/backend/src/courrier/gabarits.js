// JURIA — Générateur de courriers : gabarits (lot 2, 05/11/2026).
//
// Un gabarit décrit les CASES de saisie d'une lettre (comme les champs d'un acte de l'Atelier d'actes) :
// libellé, nature, bornes, valeur par défaut. La mise en page, elle, est fixe et commune (moteurPdf / moteurDocx) :
// chaque bloc se place toujours au même endroit. Deux gabarits, tirés des lettres types du cabinet :
//   - « standard »     : lettre de correspondance (N/R, affaire facultative, objet, pièces jointes) ;
//   - « constitution » : lettre de constitution (affaire, objet, motif).
// Le N/R n'est jamais saisi : c'est la référence JURIA du courrier (DEP-AAAA-NNNNNN), attribuée à la génération.
const CHAMP_TEXTE = { type: "texte" };
// Champs communs aux gabarits du lot A.
const CHAMP_DATE = { cle: "date", libelle: "Date", ...CHAMP_TEXTE, max: 80, aide: "Laisser vide pour la date du jour (« Bamako, le … »)." };
const CHAMP_PJ = { cle: "pj", libelle: "Pièces jointes (facultatif)", ...CHAMP_TEXTE, max: 300 };
const CHAMP_AMPLIATION = { cle: "ampliation", libelle: "Ampliation (facultatif)", type: "lignes", min: 0, max: 6, maxLigne: 120,
  aide: "Une ligne par destinataire de la copie (ex. : étude d'huissier, confrère)." };
const CHAMP_POLITESSE = (_appel, defaut) => ({ cle: "politesse", libelle: "Formule de politesse", ...CHAMP_TEXTE, max: 500, obligatoire: true, defaut });

const GABARITS = {
  standard: {
    code: "standard",
    nom: "Lettre standard",
    blocSignature: "psc",
    champs: [
      { cle: "date", libelle: "Date", ...CHAMP_TEXTE, max: 80, aide: "Laisser vide pour la date du jour (« Bamako, le … »)." },
      { cle: "destinataire", libelle: "À l'attention de", type: "lignes", min: 1, max: 6, maxLigne: 120, obligatoire: true,
        aide: "Une ligne par ligne : qualité, structure, ville." },
      { cle: "ville", libelle: "Ville (soulignée)", ...CHAMP_TEXTE, max: 80 },
      { cle: "affaire", libelle: "Affaire (facultative)", ...CHAMP_TEXTE, max: 300 },
      { cle: "objet", libelle: "Objet", ...CHAMP_TEXTE, max: 300, obligatoire: true },
      { cle: "precision", libelle: "Précision de l'objet (italique)", ...CHAMP_TEXTE, max: 200 },
      { cle: "appel", libelle: "Formule d'appel", ...CHAMP_TEXTE, max: 120, obligatoire: true, defaut: "Madame, Monsieur," },
      { cle: "paragraphes", libelle: "Corps de la lettre", type: "paragraphes", min: 1, max: 40, maxParagraphe: 5000, obligatoire: true,
        aide: "Une ligne vide entre deux paragraphes ; **texte** met en gras." },
      { cle: "politesse", libelle: "Formule de politesse", ...CHAMP_TEXTE, max: 500, obligatoire: true,
        defaut: "Dans cette attente, nous vous prions d'agréer, Madame, Monsieur, l'expression de nos salutations distinguées." },
      { cle: "pj", libelle: "Pièces jointes (facultatif)", ...CHAMP_TEXTE, max: 300 },
    ],
  },
  constitution: {
    code: "constitution",
    nom: "Lettre de constitution",
    blocSignature: "con",
    champs: [
      { cle: "date", libelle: "Date", ...CHAMP_TEXTE, max: 80, aide: "Laisser vide pour la date du jour (« Bamako, le … »)." },
      { cle: "destinataire", libelle: "À l'attention de", type: "lignes", min: 1, max: 6, maxLigne: 120, obligatoire: true,
        defaut: ["Monsieur le Président", "du Tribunal de Grande Instance", "de la Commune VI du District de Bamako"],
        aide: "Qualité de l'autorité (Président, Procureur, Greffier…) et juridiction." },
      { cle: "affaire", libelle: "Affaire (X c/ Y)", ...CHAMP_TEXTE, max: 300, obligatoire: true,
        aide: "Une procédure peut n'avoir pas de partie adverse : indiquer alors le seul requérant." },
      { cle: "objet", libelle: "Objet", ...CHAMP_TEXTE, max: 300, obligatoire: true, defaut: "Lettre de constitution" },
      { cle: "motif", libelle: "Motif (facultatif)", ...CHAMP_TEXTE, max: 400 },
      { cle: "appel", libelle: "Formule d'appel", ...CHAMP_TEXTE, max: 120, obligatoire: true, defaut: "Monsieur le Président," },
      { cle: "paragraphes", libelle: "Corps de la lettre", type: "paragraphes", min: 1, max: 40, maxParagraphe: 5000, obligatoire: true,
        defaut: [
          "Nous avons l'honneur par la présente, de vous informer de notre constitution pour la défense des intérêts de ….",
          "Afin de nous permettre de pourvoir, au mieux, à la sauvegarde et à la défense desdits intérêts, qu'il vous plaise, Monsieur le Président, nous associer aux suites de la procédure et nous faire notifier les dates d'audience.",
        ] },
      { cle: "politesse", libelle: "Formule de politesse", ...CHAMP_TEXTE, max: 500, obligatoire: true,
        defaut: "Comptant sur votre compréhension habituelle, veuillez recevoir, Monsieur le Président, l'expression de notre profond respect." },
      { cle: "pj", libelle: "Pièces jointes (facultatif)", ...CHAMP_TEXTE, max: 300 },
    ],
  },

  // ── Lot A (13/11/2026) : lettres à la juridiction, tirées des lettres du cabinet. Contenu juridique « à valider par un avocat » ;
  // les « … » sont à remplacer par la saisie. Aucune donnée tirée d'un acte réel n'est conservée dans les valeurs par défaut.
  constitution_appel: {
    code: "constitution_appel",
    nom: "Constitution en appel aux côtés d'un confrère",
    blocSignature: "con",
    champs: [
      CHAMP_DATE,
      { cle: "destinataire", libelle: "À l'attention de", type: "lignes", min: 1, max: 6, maxLigne: 120, obligatoire: true,
        defaut: ["Monsieur le Premier Président", "de la Cour d'Appel de Bamako", "(Chambre …)"], aide: "Qualité de l'autorité et chambre saisie." },
      { cle: "affaire", libelle: "Affaire (appelant c/ intimé)", ...CHAMP_TEXTE, max: 300, obligatoire: true },
      { cle: "nature", libelle: "Nature de l'affaire", ...CHAMP_TEXTE, max: 300, aide: "Ex. : réclamation de droits et dommages-intérêts — Appel." },
      { cle: "objet", libelle: "Objet", ...CHAMP_TEXTE, max: 300, obligatoire: true, defaut: "Constitution" },
      { cle: "appel", libelle: "Formule d'appel", ...CHAMP_TEXTE, max: 120, obligatoire: true, defaut: "Monsieur le Premier Président," },
      { cle: "paragraphes", libelle: "Corps de la lettre", type: "paragraphes", min: 1, max: 40, maxParagraphe: 5000, obligatoire: true,
        defaut: [
          "Nous avons l'honneur de venir, par la présente, vous informer de notre constitution, aux côtés du Cabinet …, en faveur de …, appelant dans l'affaire visée en marge, l'opposant à …, intimé.",
          "Cette affaire fait suite à l'appel interjeté, par acte d'appel n° … du …, contre le jugement n° … rendu le … par le ….",
          "Nous vous prions de bien vouloir nous en donner acte et nous associer aux différents actes de la procédure.",
        ] },
      CHAMP_POLITESSE("Monsieur le Premier Président", "En vous souhaitant bonne réception de la présente, nous vous prions d'agréer, Monsieur le Premier Président, l'expression de nos salutations les plus respectueuses."),
      CHAMP_PJ,
    ],
  },
  constitution_renvoi: {
    code: "constitution_renvoi",
    nom: "Constitution et demande de renvoi pour citation régulière",
    blocSignature: "psc",
    champs: [
      CHAMP_DATE,
      { cle: "destinataire", libelle: "À l'attention de", type: "lignes", min: 1, max: 6, maxLigne: 120, obligatoire: true,
        defaut: ["Monsieur le Président", "du Tribunal de Grande Instance", "de la Commune … du District de Bamako"] },
      { cle: "ville", libelle: "Ville (soulignée)", ...CHAMP_TEXTE, max: 80, defaut: "Bamako" },
      { cle: "affaire", libelle: "Affaire (X c/ Y)", ...CHAMP_TEXTE, max: 300, obligatoire: true },
      { cle: "audience", libelle: "Audience", ...CHAMP_TEXTE, max: 200, aide: "Ex. : TC du 13 décembre 2026 (l'étiquette « Audience » est ajoutée seule)." },
      { cle: "nature", libelle: "Nature de l'affaire", ...CHAMP_TEXTE, max: 300 },
      { cle: "objet", libelle: "Objet", ...CHAMP_TEXTE, max: 300, obligatoire: true, defaut: "Lettre de constitution et renvoi pour citation régulière" },
      { cle: "appel", libelle: "Formule d'appel", ...CHAMP_TEXTE, max: 120, obligatoire: true, defaut: "Monsieur le Président," },
      { cle: "paragraphes", libelle: "Corps de la lettre", type: "paragraphes", min: 1, max: 40, maxParagraphe: 5000, obligatoire: true,
        defaut: [
          "Nous avons l'honneur de vous informer de notre constitution pour assurer la défense des intérêts de … dans le cadre de l'affaire visée ci-dessus.",
          "Par la présente, nous sollicitons le renvoi de l'évocation de cette affaire pour citation régulière de notre client. En effet, celui-ci n'est pas domicilié au Mali mais à l'adresse suivante : ….",
        ] },
      CHAMP_POLITESSE("Monsieur le Président", "Dans cette attente, et vous souhaitant bonne réception de la présente, nous vous prions de recevoir, Monsieur le Président, nos salutations distinguées."),
      CHAMP_PJ,
    ],
  },
  declaration_appel: {
    code: "declaration_appel",
    nom: "Déclaration d'appel au greffier en chef",
    blocSignature: "con",
    champs: [
      CHAMP_DATE,
      { cle: "destinataire", libelle: "À l'attention de", type: "lignes", min: 1, max: 6, maxLigne: 120, obligatoire: true,
        defaut: ["Madame la Greffière en Cheffe", "du Tribunal de Grande Instance de la Commune … du District de Bamako"],
        aide: "Écrire « Madame … » ou « Monsieur … » : la formule d'appel et de politesse s'accorde au destinataire." },
      { cle: "affaire", libelle: "Affaire (appelant c/ intimé)", ...CHAMP_TEXTE, max: 300, obligatoire: true },
      { cle: "nature", libelle: "Nature de l'affaire", ...CHAMP_TEXTE, max: 300 },
      { cle: "objet", libelle: "Objet", ...CHAMP_TEXTE, max: 300, obligatoire: true, defaut: "Déclaration d'appel" },
      { cle: "appel", libelle: "Formule d'appel", ...CHAMP_TEXTE, max: 120, appelAuto: true,
        aide: "Laisser vide : « Chère Maître, » / « Cher Maître, » selon le destinataire." },
      { cle: "paragraphes", libelle: "Corps de la lettre", type: "paragraphes", min: 1, max: 40, maxParagraphe: 5000, obligatoire: true,
        defaut: [
          "Nous venons par la présente interjeter appel contre l'ordonnance n° … rendue par votre juridiction en son audience du … dans l'affaire citée en objet, au nom et pour le compte de … (appelant : forme, capital, siège, représentant), ayant pour conseil la SCPA JFC AVOCATS, plaidant par l'organe de Maître …, opposé à … (intimé : identité complète, domicile, conseils et domicile élu).",
          "Ladite ordonnance a fait l'objet d'une signification-commandement de payer en date du … par l'Étude de Maître …, Huissier-Commissaire de Justice. (supprimer ce paragraphe s'il n'y a pas eu de signification)",
          "Laquelle affaire doit être portée devant la Cour d'Appel de Bamako pour l'examen de ladite ordonnance.",
          "Nous vous précisons qu'au regard de l'article 172 de l'Acte Uniforme portant Organisation des Procédures Simplifiées de Recouvrement et des Voies d'Exécution (AUPSRVE) : « Le délai pour faire appel ainsi que la déclaration d'appel sont suspensifs d'exécution sauf décision contraire spécialement motivée par la juridiction compétente ». (supprimer ce paragraphe s'il ne s'applique pas)",
          "L'appelant se réserve le droit de produire les moyens à l'appui de son appel par devant qui de droit.",
        ] },
      { cle: "politesse", libelle: "Formule de politesse", ...CHAMP_TEXTE, max: 500, obligatoire: true,
        defaut: "En espérant que vous en prendrez acte, recevez {{appel}}, l'expression de nos salutations distinguées.",
        aide: "{{appel}} est remplacé par la formule d'appel (sans la virgule)." },
      CHAMP_PJ,
    ],
  },
  reponse_sommation: {
    code: "reponse_sommation",
    nom: "Réponse à une sommation de payer",
    blocSignature: "con",
    champs: [
      CHAMP_DATE,
      { cle: "destinataire", libelle: "À l'attention de", type: "lignes", min: 1, max: 6, maxLigne: 120, obligatoire: true,
        aide: "Le créancier qui a fait délivrer la sommation (qualité, structure, ville)." },
      { cle: "ville", libelle: "Ville (soulignée)", ...CHAMP_TEXTE, max: 80 },
      { cle: "objet", libelle: "Objet", ...CHAMP_TEXTE, max: 300, obligatoire: true,
        defaut: "Réponse à la sommation de payer adressée en date du … à …." },
      { cle: "appel", libelle: "Formule d'appel", ...CHAMP_TEXTE, max: 120, obligatoire: true, defaut: "Madame, Monsieur," },
      { cle: "paragraphes", libelle: "Corps de la lettre", type: "paragraphes", min: 1, max: 40, maxParagraphe: 5000, obligatoire: true,
        defaut: [
          "Nous vous informons que nous sommes les conseils de …, (qualité : locataire, débiteur…), suivant … (contrat, titre) signé en date du ….",
          "À la requête de …, et par le ministère de …, notre client s'est vu signifier en date du …, une sommation de payer portant sur une somme totale de … francs CFA, frais compris, dont … francs CFA en principal, au titre de ….",
          "Nous tenons à vous informer que, dès la réception de cet acte, il y a été porté toutes réserves, le montant réclamé étant formellement contesté et sujet à vérification.",
          "Cette contestation repose sur les éléments objectifs qui suivent : ….",
          "En conséquence, et préalablement à toute suite, nous vous prions de bien vouloir nous communiquer un relevé actualisé, détaillé et contradictoire des sommes réclamées, faisant apparaître les paiements déjà réglés par notre client et les pièces justificatives correspondantes, et de justifier le fondement juridique et/ou contractuel des montants appliqués.",
          "Dans l'attente de recevoir ces éléments, le montant réclamé demeure contesté en son quantum.",
        ] },
      { cle: "politesse", libelle: "Formule de politesse", ...CHAMP_TEXTE, max: 500, obligatoire: true,
        defaut: "Nous vous prions d'agréer, Madame, Monsieur, l'expression de notre considération distinguée." },
      CHAMP_PJ,
      CHAMP_AMPLIATION,
    ],
  },
};

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

// « Bamako, le 5 novembre 2026 » (le 1er du mois s'écrit « 1er »)
function dateDuJour(d = new Date()) {
  const jour = Number(new Intl.DateTimeFormat("fr-FR", { day: "numeric", timeZone: "Africa/Bamako" }).format(d));
  const mois = Number(new Intl.DateTimeFormat("fr-FR", { month: "numeric", timeZone: "Africa/Bamako" }).format(d));
  const annee = new Intl.DateTimeFormat("fr-FR", { year: "numeric", timeZone: "Africa/Bamako" }).format(d);
  return "Bamako, le " + (jour === 1 ? "1er" : jour) + " " + MOIS[mois - 1] + " " + annee;
}

const gabarit = (code) => GABARITS[code] || null;
const listerGabarits = () => Object.values(GABARITS).map((g) => ({ code: g.code, nom: g.nom, bloc_signature: g.blocSignature, champs: g.champs }));

function valeursParDefaut(code) {
  const g = gabarit(code);
  if (!g) return null;
  const v = {};
  g.champs.forEach((c) => { if (c.defaut !== undefined) v[c.cle] = Array.isArray(c.defaut) ? [...c.defaut] : c.defaut; });
  return v;
}

// Texte propre : sans caractères de contrôle, espaces superflus réduits ; sauts de ligne conservés si demandé.
const nettoyer = (t, multiligne = false) => {
  const s = String(t == null ? "" : t).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return multiligne ? s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").trim() : s.replace(/\s+/g, " ").trim();
};
// Un « ** » orphelin ferait passer tout le reste de la lettre en gras : on retire les marqueurs si leur nombre est impair.
const equilibrerGras = (t) => ((t.match(/\*\*/g) || []).length % 2 ? t.replace(/\*\*/g, "") : t);

// Valide et normalise les valeurs saisies d'une lettre. Renvoie { contenu, erreurs: [{ cle, message }] }.
function validerContenu(code, valeurs) {
  const g = gabarit(code);
  if (!g) return { contenu: null, erreurs: [{ cle: "gabarit", message: "Gabarit inconnu." }] };
  const brut = { ...valeursParDefaut(code), ...(valeurs || {}) };
  const contenu = {}, erreurs = [];
  const erreur = (cle, message) => erreurs.push({ cle, message });
  g.champs.forEach((c) => {
    const v = brut[c.cle];
    if (c.type === "lignes") {
      const lignes = (Array.isArray(v) ? v : String(v == null ? "" : v).split("\n")).map((l) => nettoyer(l)).filter(Boolean);
      if (c.obligatoire && lignes.length < (c.min || 1)) return erreur(c.cle, c.libelle + " : au moins " + (c.min || 1) + " ligne.");
      if (lignes.length > c.max) return erreur(c.cle, c.libelle + " : " + c.max + " lignes au maximum.");
      if (lignes.some((l) => l.length > c.maxLigne)) return erreur(c.cle, c.libelle + " : " + c.maxLigne + " caractères au maximum par ligne.");
      contenu[c.cle] = lignes;
    } else if (c.type === "paragraphes") {
      const paras = (Array.isArray(v) ? v : String(v == null ? "" : v).split(/\n\s*\n/)).map((p) => equilibrerGras(nettoyer(p, true).replace(/\n/g, " "))).filter(Boolean);
      if (c.obligatoire && paras.length < (c.min || 1)) return erreur(c.cle, c.libelle + " : au moins un paragraphe.");
      if (paras.length > c.max) return erreur(c.cle, c.libelle + " : " + c.max + " paragraphes au maximum.");
      if (paras.some((p) => p.length > c.maxParagraphe)) return erreur(c.cle, c.libelle + " : " + c.maxParagraphe + " caractères au maximum par paragraphe.");
      contenu[c.cle] = paras;
    } else {
      const t = nettoyer(v);
      if (c.obligatoire && !t) return erreur(c.cle, c.libelle + " : obligatoire.");
      if (t.length > c.max) return erreur(c.cle, c.libelle + " : " + c.max + " caractères au maximum.");
      contenu[c.cle] = t;
    }
  });
  // Formule d'appel accordée au destinataire (gabarits « appelAuto ») : « Chère Maître, » pour Madame, « Cher Maître, » sinon.
  const champAppel = g.champs.find((c) => c.appelAuto);
  if (champAppel && !contenu[champAppel.cle]) {
    const premiere = (contenu.destinataire || [])[0] || "";
    contenu[champAppel.cle] = /^\s*madame\b/i.test(premiere) ? "Chère Maître," : "Cher Maître,";
  }
  if (contenu.appel && typeof contenu.politesse === "string" && contenu.politesse.includes("{{appel}}"))
    contenu.politesse = contenu.politesse.replace(/\{\{appel\}\}/g, contenu.appel.replace(/[,\s]+$/, ""));
  return { contenu, erreurs };
}

// Nom et mention de signature d'un associé : « nom de signature » saisi dans les réglages, sinon « Prénom NOM ».
function signataireAffiche(u) {
  const nom = (u.nom_signature && u.nom_signature.trim()) || (u.prenom + " " + String(u.nom || "").toUpperCase()).trim();
  const qualite = (u.qualite_signature && u.qualite_signature.trim()) || ((u.role === "associe" || u.role === "associe_fondateur") ? "Avocat associé" : "");
  return { nom, qualite };
}

// Lettre prête pour les moteurs de mise en page.
function composerLettre(code, contenu, { nref, signataire, blocSignature, dateJour } = {}) {
  const g = gabarit(code);
  if (!g) throw new Error("Gabarit inconnu : " + code);
  return {
    date: contenu.date || dateJour || dateDuJour(),
    destinataire: contenu.destinataire,
    ville: contenu.ville || "",
    nref,
    affaire: contenu.affaire || "",
    audience: contenu.audience || "",
    nature: contenu.nature || "",
    objet: contenu.objet,
    precision: contenu.precision || "",
    motif: contenu.motif || "",
    appel: contenu.appel,
    paragraphes: contenu.paragraphes,
    politesse: contenu.politesse,
    signature: { bloc: blocSignature || g.blocSignature, nom: signataire.nom, qualite: signataire.qualite },
    pj: contenu.pj || "",
    ampliation: contenu.ampliation || [],
  };
}

module.exports = { GABARITS, gabarit, listerGabarits, valeursParDefaut, validerContenu, composerLettre, signataireAffiche, dateDuJour };
