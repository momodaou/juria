/**
 * Semaine affichée à l'ouverture du Rôle d'audience (15/11/2026).
 * Le rôle couvre du lundi au vendredi : du lundi au vendredi on ouvre la semaine en cours ; le samedi et le dimanche, la semaine
 * qui vient de se terminer n'a plus d'intérêt, on ouvre directement la semaine suivante (préparation du rôle à venir).
 * Heure du cabinet = heure de Bamako = UTC. Renvoie une date AAAA-MM-JJ (le serveur en déduit le lundi de la semaine).
 */
export function semaineParDefaut(maintenant: Date = new Date()): string {
  const d = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()));
  const jour = d.getUTCDay(); // 0 = dimanche, 6 = samedi
  if (jour === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (jour === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
