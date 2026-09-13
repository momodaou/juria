import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { MessagerieService, Conversation } from './messagerie.service';

// Widget flottant de messagerie (19/08/2026) — pour discuter en continu
// sans quitter l'écran en cours, contrairement à l'écran dédié /messagerie
// (plein écran, toujours conservé pour plus de confort si besoin). Rendu
// une seule fois dans app.component.ts (persiste à travers la navigation),
// réutilise MessagerieService tel quel (déjà providedIn: 'root', déjà
// partagé pour toute l'application) — pas de nouvel état à gérer, juste
// une couche d'affichage compacte par-dessus.
@Component({
  selector: 'app-messagerie-widget',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    @if (visible()) {
      <button type="button" class="mw-bulle" (click)="basculer()" [title]="ouvert() ? 'Fermer la messagerie' : 'Ouvrir la messagerie'">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        @if (messagerie.nonLus() > 0) { <span class="mw-badge">{{ messagerie.nonLus() }}</span> }
      </button>

      @if (ouvert()) {
        <div class="mw-panneau">
          <div class="mw-entete">
            @if (vue() === 'fil') {
              <button type="button" class="mw-icon-btn" (click)="retourListe()" title="Retour aux conversations">←</button>
              @if (enLigneConversationActive(); as enLigne) {
                <span class="mw-point" [class.mw-point-off]="!enLigne" [title]="enLigne ? 'En ligne' : 'Hors ligne'"></span>
              }
              <span class="mw-titre">{{ titreActif() }}</span>
            } @else {
              <span class="mw-titre">Messagerie</span>
            }
            <div class="mw-entete-actions">
              @if (vue() === 'liste' && auth.peut('messagerie.creer_conversation')) {
                <button type="button" class="mw-icon-btn" title="Nouvelle conversation" (click)="afficherNouvelle.set(!afficherNouvelle())">+</button>
              }
              <button type="button" class="mw-icon-btn" title="Ouvrir en plein écran" (click)="ouvrirPageComplete()">⤢</button>
              <button type="button" class="mw-icon-btn" title="Fermer" (click)="fermer()">✕</button>
            </div>
          </div>

          @if (vue() === 'liste') {
            @if (afficherNouvelle()) {
              <div class="mw-nouvelle">
                <select class="mw-input" multiple [(ngModel)]="participantsChoisis" name="mwParticipants" size="4">
                  @for (u of utilisateurs(); track u.id) {
                    @if (u.id !== moi()) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
                  }
                </select>
                <input class="mw-input" [(ngModel)]="titreChoisi" name="mwTitre" placeholder="Titre (facultatif, groupe)" />
                <button type="button" class="mw-btn" (click)="creer()" [disabled]="!participantsChoisis.length">Créer</button>
              </div>
            }
            <div class="mw-liste">
              @if (messagerie.conversations().length) {
                @for (c of messagerie.conversations(); track c.id) {
                  <button type="button" class="mw-conv" (click)="ouvrir(c)">
                    <span class="mw-conv-titre">
                      @if (enLigneConversation(c); as enLigne) {
                        <span class="mw-point" [class.mw-point-off]="!enLigne"></span>
                      }
                      {{ titreAffiche(c) }}
                    </span>
                    @if (c.dernier_message) { <span class="mw-conv-apercu">{{ c.dernier_message }}</span> }
                    @if (c.non_lus > 0) { <span class="mw-conv-badge">{{ c.non_lus }}</span> }
                  </button>
                }
              } @else { <p class="mw-vide">Aucune conversation. Créez-en une pour commencer.</p> }
            </div>
          } @else {
            <div class="mw-messages">
              @if (messagerie.plusAnciensDisponibles()) {
                <button type="button" class="mw-plus-anciens" (click)="messagerie.chargerMessagesPlusAnciens()">Charger les messages précédents</button>
              }
              @for (m of messagerie.messagesActifs(); track m.id) {
                <div class="mw-msg" [class.moi]="m.auteur_id === moi()">
                  <span class="mw-msg-auteur">{{ m.auteur }}</span>
                  <span class="mw-msg-contenu">{{ m.contenu }}</span>
                  <span class="mw-msg-heure">
                    {{ m.cree_le | date: 'HH:mm' }}
                    @if (m.auteur_id === moi() && messagerie.estLuParTous(m)) { · Lu }
                  </span>
                </div>
              }
              @if (messagerie.frappeurs().length) {
                <p class="mw-frappe">{{ messagerie.frappeurs().join(', ') }} {{ messagerie.frappeurs().length > 1 ? 'sont' : 'est' }} en train d'écrire…</p>
              }
            </div>
            @if (auth.peut('messagerie.envoyer_message')) {
              <div class="mw-saisie">
                <input class="mw-input" [(ngModel)]="brouillon" name="mwBrouillon" placeholder="Écrire un message…"
                       (input)="onSaisie()" (keydown.enter)="envoyer()" />
                <button type="button" class="mw-btn" (click)="envoyer()" [disabled]="!brouillon.trim()">Envoyer</button>
              </div>
            }
          }
        </div>
      }
    }
  `,
  styles: [`
    .mw-bulle{
      position:fixed;right:24px;bottom:24px;z-index:1000;
      width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;
      background:var(--navy);color:#fff;display:flex;align-items:center;justify-content:center;
      box-shadow:0 6px 18px rgba(0,0,0,.22);
    }
    .mw-badge{
      position:absolute;top:-4px;right:-4px;background:var(--gold);color:#1b2436;
      font-size:var(--fs-xs);font-weight:700;min-width:20px;height:20px;border-radius:999px;
      display:flex;align-items:center;justify-content:center;padding:0 4px;
    }
    .mw-panneau{
      position:fixed;right:24px;bottom:88px;z-index:1000;
      width:340px;height:460px;max-height:70vh;background:#fff;border:1px solid var(--line);
      border-radius:14px;box-shadow:0 12px 32px rgba(0,0,0,.22);
      display:flex;flex-direction:column;overflow:hidden;
    }
    .mw-entete{
      display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--navy);color:#fff;flex-shrink:0;
    }
    .mw-titre{font-weight:700;font-size:var(--fs-md);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .mw-entete-actions{display:flex;gap:2px}
    .mw-icon-btn{
      background:none;border:none;color:#fff;cursor:pointer;font-size:var(--fs-lg);width:26px;height:26px;
      border-radius:6px;display:flex;align-items:center;justify-content:center;
    }
    .mw-icon-btn:hover{background:rgba(255,255,255,.15)}
    .mw-liste{flex:1;overflow-y:auto;padding:6px;display:flex;flex-direction:column;gap:2px}
    .mw-vide{color:var(--grey);font-size:var(--fs-base);padding:14px;text-align:center}
    .mw-conv{
      display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;position:relative;
      background:none;border:none;border-radius:8px;padding:8px 10px;cursor:pointer;width:100%;
    }
    .mw-conv:hover{background:var(--light)}
    .mw-conv-titre{font-weight:600;font-size:var(--fs-base)}
    .mw-conv-apercu{font-size:var(--fs-sm);color:var(--grey);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
    .mw-conv-badge{position:absolute;top:8px;right:8px;background:var(--gold);color:#1b2436;font-size:var(--fs-2xs);font-weight:700;padding:1px 6px;border-radius:999px}
    .mw-nouvelle{display:flex;flex-direction:column;gap:6px;padding:10px;border-bottom:1px solid var(--line);flex-shrink:0}
    .mw-messages{flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:10px}
    .mw-msg{display:flex;flex-direction:column;gap:2px;max-width:80%;background:var(--light);border-radius:10px;padding:6px 10px}
    .mw-msg.moi{align-self:flex-end;background:var(--navy);color:#fff}
    .mw-msg-auteur{font-size:var(--fs-2xs);font-weight:700;color:var(--gold)}
    .mw-msg.moi .mw-msg-auteur{color:#e8c893}
    .mw-msg-contenu{font-size:var(--fs-base);white-space:pre-wrap;word-break:break-word}
    .mw-msg-heure{font-size:var(--fs-2xs);color:var(--grey);align-self:flex-end}
    .mw-msg.moi .mw-msg-heure{color:#cfd6e3}
    .mw-saisie{display:flex;gap:6px;padding:8px;border-top:1px solid var(--line);flex-shrink:0}
    .mw-input{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font-size:var(--fs-base);width:100%}
    .mw-saisie .mw-input{flex:1}
    .mw-btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:7px 12px;font-weight:600;font-size:var(--fs-base);cursor:pointer;white-space:nowrap}
    .mw-btn:disabled{opacity:.6;cursor:not-allowed}
    .mw-point{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4caf7d;margin-right:5px;flex-shrink:0}
    .mw-point-off{background:#9aa5b1}
    .mw-plus-anciens{align-self:center;background:none;border:none;color:var(--slate);text-decoration:underline;font-size:var(--fs-sm);cursor:pointer;padding:4px;margin-bottom:4px}
    .mw-frappe{font-size:var(--fs-xs);color:var(--grey);font-style:italic;margin:0;padding:0 2px}
    @media (max-width: 420px){
      .mw-panneau{right:12px;left:12px;width:auto;bottom:82px}
      .mw-bulle{right:16px;bottom:16px}
    }
  `],
})
export class MessagerieWidgetComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly messagerie = inject(MessagerieService);

  readonly ouvert = signal(false);
  readonly vue = signal<'liste' | 'fil'>('liste');
  readonly utilisateurs = signal<any[]>([]);
  readonly afficherNouvelle = signal(false);
  participantsChoisis: string[] = [];
  titreChoisi = '';
  brouillon = '';

  // Masqué sur l'écran /messagerie lui-même — redondant d'afficher la bulle
  // par-dessus la page qui fait déjà la même chose en plus grand.
  readonly visible = signal(!this.router.url.startsWith('/messagerie'));

  ngOnInit(): void {
    this.router.events.subscribe((ev) => {
      if (ev instanceof NavigationEnd) {
        this.visible.set(!ev.urlAfterRedirects.startsWith('/messagerie'));
        if (!this.visible()) this.ouvert.set(false);
      }
    });
    this.chargerUtilisateurs();
    // Présence (13/09/2026) : `en_ligne` est un champ calculé côté serveur
    // à l'instant de la requête (voir utilisateurs.js) — un seul chargement
    // au démarrage figerait le statut de chacun pour toute la session.
    // Rafraîchi périodiquement plutôt que diffusé en direct par le bus
    // (aurait demandé un nouveau concept de diffusion « à tout le cabinet »
    // dans messagerie-bus.js, disproportionné pour 16 personnes) — ce
    // widget vit aussi longtemps que la session, pas de nettoyage requis.
    setInterval(() => this.chargerUtilisateurs(), 25000);
  }

  private chargerUtilisateurs(): void {
    this.api.utilisateurs(null).subscribe({ next: (u) => this.utilisateurs.set(u) });
  }

  moi(): string | undefined {
    return this.auth.utilisateur()?.id;
  }

  titreAffiche(c: Conversation): string {
    if (c.titre) return c.titre;
    return c.autres_participants?.join(', ') || 'Conversation';
  }

  titreActif(): string {
    const id = this.messagerie.conversationActiveId();
    const c = this.messagerie.conversations().find((x) => x.id === id);
    return c ? this.titreAffiche(c) : 'Conversation';
  }

  // Présence (13/09/2026) : affichée uniquement pour une conversation à
  // deux (le seul cas où « en ligne » a un sens univoque) — null pour un
  // groupe, pas affiché plutôt que trompeur.
  enLigneConversation(c: Conversation): boolean | null {
    const ids = c.autres_participants_ids;
    if (!ids || ids.length !== 1) return null;
    return this.utilisateurs().find((u) => u.id === ids[0])?.en_ligne ?? null;
  }

  enLigneConversationActive(): boolean | null {
    const id = this.messagerie.conversationActiveId();
    const c = this.messagerie.conversations().find((x) => x.id === id);
    return c ? this.enLigneConversation(c) : null;
  }

  // Indicateur de frappe : prévient l'autre participant à chaque saisie,
  // throttlé côté service (au plus une fois toutes les ~3s).
  onSaisie(): void {
    const id = this.messagerie.conversationActiveId();
    if (id) this.messagerie.signalerFrappe(id);
  }

  // 🐛 Bug trouvé et corrigé le 13/09/2026 (audit demandé par l'utilisateur,
  // « la messagerie réduite en bas semble ne pas opérer ») : cliquer sur la
  // bulle pour FERMER le panneau (le geste le plus naturel — pas la petite
  // croix ✕) ne réinitialisait ni `vue` ni `conversationActiveId`. Résultat
  // silencieux et invisible : tout message reçu ensuite pour cette même
  // conversation était marqué "vu" par erreur (voir le commentaire de
  // MessagerieService.recevoirMessage, déjà correct pour fermer() mais
  // jamais appliqué ici) — aucun badge, aucune pastille, rien à l'écran,
  // exactement ce qui ressemble à « la messagerie ne fonctionne plus ».
  // Reproduit puis corrigé en faisant de la fermeture par la bulle un appel
  // strict à fermer() (même nettoyage dans les deux cas), au lieu d'un
  // simple bascule du booléen `ouvert`.
  basculer(): void {
    if (this.ouvert()) {
      this.fermer();
    } else {
      this.ouvert.set(true);
      this.messagerie.rafraichirConversations();
    }
  }

  fermer(): void {
    this.ouvert.set(false);
    this.vue.set('liste');
    // Sans ce reset, un message qui arrive pour cette conversation pendant
    // que le panneau est fermé serait marqué "vu" par erreur (voir
    // MessagerieService.recevoirMessage — ne compte pas en non-lu tant que
    // conversationActiveId pointe encore dessus).
    this.messagerie.conversationActiveId.set(null);
  }

  ouvrir(c: Conversation): void {
    this.messagerie.ouvrirConversation(c.id);
    this.chargerUtilisateurs();
    this.vue.set('fil');
  }

  retourListe(): void {
    this.vue.set('liste');
    this.messagerie.conversationActiveId.set(null);
  }

  ouvrirPageComplete(): void {
    this.fermer();
    this.router.navigate(['/messagerie']);
  }

  creer(): void {
    this.messagerie.creerConversation(this.participantsChoisis, this.titreChoisi).subscribe({
      next: (c) => {
        this.afficherNouvelle.set(false);
        this.participantsChoisis = [];
        this.titreChoisi = '';
        this.messagerie.rafraichirConversations();
        this.ouvrir(c);
      },
    });
  }

  envoyer(): void {
    const contenu = this.brouillon.trim();
    const id = this.messagerie.conversationActiveId();
    if (!contenu || !id) return;
    this.brouillon = '';
    this.messagerie.envoyerMessage(id, contenu).subscribe();
  }
}
