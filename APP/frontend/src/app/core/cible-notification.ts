// Arrivée depuis une notification (07/11/2026) : fait défiler jusqu'à l'élément visé (id HTML) et le surligne quelques secondes.
// Renvoie false si l'élément n'est pas à l'écran (déjà traité, filtré, trop ancien…) : l'écran affiche alors un petit message.
export function viserElement(id: string): boolean {
  const el = document.getElementById(id);
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('cible-notif');
  setTimeout(() => el.classList.remove('cible-notif'), 8000);
  return true;
}
