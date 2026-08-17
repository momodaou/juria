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

  demarrer(): void {
    if (this.source || !this.auth.token) return;
    this.rafraichirConversations();
    this.rafraichirNonLus();

    this.source = new EventSource(`${this.base}/api/messagerie/stream?token=${encodeURIComponent(this.auth.token)}`);
    this.source.onmessage = (ev) => {
      try {
        const { type, message } = JSON.parse(ev.data);
        if (type === 'message') this.recevoirMessage(message as Message);
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
  }

  private recevoirMessage(message: Message): void {
    if (message.conversation_id === this.conversationActiveId()) {
      this.messagesActifs.update((liste) => [...liste, message]);
      // Le message arrive alors que sa conversation est déjà à l'écran :
      // on le marque lu tout de suite, sinon il resterait compté comme
      // non-lu au prochain calcul malgré avoir été vu en direct.
      this.http.post(`${this.base}/api/messagerie/conversations/${message.conversation_id}/lu`, {}).subscribe();
    } else if (message.auteur_id !== this.auth.utilisateur()?.id) {
      this.nonLus.update((n) => n + 1);
    }
    this.rafraichirConversations();
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
    this.http.get<Message[]>(`${this.base}/api/messagerie/conversations/${id}/messages`).subscribe({
      next: (m) => this.messagesActifs.set(m),
    });
    this.http.post(`${this.base}/api/messagerie/conversations/${id}/lu`, {}).subscribe({
      next: () => this.rafraichirConversations(),
    });
  }

  envoyerMessage(conversationId: string, contenu: string): Observable<Message> {
    return this.http.post<Message>(`${this.base}/api/messagerie/conversations/${conversationId}/messages`, { contenu });
  }

  creerConversation(participants: string[], titre?: string, dossierId?: string): Observable<Conversation> {
    return this.http.post<Conversation>(`${this.base}/api/messagerie/conversations`, {
      participants,
      titre: titre || undefined,
      dossier_id: dossierId || undefined,
    });
  }
}
