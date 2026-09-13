import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export interface Conversation {
  id: string;
  titre: string | null;
  dossier_id: string | null;
  autres_participants: string[] | null;
  autres_participants_ids: string[] | null;
  dernier_message: string | null;
  dernier_message_le: string | null;
  non_lus: number;
}

export interface Message {
  id: string;
  conversation_id?: string;
  contenu: string;
  cree_le: string;
  auteur_id: string;
  auteur: string;
}

export interface Lecture {
  utilisateur_id: string;
  dernier_lu_le: string | null;
}

const DELAI_EXPIRATION_FRAPPE_MS = 5000;
const DELAI_MIN_ENTRE_ENVOIS_FRAPPE_MS = 3000;

// Service unique (providedIn: 'root') : un seul flux SSE partagé pour toute
// l'application, ouvert une fois après connexion — pas une connexion par
// écran. Alimente à la fois la pastille de non-lus de la barre latérale et
// l'écran Messagerie s'il est ouvert.
@Injectable({ providedIn: 'root' })
export class MessagerieService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly base = environment.apiUrl;

  private source: EventSource | null = null;

  readonly conversations = signal<Conversation[]>([]);
  readonly nonLus = signal(0);
  /** Messages de la conversation actuellement ouverte à l'écran (si l'écran Messagerie est affiché). */
  readonly conversationActiveId = signal<string | null>(null);
  readonly messagesActifs = signal<Message[]>([]);
  /** Y a-t-il des messages plus anciens que ceux chargés (13/09/2026, pagination) ? */
  readonly plusAnciensDisponibles = signal(false);
  private chargementPlusAnciensEnCours = false;

  // Accusé de lecture (13/09/2026) : état de lecture des AUTRES
  // participants de la conversation active — un message de moi est « lu »
  // une fois que tous l'ont dépassé. Non tenu à jour pour les conversations
  // fermées (pas affiché, pas la peine).
  readonly lectureActive = signal<Lecture[]>([]);

  // Indicateur de frappe (13/09/2026) : noms des personnes actuellement en
  // train d'écrire dans la conversation active. Chaque entrée s'efface
  // toute seule après quelques secondes sans nouvel événement — pas besoin
  // d'un événement « a arrêté d'écrire » fiable.
  readonly frappeurs = signal<string[]>([]);
  private minuteriesFrappe = new Map<string, ReturnType<typeof setTimeout>>();
  private dernierEnvoiFrappe = 0;

  demarrer(): void {
    if (this.source || !this.auth.token) return;
    this.rafraichirConversations();
    this.rafraichirNonLus();

    this.source = new EventSource(`${this.base}/api/messagerie/stream?token=${encodeURIComponent(this.auth.token)}`);
    this.source.onmessage = (ev) => {
      try {
        const evenement = JSON.parse(ev.data);
        if (evenement.type === 'message') this.recevoirMessage(evenement.message as Message);
        else if (evenement.type === 'lu') this.recevoirLecture(evenement);
        else if (evenement.type === 'frappe') this.recevoirFrappe(evenement);
      } catch {
        /* ping ou trame ignorée */
      }
    };
    // EventSource se reconnecte tout seul en cas de coupure ; rien à faire ici.
  }

  arreter(): void {
    this.source?.close();
    this.source = null;
    this.conversations.set([]);
    this.nonLus.set(0);
    this.conversationActiveId.set(null);
    this.messagesActifs.set([]);
    this.lectureActive.set([]);
    this.frappeurs.set([]);
    for (const t of this.minuteriesFrappe.values()) clearTimeout(t);
    this.minuteriesFrappe.clear();
  }

  private recevoirMessage(message: Message): void {
    if (message.conversation_id === this.conversationActiveId()) {
      this.messagesActifs.update((liste) => [...liste, message]);
      // Le message arrive alors que sa conversation est déjà à l'écran :
      // on le marque lu tout de suite, sinon il resterait compté comme
      // non-lu au prochain calcul malgré avoir été vu en direct.
      this.marquerLu(message.conversation_id!);
    } else if (message.auteur_id !== this.auth.utilisateur()?.id) {
      this.nonLus.update((n) => n + 1);
    }
    this.rafraichirConversations();
  }

  private recevoirLecture(evenement: { conversation_id: string; utilisateur_id: string; lu_le: string }): void {
    if (evenement.conversation_id !== this.conversationActiveId()) return;
    this.lectureActive.update((liste) => {
      const sansCetUtilisateur = liste.filter((l) => l.utilisateur_id !== evenement.utilisateur_id);
      return [...sansCetUtilisateur, { utilisateur_id: evenement.utilisateur_id, dernier_lu_le: evenement.lu_le }];
    });
  }

  private recevoirFrappe(evenement: { conversation_id: string; auteur_id: string; auteur: string }): void {
    if (evenement.conversation_id !== this.conversationActiveId()) return;
    if (evenement.auteur_id === this.auth.utilisateur()?.id) return;
    if (!this.frappeurs().includes(evenement.auteur)) {
      this.frappeurs.update((liste) => [...liste, evenement.auteur]);
    }
    const existant = this.minuteriesFrappe.get(evenement.auteur);
    if (existant) clearTimeout(existant);
    this.minuteriesFrappe.set(
      evenement.auteur,
      setTimeout(() => {
        this.frappeurs.update((liste) => liste.filter((n) => n !== evenement.auteur));
        this.minuteriesFrappe.delete(evenement.auteur);
      }, DELAI_EXPIRATION_FRAPPE_MS)
    );
  }

  /** Message de MOI considéré lu par tous les autres participants (13/09/2026). */
  estLuParTous(message: Message): boolean {
    const autres = this.lectureActive();
    if (!autres.length) return false;
    return autres.every((l) => !!l.dernier_lu_le && l.dernier_lu_le >= message.cree_le);
  }

  rafraichirConversations(): void {
    this.http.get<Conversation[]>(`${this.base}/api/messagerie/conversations`).subscribe({
      next: (c) => this.conversations.set(c),
      error: () => {},
    });
  }

  rafraichirNonLus(): void {
    this.http.get<{ total: number }>(`${this.base}/api/messagerie/non-lus`).subscribe({
      next: (r) => this.nonLus.set(r.total),
      error: () => {},
    });
  }

  ouvrirConversation(id: string): void {
    this.conversationActiveId.set(id);
    this.messagesActifs.set([]);
    this.lectureActive.set([]);
    this.frappeurs.set([]);
    this.plusAnciensDisponibles.set(false);
    this.http.get<Message[]>(`${this.base}/api/messagerie/conversations/${id}/messages`).subscribe({
      next: (m) => { this.messagesActifs.set(m); this.plusAnciensDisponibles.set(m.length >= 50); },
    });
    this.http.get<Lecture[]>(`${this.base}/api/messagerie/conversations/${id}/lecture`).subscribe({
      next: (l) => this.lectureActive.set(l),
    });
    this.marquerLu(id);
  }

  private marquerLu(id: string): void {
    this.http.post(`${this.base}/api/messagerie/conversations/${id}/lu`, {}).subscribe({
      next: () => this.rafraichirConversations(),
    });
  }

  // Pagination (13/09/2026, gap comblé — le serveur supportait déjà `avant`
  // depuis la conception initiale, aucune UI ne s'en servait). Charge la
  // page de 50 messages précédant le plus ancien déjà affiché, préservée en
  // tête de liste. Idempotent pendant un chargement déjà en cours (double
  // clic) via un simple drapeau, pas un signal (état interne, pas affiché).
  chargerMessagesPlusAnciens(): void {
    const id = this.conversationActiveId();
    const plusAncien = this.messagesActifs()[0];
    if (!id || !plusAncien || this.chargementPlusAnciensEnCours) return;
    this.chargementPlusAnciensEnCours = true;
    this.http
      .get<Message[]>(`${this.base}/api/messagerie/conversations/${id}/messages?avant=${encodeURIComponent(plusAncien.cree_le)}`)
      .subscribe({
        next: (m) => {
          this.chargementPlusAnciensEnCours = false;
          this.plusAnciensDisponibles.set(m.length >= 50);
          if (m.length) this.messagesActifs.update((liste) => [...m, ...liste]);
        },
        error: () => { this.chargementPlusAnciensEnCours = false; },
      });
  }

  envoyerMessage(conversationId: string, contenu: string): Observable<Message> {
    return this.http.post<Message>(`${this.base}/api/messagerie/conversations/${conversationId}/messages`, { contenu });
  }

  // Indicateur de frappe : limité à un envoi au plus toutes les ~3s pendant
  // la saisie (throttlé ici, une seule fois pour les deux écrans qui
  // l'appellent — widget et plein écran).
  signalerFrappe(conversationId: string): void {
    const maintenant = Date.now();
    if (maintenant - this.dernierEnvoiFrappe < DELAI_MIN_ENTRE_ENVOIS_FRAPPE_MS) return;
    this.dernierEnvoiFrappe = maintenant;
    this.http.post(`${this.base}/api/messagerie/conversations/${conversationId}/frappe`, {}).subscribe({ error: () => {} });
  }

  creerConversation(participants: string[], titre?: string, dossierId?: string): Observable<Conversation> {
    return this.http.post<Conversation>(`${this.base}/api/messagerie/conversations`, {
      participants,
      titre: titre || undefined,
      dossier_id: dossierId || undefined,
    });
  }
}
