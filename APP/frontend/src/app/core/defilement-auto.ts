// Défilement automatique vers un panneau qui vient de s'ouvrir (19/11/2026).
// Quand une action (« Saisir un retour », « Corriger », « Payer »…) ouvre un formulaire sous un `@if`, l'élément est créé APRÈS le
// clic : un `setTimeout(() => ref.scrollIntoView())` lancé dans la méthode du clic s'exécute souvent avant l'affichage (zoneless,
// @ViewChild pas encore à jour) ou vise un autre élément, et l'écran reste où il était. Ici on observe plutôt l'APPARITION du
// panneau dans la page : il suffit de lui poser l'attribut `data-defiler` (les lignes `tr.edition` sont reconnues d'office).
//  - Seulement si l'ouverture suit une action de l'utilisateur (clic ou clavier dans la seconde précédente) : jamais au chargement
//    d'une page, ni quand une liste se rafraîchit.
//  - Rien si le panneau est déjà entièrement visible. Sinon il se place en haut de l'écran (sous une marge de 16 px) ; s'il est
//    plus haut que l'écran, c'est son début qui est visible.

const SELECTEUR = '[data-defiler], tr.edition';
let derniereAction = 0;
let demarre = false;

export function activerDefilementAuto(): void {
  if (demarre || typeof document === 'undefined') return;
  demarre = true;
  const marque = () => { derniereAction = Date.now(); };
  document.addEventListener('click', marque, true);
  document.addEventListener('keydown', marque, true);

  const aDefiler = new Set<HTMLElement>();
  let planifie = false;
  const traiter = () => {
    planifie = false;
    const liste = [...aDefiler].filter((e) => e.isConnected);
    aDefiler.clear();
    // un seul défilement par ouverture : le premier panneau apparu (le plus haut dans la page)
    const cible = liste.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
    if (!cible) return;
    const r = cible.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    cible.style.scrollMarginTop = '16px';
    cible.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const observateur = new MutationObserver((mutations) => {
    if (Date.now() - derniereAction > 1000) return;
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof HTMLElement)) return;
        if (n.matches(SELECTEUR)) aDefiler.add(n);
        n.querySelectorAll<HTMLElement>(SELECTEUR).forEach((e) => aDefiler.add(e));
      });
    }
    // deux images plus tard la mise en page (tableaux, listes qui se rechargent) est stable
    if (aDefiler.size && !planifie) { planifie = true; requestAnimationFrame(() => requestAnimationFrame(traiter)); }
  });
  observateur.observe(document.body, { childList: true, subtree: true });
}
