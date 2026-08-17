import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MessagerieService, Conversation } from '../../core/messagerie.service';

@Component({
  selector: 'app-messagerie',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head"><h1>Messagerie</h1></header>

    <div class="layout">
      <section class="panel liste">
        <div class="liste-head">
          <h3>Conversations</h3>
          <button class="lien" (click)="afficherNouvelle.set(!afficherNouvelle())">
            {{ afficherNouvelle() ? 'Annuler' : '+ Nouvelle' }}
          </button>
        </div>

        @if (afficherNouvelle()) {
          <div class="nouvelle">
            <select class="sel" multiple [(ngModel)]="participantsChoisis" name="participants" size="5">
              @for (u of utilisateurs(); track u.id) {
                @if (u.id !== moi()) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
              }
            </select>
            <input class="sel" [(ngModel)]="titreChoisi" name="titre" placeholder="Titre (optionnel, groupe)" />
            <button class="btn sm" (click)="creer()" [disabled]="participantsChoisis.length === 0">Créer</button>
          </div>
        }

        @if (messagerie.conversations().length) {
          @for (c of messagerie.conversations(); track c.id) {
            <button
              class="conv"
              [class.active]="c.id === messagerie.conversationActiveId()"
              (click)="ouvrir(c)"
            >
              <span class="conv-titre">{{ titreAffiche(c) }}</span>
              @if (c.dernier_message) { <span class="conv-apercu">{{ c.dernier_message }}</span> }
              @if (c.non_lus > 0) { <span class="badge-nonlus">{{ c.non_lus }}</span> }
            </button>
          }
        } @else { <p class="muted">Aucune conversation. Créez-en une pour commencer.</p> }
      </section>

      <section class="panel fil">
        @if (messagerie.conversationActiveId()) {
          <div class="messages" #zoneMessages>
            @for (m of messagerie.messagesActifs(); track m.id) {
              <div class="msg" [class.moi]="m.auteur_id === moi()">
                <span class="msg-auteur">{{ m.auteur }}</span>
                <span class="msg-contenu">{{ m.contenu }}</span>
                <span class="msg-heure">{{ m.cree_le | date: 'HH:mm' }}</span>
              </div>
            }
          </div>
          <div class="saisie">
            <input
              class="sel"
              [(ngModel)]="brouillon"
              name="brouillon"
              placeholder="Écrire un message…"
              (keydown.enter)="envoyer()"
            />
            <button class="btn sm" (click)="envoyer()" [disabled]="!brouillon.trim()">Envoyer</button>
          </div>
        } @else {
          <p class="muted">Sélectionnez une conversation, ou créez-en une nouvelle.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .layout{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start}
    .liste{padding:16px;max-height:78vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
    .liste-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
    .liste-head h3{margin:0}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:13px;padding:0}
    .nouvelle{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px;width:100%}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.sm{padding:8px 12px;font-size:13px}
    .btn:disabled{opacity:.6;cursor:not-allowed}

    .conv{
      display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;
      background:none;border:none;border-radius:10px;padding:10px 12px;cursor:pointer;width:100%;
    }
    .conv:hover{background:var(--light)}
    .conv.active{background:var(--navy);color:#fff}
    .conv-titre{font-weight:600;font-size:13.5px}
    .conv-apercu{font-size:12px;color:var(--grey);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
    .conv.active .conv-apercu{color:#cfd6e3}
    .badge-nonlus{align-self:flex-end;background:var(--gold);color:#1b2436;font-size:11px;font-weight:700;padding:2px 7px;border-radius:999px;margin-top:-18px}

    .fil{padding:16px;min-height:78vh;display:flex;flex-direction:column}
    .messages{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-bottom:10px}
    .msg{display:flex;flex-direction:column;gap:2px;max-width:70%;background:var(--light);border-radius:12px;padding:8px 12px}
    .msg.moi{align-self:flex-end;background:var(--navy);color:#fff}
    .msg-auteur{font-size:11px;font-weight:700;color:var(--gold)}
    .msg.moi .msg-auteur{color:#e8c893}
    .msg-contenu{font-size:14px;white-space:pre-wrap;word-break:break-word}
    .msg-heure{font-size:10.5px;color:var(--grey);align-self:flex-end}
    .msg.moi .msg-heure{color:#cfd6e3}
    .saisie{display:flex;gap:8px;margin-top:10px}
    .saisie .sel{flex:1}
  `],
})
export class MessagerieComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly messagerie = inject(MessagerieService);

  readonly utilisateurs = signal<any[]>([]);
  readonly afficherNouvelle = signal(false);
  participantsChoisis: string[] = [];
  titreChoisi = '';
  brouillon = '';

  moi(): string | undefined {
    return this.auth.utilisateur()?.id;
  }

  ngOnInit(): void {
    this.api.utilisateurs(undefined).subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.messagerie.rafraichirConversations();
  }

  ngOnDestroy(): void {
    // Ferme juste l'écran actif (le flux SSE global reste ouvert pour la pastille).
    this.messagerie.conversationActiveId.set(null);
  }

  titreAffiche(c: Conversation): string {
    if (c.titre) return c.titre;
    return c.autres_participants?.join(', ') || 'Conversation';
  }

  ouvrir(c: Conversation): void {
    this.messagerie.ouvrirConversation(c.id);
  }

  creer(): void {
    this.messagerie.creerConversation(this.participantsChoisis, this.titreChoisi).subscribe({
      next: (c) => {
        this.afficherNouvelle.set(false);
        this.participantsChoisis = [];
        this.titreChoisi = '';
        this.messagerie.rafraichirConversations();
        this.messagerie.ouvrirConversation(c.id);
      },
    });
  }

  // Pas d'ajout optimiste ici : le message revient via le flux SSE (auquel
  // l'auteur est lui-même abonné, comme tout participant) et
  // messagerie.service.ts l'ajoute alors à messagesActifs — évite un
  // doublon si on l'ajoutait aussi ici à la réponse du POST.
  envoyer(): void {
    const contenu = this.brouillon.trim();
    const id = this.messagerie.conversationActiveId();
    if (!contenu || !id) return;
    this.brouillon = '';
    this.messagerie.envoyerMessage(id, contenu).subscribe();
  }
}
