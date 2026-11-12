import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';
import { MessagerieService } from './messagerie.service';

export interface Notification {
  id: string;
  type: string;
  niveau: 'information' | 'action' | 'critique';
  texte: string;
  lien: string | null;
  nombre: number;
  a_traiter: boolean;
  cree_le: string;
  lue_le: string | null;
  traitee_le: string | null;
  /** Texte NEUTRE de la bulle du système (jamais de montant ni de contenu) ; null = pas de bulle pour ce type. */
  texte_bulle?: string | null;
  /** Pastille rouge (rejet, contestation, rejets dans un état). */
  rouge?: boolean;
}

export type FiltreNotifications = 'tout' | 'non_lues' | 'a_traiter';

interface Toast { id: string; texte: string; niveau: Notification['niveau']; lien: string | null; }

// Centre de notifications (lot 1, 07/11/2026) : cloche + toast. Reçoit les notifications en direct par le flux SSE
// déjà ouvert pour la messagerie (MessagerieService.notification$), jamais un second flux. Sans zone.js : tout passe par
// des signaux, on réécrit le signal (jamais de mutation d'objet).
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly messagerie = inject(MessagerieService);
  private readonly base = `${environment.apiUrl}/api/notifications`;
  private abonne = false;
  private abonnement: Subscription | null = null;
  private minuteries = new Map<string, ReturnType<typeof setTimeout>>();

  readonly liste = signal<Notification[]>([]);
  readonly nonLues = signal(0);
  readonly aTraiter = signal(0);
  readonly ouvert = signal(false);
  readonly filtre = signal<FiltreNotifications>('tout');
  readonly chargement = signal(false);
  /** Reste-t-il des notifications plus anciennes que celles affichées ? (bouton « Voir plus ») */
  readonly plusAnciennes = signal(false);
  readonly toasts = signal<Toast[]>([]);
  /** Urgences : notifications critiques encore « à traiter » — affichées dans la bannière du haut de l'écran jusqu'à leur traitement. */
  readonly urgences = signal<Notification[]>([]);
  /** Alertes du navigateur (bulles du système) : permission accordée par la personne, jamais imposée. */
  readonly permissionAlertes = signal<'default' | 'granted' | 'denied' | 'indisponible'>(
    typeof Notification === 'undefined' ? 'indisponible' : (Notification.permission as 'default' | 'granted' | 'denied'),
  );

  demarrer(): void {
    if (this.abonne || !this.auth.token) return;
    this.abonne = true;
    this.rafraichirCompteur();
    this.charger();
    this.chargerUrgences();
    this.abonnement = this.messagerie.notification$.subscribe((ev) => {
      if (ev.type === 'notification') this.recevoir(ev.notification as Notification);
      else if (ev.type === 'notification_traitee') this.marquerTraiteeLocalement(ev.id as string);
    });
  }

  arreter(): void {
    this.abonnement?.unsubscribe();
    this.abonnement = null;
    this.abonne = false;
    this.liste.set([]);
    this.nonLues.set(0);
    this.aTraiter.set(0);
    this.ouvert.set(false);
    this.toasts.set([]);
    this.urgences.set([]);
    for (const t of this.minuteries.values()) clearTimeout(t);
    this.minuteries.clear();
  }

  rafraichirCompteur(): void {
    this.http.get<{ non_lues: number; a_traiter: number }>(`${this.base}/compteur`).subscribe({
      next: (c) => { this.nonLues.set(c.non_lues); this.aTraiter.set(c.a_traiter); },
      error: () => {},
    });
  }

  charger(filtre: FiltreNotifications = this.filtre()): void {
    this.filtre.set(filtre);
    this.chargement.set(true);
    this.http.get<Notification[]>(`${this.base}?filtre=${filtre}&limite=40`).subscribe({
      next: (l) => { this.liste.set(l); this.plusAnciennes.set(l.length >= 40); this.chargement.set(false); },
      error: () => this.chargement.set(false),
    });
  }

  /** Charge les 40 notifications précédentes (plus anciennes que la dernière affichée). */
  chargerPlus(): void {
    const derniere = this.liste()[this.liste().length - 1];
    if (!derniere || this.chargement()) return;
    this.chargement.set(true);
    this.http.get<Notification[]>(`${this.base}?filtre=${this.filtre()}&limite=40&avant=${encodeURIComponent(derniere.cree_le)}`).subscribe({
      next: (l) => { this.liste.update((x) => [...x, ...l.filter((n) => !x.some((y) => y.id === n.id))]); this.plusAnciennes.set(l.length >= 40); this.chargement.set(false); },
      error: () => this.chargement.set(false),
    });
  }

  /** Ouvre une notification depuis la page : marquée lue, puis on va à l'écran concerné. */
  ouvrirDepuisPage(n: Notification): void {
    this.marquerLue(n.id);
    if (n.lien) this.router.navigateByUrl(n.lien);
  }

  chargerUrgences(): void {
    this.http.get<Notification[]>(`${this.base}?filtre=a_traiter&niveau=critique&limite=20`).subscribe({
      next: (l) => this.urgences.set(l),
      error: () => {},
    });
  }

  /** Demande la permission des alertes du navigateur (clic de la personne, jamais automatique). */
  activerAlertes(): void {
    if (typeof Notification === 'undefined') return;
    Notification.requestPermission().then((p) => this.permissionAlertes.set(p as 'default' | 'granted' | 'denied'));
  }

  basculer(): void {
    const ouvrir = !this.ouvert();
    this.ouvert.set(ouvrir);
    if (ouvrir) { this.charger(); this.rafraichirCompteur(); }
  }

  fermer(): void { this.ouvert.set(false); }

  private recevoir(n: Notification): void {
    const existante = this.liste().find((x) => x.id === n.id);
    // Mise à jour silencieuse (même date : l'avancement d'une ligne ouverte) : ni toast, ni bulle.
    const silencieuse = !!existante && existante.cree_le === n.cree_le;
    // Remplace la ligne si elle existe déjà (notification regroupée mise à jour), sinon l'ajoute en tête (les plus récentes d'abord).
    this.liste.update((l) => [n, ...l.filter((x) => x.id !== n.id)].sort((a, b) => b.cree_le.localeCompare(a.cree_le)));
    this.rafraichirCompteur();
    this.chargerUrgences();
    if (silencieuse) return;
    // Toast : niveau Action seulement (l'information reste dans la cloche, le critique dans la bannière des urgences).
    if (n.niveau === 'action') this.afficherToast(n);
    this.alerteNavigateur(n);
  }

  /** Une personne est « absente de JURIA » quand l'onglet est caché OU que la fenêtre n'a plus le focus (une autre application est devant). */
  private absent(): boolean {
    return typeof document === 'undefined' || document.hidden || !document.hasFocus();
  }

  // Bulle du système (texte NEUTRE fourni par le serveur) pour les situations graves, seulement si la personne l'a accordée et
  // qu'elle n'est pas devant JURIA.
  private alerteNavigateur(n: Notification): void {
    if (!n.texte_bulle || this.permissionAlertes() !== 'granted' || !this.absent()) return;
    try {
      const bulle = new Notification('JURIA', { body: n.texte_bulle, tag: n.id });
      bulle.onclick = () => { window.focus(); this.ouvrir(n); bulle.close(); };
    } catch { /* alerte indisponible : sans effet */ }
  }

  /** Bouton « Tester l'alerte » : une bulle immédiate pour vérifier que les réglages du navigateur et du système laissent passer. */
  testerAlerte(): void {
    if (this.permissionAlertes() !== 'granted') return;
    try { new Notification('JURIA', { body: 'Les alertes du navigateur fonctionnent.', tag: 'test-alerte' }); } catch { /* sans effet */ }
  }

  /** « Marquer comme traitée » (notifications d'action seulement). */
  marquerTraitee(n: Notification): void {
    this.http.post(`${this.base}/${n.id}/traitee`, {}).subscribe({
      next: () => this.marquerTraiteeLocalement(n.id),
      error: () => {},
    });
  }

  private marquerTraiteeLocalement(id: string): void {
    this.liste.update((l) => l.map((n) => (n.id === id ? { ...n, a_traiter: false } : n)));
    this.urgences.update((l) => l.filter((n) => n.id !== id));
    this.rafraichirCompteur();
  }

  private afficherToast(n: Notification): void {
    const toast: Toast = { id: n.id, texte: n.texte, niveau: n.niveau, lien: n.lien };
    this.toasts.update((t) => [...t.filter((x) => x.id !== n.id), toast].slice(-4));
    clearTimeout(this.minuteries.get(n.id));
    // Les notifications critiques restent plus longtemps à l'écran.
    this.minuteries.set(n.id, setTimeout(() => this.fermerToast(n.id), n.niveau === 'critique' ? 15000 : 7000));
  }

  /** Le toast reste affiché tant que la souris ou le clavier est dessus (critère d'accessibilité : laisser le temps de lire). */
  suspendreToast(id: string): void { clearTimeout(this.minuteries.get(id)); }
  reprendreToast(id: string): void {
    clearTimeout(this.minuteries.get(id));
    this.minuteries.set(id, setTimeout(() => this.fermerToast(id), 7000));
  }

  fermerToast(id: string): void {
    clearTimeout(this.minuteries.get(id));
    this.minuteries.delete(id);
    this.toasts.update((t) => t.filter((x) => x.id !== id));
  }

  ouvrirToast(t: Toast): void {
    this.fermerToast(t.id);
    this.marquerLue(t.id);
    if (t.lien) this.router.navigateByUrl(t.lien);
  }

  marquerLue(id: string): void {
    this.liste.update((l) => l.map((n) => (n.id === id && !n.lue_le ? { ...n, lue_le: new Date().toISOString() } : n)));
    this.http.post(`${this.base}/${id}/lue`, {}).subscribe({ next: () => this.rafraichirCompteur(), error: () => this.rafraichirCompteur() });
  }

  toutLire(): void {
    const maintenant = new Date().toISOString();
    this.liste.update((l) => l.map((n) => (n.lue_le ? n : { ...n, lue_le: maintenant })));
    this.nonLues.set(0);
    this.http.post(`${this.base}/tout-lire`, {}).subscribe({ next: () => this.rafraichirCompteur(), error: () => this.rafraichirCompteur() });
  }

  ouvrir(n: Notification): void {
    this.marquerLue(n.id);
    this.fermer();
    if (n.lien) this.router.navigateByUrl(n.lien);
  }
}
