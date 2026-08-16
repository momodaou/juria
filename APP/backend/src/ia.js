// JURIA — Assistant IA juridique (couche fournisseur).
// En production : Google Gemini / Vertex AI (clé IA_API_KEY).
// En local / démo : repli hors-ligne (aperçu simulé) si aucune clé n'est configurée.
//
// GARDE-FOU : l'IA est un OUTIL D'ASSISTANCE. Toute production est un projet
// à valider par l'avocat (voir cahier des charges). Aucune décision automatique.

async function generer(instruction, texte) {
  const key = process.env.IA_API_KEY;
  const modele = process.env.IA_MODEL || "gemini-1.5-flash";

  if (!key) {
    const apercu = (texte || "").slice(0, 300).replace(/\s+/g, " ").trim();
    return "[Assistant IA non configuré — aperçu simulé pour la démonstration]\n\n" +
      "Contenu fourni : " + apercu + " …\n\n" +
      "Renseignez IA_API_KEY (Google Gemini / Vertex AI) pour activer les résumés réels.\n" +
      "Projet à valider par l'avocat.";
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modele}:generateContent?key=${key}`;
  const prompt = `${instruction}\n\nTEXTE À TRAITER :\n${texte}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!resp.ok) throw new Error("Service IA indisponible (" + resp.status + ")");
  const data = await resp.json();
  const sortie = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
  return sortie || "(réponse vide)";
}

module.exports = { generer };
