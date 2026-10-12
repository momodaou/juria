import { Component, inject, signal, HostListener, OnInit, OnDestroy, ViewChild, ElementRef, effect, afterNextRender, Injector, runInInjectionContext } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { MessagerieService, Conversation, Message } from '../../core/messagerie.service';

@Component({
  selector: 'app-messagerie',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head"><h1>Messagerie</h1></header>

    <!-- 12/10/2026 (vérification mobile demandée par l'utilisateur) : sous
         760px, la grille à 2 colonnes poussait le fil (saisie, titre) hors
         de l'écran (x:471px sur un viewport de 390px — injoignable). Même
         principe que le widget flottant (déjà adapté) : sur petit écran,
         liste ET fil ne sont plus posés côte à côte mais basculés comme 2
         "pages" l'une après l'autre, pilotés par le même état existant
         (conversationActiveId) — aucune nouvelle logique côté TS, juste du
         CSS conditionné par cette classe. Desktop (>760px) inchangé : les
         2 restent toujours visibles côte à côte, comme avant. -->
    <div class="layout" [class.conv-ouverte]="!!messagerie.conversationActiveId()">
      <section class="panel liste">
        <div class="liste-head">
          <h3>Conversations</h3>
          <span>
            @if (auth.peut('messagerie.conversation.masquer')) {
              <button class="lien" (click)="basculerMasquees()">{{ afficherMasquees() ? 'Retour' : 'Masquées' }}</button>
            }
            @if (auth.peut('messagerie.creer_conversation')) {
              <button class="lien" (click)="afficherNouvelle.set(!afficherNouvelle())">
                {{ afficherNouvelle() ? 'Annuler' : '+ Nouvelle' }}
              </button>
            }
          </span>
        </div>

        @if (afficherNouvelle()) {
          <div class="nouvelle">
            <select class="sel" multiple [(ngModel)]="participantsChoisis" name="participants" size="5">
              @for (u of utilisateurs(); track u.id) {
                @if (u.id !== moi()) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
              }
            </select>
            <input class="sel" [(ngModel)]="titreChoisi" name="titre" placeholder="Titre (optionnel, groupe)" />
            <button class="btn sm" (click)="creer()" [disabled]="participantsChoisis.length === 0 || creationEnCours()">{{ creationEnCours() ? 'Création…' : 'Créer' }}</button>
            @if (erreurCreation()) { <p class="err">{{ erreurCreation() }}</p> }
          </div>
        }

        @if (afficherMasquees()) {
          @if (conversationsMasquees().length) {
            @for (c of conversationsMasquees(); track c.id) {
              <div class="conv conv-masquee">
                <span class="conv-titre">{{ titreAffiche(c) }}</span>
                <button class="lien" (click)="afficherConversation(c)">Afficher</button>
              </div>
            }
          } @else { <p class="muted">Aucune conversation masquée.</p> }
        } @else if (messagerie.conversations().length) {
          @for (c of messagerie.conversations(); track c.id) {
            <div class="conv" [class.active]="c.id === messagerie.conversationActiveId()">
              <button class="conv-corps" (click)="ouvrir(c)">
                <span class="conv-titre">
                  @if (enLigneConversation(c); as enLigne) {
                    <span class="point" [class.point-off]="!enLigne"></span>
                  }
                  {{ titreAffiche(c) }}
                </span>
                @if (c.dernier_message) { <span class="conv-apercu">{{ c.dernier_message }}</span> }
                @if (c.non_lus > 0) { <span class="badge-nonlus">{{ c.non_lus }}</span> }
              </button>
              @if (auth.peut('messagerie.conversation.masquer') || auth.peut('messagerie.conversation.archiver') || auth.peut('messagerie.conversation.supprimer')) {
                <button type="button" class="conv-menu-btn" title="Actions" (click)="basculerMenu(c.id, $event)">⋮</button>
              }
            </div>
          }
          <!-- Rendu hors de la liste défilante (13/09/2026) : un menu en
               position:absolute imbriqué dans .liste (overflow-y:auto) se
               faisait couper net dès qu'il dépassait la hauteur du contenu
               visible — seul "Masquer" restait visible, "Archiver"/
               "Supprimer" invisibles sans qu'aucune erreur ne le signale.
               position:fixed + coordonnées calculées au clic (voir
               basculerMenu ci-dessous) échappe à ce cadrage, quel que soit
               l'endroit où le bouton ⋮ se trouve dans la liste. -->
          @if (menuOuvertId(); as idOuvert) {
            @if (conversationParId(idOuvert); as c) {
              <div class="conv-menu" [style.top.px]="menuPos()?.top" [style.left.px]="menuPos()?.left">
                @if (auth.peut('messagerie.conversation.masquer')) {
                  <button class="conv-menu-item" title="Reste caché jusqu'à ce que vous alliez la rechercher" (click)="masquer(c)">Masquer</button>
                }
                @if (auth.peut('messagerie.conversation.archiver')) {
                  <button class="conv-menu-item" title="Revient toute seule si un nouveau message arrive" (click)="archiver(c)">Archiver</button>
                }
                @if (auth.peut('messagerie.conversation.supprimer')) {
                  <button class="conv-menu-item conv-menu-item-danger" title="Chez vous uniquement — l'historique déjà échangé disparaît de votre côté" (click)="supprimer(c)">Supprimer</button>
                }
              </div>
            }
          }
        } @else { <p class="muted">Aucune conversation. Créez-en une pour commencer.</p> }
      </section>

      <section class="panel fil">
        @if (messagerie.conversationActiveId()) {
          <div class="fil-entete">
            <button type="button" class="retour-mobile" title="Retour aux conversations" (click)="retourListeMobile()">←</button>
            @if (enLigneConversationActive(); as enLigne) {
              <span class="point" [class.point-off]="!enLigne"></span>
            }
            <span class="fil-titre">{{ titreActif() }}</span>
            <!-- 12/10/2026 — calé sur le modèle WhatsApp (confirmé par
                 l'utilisateur) : une conversation à 2 affiche toujours le
                 nom du contact, jamais renommable ; seul un groupe (3+
                 personnes) peut recevoir un nom. -->
            @if (conversationActiveEstGroupe()) {
              <button type="button" class="lien-titre" title="Renommer le groupe" (click)="renommer()">✏️</button>
            }
          </div>
          <div class="messages" #zoneMessages>
            @if (messagerie.plusAnciensDisponibles()) {
              <button type="button" class="plus-anciens" (click)="chargerPlusAnciens()">Charger les messages précédents</button>
            }
            @for (m of messagerie.messagesActifs(); track m.id) {
              <div class="msg" [class.moi]="m.auteur_id === moi()" [class.important]="m.important">
                <span class="msg-auteur">{{ m.auteur }} @if (m.important) { <span class="tag-important">❗ Important</span> }</span>
                @if (m.masque) {
                  <span class="msg-contenu msg-supprime">Message supprimé</span>
                } @else {
                  <span class="msg-contenu">{{ m.contenu }}</span>
                }
                <span class="msg-heure">
                  {{ m.cree_le | date: 'HH:mm' }}
                  @if (m.auteur_id === moi() && messagerie.estLuParTous(m)) { · Lu }
                  <!-- 10/10/2026 — "Transformer en tâche" (Bloc C du diagnostic
                       instruction avocat -> collaborateur) : fermer la boucle
                       instruction (message) -> exécution (tâche), seulement
                       quand la conversation est liée à un dossier. -->
                  @if (!m.masque && dossierActif() && auth.peut('taches.creer')) {
                    <button class="msg-tache" title="Transformer en tâche" (click)="transformerEnTache(m)">📋</button>
                  }
                  @if (!m.masque && auth.peut('messagerie.message.supprimer')) {
                    <button class="msg-supprimer" title="Supprimer ce message (chez vous uniquement)" (click)="supprimerMessage(m.id)">✕</button>
                  }
                </span>
              </div>
            }
            @if (messagerie.frappeurs().length) {
              <p class="frappe">{{ messagerie.frappeurs().join(', ') }} {{ messagerie.frappeurs().length > 1 ? 'sont' : 'est' }} en train d'écrire…</p>
            }
          </div>
          @if (auth.peut('messagerie.envoyer_message')) {
            <div class="saisie">
              <input
                class="sel"
                [(ngModel)]="brouillon"
                name="brouillon"
                placeholder="Écrire un message…"
                (input)="onSaisie()"
                (keydown.enter)="envoyer()"
              />
              <button
                type="button"
                class="btn-important"
                [class.actif]="important"
                title="Marquer ce message comme important : prévient par e-mail même seul si le destinataire est hors ligne"
                (click)="important = !important"
              >❗ Important</button>
              <button class="btn sm" (click)="envoyer()" [disabled]="!brouillon.trim()">Envoyer</button>
            </div>
          }
        } @else {
          <p class="muted">Sélectionnez une conversation, ou créez-en une nouvelle.</p>
        }
      </section>
    </div>
  `,
  styles: [`
    .layout{display:grid;grid-template-columns:300px 1fr;gap:16px;align-items:start}
    .retour-mobile{display:none}
    @media (max-width: 760px){
      /* Liste et fil basculés comme 2 "pages" plutôt que côte à côte —
         sans ça, le fil (saisie, titre) se retrouvait hors écran. */
      .layout{display:block}
      .fil{display:none}
      .layout.conv-ouverte .liste{display:none}
      .layout.conv-ouverte .fil{display:flex}
      .retour-mobile{
        display:flex;align-items:center;justify-content:center;
        background:none;border:none;cursor:pointer;font-size:var(--fs-lg);
        width:28px;height:28px;flex-shrink:0;margin-right:2px;
      }
    }
    .liste{padding:16px;max-height:78vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px}
    .liste-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
    .liste-head h3{margin:0}
    .nouvelle{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--line);border-radius:10px;margin-bottom:6px}
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-base);width:100%}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.sm{padding:8px 12px;font-size:var(--fs-base)}
    .btn:disabled{opacity:.6;cursor:not-allowed}

    /* 12/10/2026 — constat de l'utilisateur : sans trait de séparation,
       l'espace entre 2 conversations (juste le "gap" de .liste) se
       confondait avec le fond blanc, rendant la liste difficile à
       distinguer d'une entrée à l'autre. border-bottom + léger padding
       supplémentaire pour que le trait ne colle pas directement au texte. */
    .conv{
      display:flex;align-items:center;gap:2px;text-align:left;position:relative;
      background:none;border:none;border-bottom:1px solid var(--line);
      border-radius:10px;padding:8px 6px 10px 12px;width:100%;
    }
    .conv:last-child{border-bottom:none}
    .conv:hover{background:var(--light)}
    .conv.active{background:var(--navy);color:#fff;border-bottom-color:var(--navy)}
    /* 12/10/2026 — color:inherit indispensable : un <button> ne reprend pas
       automatiquement la couleur de son parent (ici blanche, posée par
       .conv.active) — sans ça, le nom de la conversation active restait
       dans la couleur de texte par défaut du navigateur pour un bouton
       (sombre), quasi invisible sur le fond bleu marine. */
    .conv-corps{display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:none;border:none;color:inherit;padding:4px 0;cursor:pointer;flex:1;min-width:0;text-align:left}
    .conv-titre{font-weight:600;font-size:var(--fs-base)}
    .conv-apercu{font-size:var(--fs-sm);color:var(--grey);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
    .conv.active .conv-apercu{color:#cfd6e3}
    .badge-nonlus{align-self:flex-end;background:var(--gold);color:#1b2436;font-size:var(--fs-xs);font-weight:700;padding:2px 7px;border-radius:999px;margin-top:-18px}
    .conv-masquee{justify-content:space-between}

    /* Menu "⋮" discret (13/09/2026) — remplace 3 liens texte toujours
       visibles, jugés encombrants par l'utilisateur. Visible en permanence
       mais très atténué, plein contraste seulement au survol de la ligne
       ou quand le menu est ouvert (sinon invisible sur mobile/tactile,
       qui n'a pas de :hover). */
    .conv-menu-btn{
      background:none;border:none;color:var(--grey);font-size:var(--fs-lg);line-height:1;
      cursor:pointer;padding:4px 8px;border-radius:6px;opacity:.35;flex-shrink:0;
    }
    .conv:hover .conv-menu-btn, .conv-menu-btn:focus-visible{opacity:1}
    .conv-menu-btn:hover{background:rgba(0,0,0,.08)}
    .conv.active .conv-menu-btn{color:#cfd6e3}
    /* position:fixed (pas absolute) + coordonnées calculées en JS au clic
       (voir basculerMenu()) : échappe à l'overflow:auto de .liste, qui
       coupait sinon le menu net dès qu'il dépassait la hauteur visible du
       contenu (bug trouvé et corrigé le 13/09/2026 avant tout déploiement,
       lors de la vérification visuelle demandée par l'utilisateur). */
    .conv-menu{
      position:fixed;z-index:1000;min-width:150px;
      background:#fff;border:1px solid var(--line);border-radius:10px;
      box-shadow:0 6px 18px rgba(0,0,0,.16);padding:4px;display:flex;flex-direction:column;
    }
    .conv-menu-item{
      background:none;border:none;text-align:left;padding:8px 10px;border-radius:6px;
      font-size:var(--fs-sm);color:var(--dark,#1b2436);cursor:pointer;white-space:nowrap;
    }
    .conv-menu-item:hover{background:var(--light)}
    .conv-menu-item-danger{color:#b23b3b}

    /* 12/10/2026 (audit messagerie — fluidité fenêtre isolée) :
       "min-height" seul n'empêche pas ce panneau de grandir au-delà de
       78vh selon le contenu — ".messages" (flex:1 en dessous) n'avait
       alors JAMAIS son propre défilement interne (scrollHeight restait
       égal à clientHeight), c'est la PAGE entière qui défilait à la
       place. "height" fige réellement la hauteur, comme ".liste" juste à
       côté (déjà en max-height:78vh) — trouvé en vérifiant visuellement
       que le défilement automatique n'avait aucun effet mesurable. */
    .fil{padding:16px;height:78vh;display:flex;flex-direction:column}
    .fil-entete{display:flex;align-items:center;gap:6px;font-weight:700;font-size:var(--fs-md);padding-bottom:10px;margin-bottom:10px;border-bottom:1px solid var(--line)}
    .lien-titre{background:none;border:none;cursor:pointer;font-size:var(--fs-sm);opacity:.5;padding:2px 4px}
    .lien-titre:hover{opacity:1}
    .point{display:inline-block;width:9px;height:9px;border-radius:50%;background:#4caf7d;flex-shrink:0}
    .point-off{background:#9aa5b1}
    .plus-anciens{align-self:center;background:none;border:none;color:var(--slate);text-decoration:underline;font-size:var(--fs-sm);cursor:pointer;padding:4px;margin-bottom:6px}
    .frappe{font-size:var(--fs-sm);color:var(--grey);font-style:italic;margin:0}
    /* min-height:0 indispensable : un enfant flex:1 d'un conteneur flex-
       column ne rétrécit pas sous la hauteur de son propre contenu sans
       ça (même famille de piège que min-width:0 pour l'ellipse horizon-
       tale, déjà documentée dans ce projet — ici son équivalent vertical). */
    .messages{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;gap:10px;padding-bottom:10px}
    .msg{display:flex;flex-direction:column;gap:2px;max-width:70%;background:var(--light);border-radius:12px;padding:8px 12px}
    .msg.moi{align-self:flex-end;background:var(--navy);color:#fff}
    .msg-auteur{font-size:var(--fs-xs);font-weight:700;color:var(--gold)}
    .msg.moi .msg-auteur{color:#e8c893}
    .msg-contenu{font-size:var(--fs-md);white-space:pre-wrap;word-break:break-word}
    .msg-heure{font-size:var(--fs-2xs);color:var(--grey);align-self:flex-end}
    .msg.moi .msg-heure{color:#cfd6e3}
    .saisie{display:flex;gap:8px;margin-top:10px}
    .saisie .sel{flex:1}
    .btn-important{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:var(--fs-sm);cursor:pointer;white-space:nowrap;color:var(--grey)}
    .btn-important.actif{background:#fdecec;border-color:#e08a8a;color:#b23b3b;font-weight:600}
    .msg.important{border:1px solid #e08a8a}
    .tag-important{font-size:var(--fs-2xs);color:#b23b3b;font-weight:700;margin-left:6px}
    .msg.moi .tag-important{color:#ffd6d6}
    .msg-supprime{font-style:italic;color:var(--grey)}
    .msg.moi .msg-supprime{color:#cfd6e3}
    .msg-supprimer{
      background:none;border:none;cursor:pointer;margin-left:6px;font-size:var(--fs-2xs);
      color:inherit;opacity:.35;padding:0 2px;
    }
    .msg:hover .msg-supprimer{opacity:.85}
    .msg-supprimer:hover{opacity:1}
    .msg-tache{
      background:none;border:none;cursor:pointer;margin-left:6px;font-size:var(--fs-2xs);
      opacity:.35;padding:0 2px;
    }
    .msg:hover .msg-tache{opacity:.85}
    .msg-tache:hover{opacity:1}
  `],
})
export class MessagerieComponent implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly messagerie = inject(MessagerieService);
  private readonly router = inject(Router);

  readonly utilisateurs = signal<any[]>([]);
  readonly afficherNouvelle = signal(false);
  // 26/09/2026 — audit doublons : garde anti-double-clic (impact mineur —
  // une conversation en double se remarque et se masque facilement).
  readonly creationEnCours = signal(false);
  readonly erreurCreation = signal('');
  readonly afficherMasquees = signal(false);
  readonly conversationsMasquees = signal<Conversation[]>([]);
  /** Menu "⋮" ouvert pour cette conversation (13/09/2026) — un seul à la fois. */
  readonly menuOuvertId = signal<string | null>(null);
  /** Coordonnées écran du menu (position:fixed, calculées au clic — voir basculerMenu). */
  readonly menuPos = signal<{ top: number; left: number } | null>(null);
  participantsChoisis: string[] = [];
  titreChoisi = '';
  brouillon = '';
  /** Drapeau posé sur le PROCHAIN message envoyé (13/09/2026) — remis à false après envoi. */
  important = false;

  // 🐛 12/10/2026 (audit messagerie — « fluidité fenêtre isolée ») : même
  // correctif que le widget flottant, voir son commentaire pour le détail
  // (aucun défilement automatique n'existait, `#zoneMessages` du template
  // n'était référencé par aucun `@ViewChild`).
  @ViewChild('zoneMessages') private zoneMessagesRef?: ElementRef<HTMLDivElement>;
  private premierChargement = false;
  private enChargementAnciens = false;
  private hauteurAvantChargementAnciens = 0;

  private readonly injector = inject(Injector);

  constructor() {
    // afterNextRender (pas queueMicrotask) — voir le commentaire identique
    // dans messagerie-widget.component.ts : sans zone.js, un microtask peut
    // s'exécuter avant qu'Angular n'ait fini d'appliquer au DOM le
    // changement déclenché par ce même signal. `runInInjectionContext`
    // nécessaire : NG0203 sinon (afterNextRender hors contexte d'injection
    // direct — trouvé en vérifiant visuellement).
    effect(() => {
      this.messagerie.messagesActifs();
      runInInjectionContext(this.injector, () => afterNextRender(() => this.ajusterDefilement()));
    });
  }

  private ajusterDefilement(): void {
    const el = this.zoneMessagesRef?.nativeElement;
    if (!el) return;
    // 🐛 Bug trouvé en vérifiant visuellement : `ouvrirConversation()` vide
    // d'abord `messagesActifs` ([]) avant de charger la vraie liste — cette
    // 1ʳᵉ exécution (tableau encore vide) de l'effet consommait déjà
    // `premierChargement` (presDuBas trivialement vrai sur un fil vide),
    // si bien que l'arrivée RÉELLE des messages, juste après, ne forçait
    // plus le défilement. Un fil vide n'a rien à positionner — on sort
    // sans toucher aux drapeaux.
    if (!this.messagerie.messagesActifs().length) return;
    if (this.enChargementAnciens) {
      el.scrollTop += el.scrollHeight - this.hauteurAvantChargementAnciens;
      this.enChargementAnciens = false;
      return;
    }
    const presDuBas = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    if (this.premierChargement || presDuBas) {
      el.scrollTop = el.scrollHeight;
      this.premierChargement = false;
    }
  }

  chargerPlusAnciens(): void {
    const el = this.zoneMessagesRef?.nativeElement;
    this.enChargementAnciens = true;
    this.hauteurAvantChargementAnciens = el?.scrollHeight ?? 0;
    this.messagerie.chargerMessagesPlusAnciens();
  }

  renommer(): void {
    const id = this.messagerie.conversationActiveId();
    if (!id) return;
    const nouveau = prompt('Nouveau titre de la conversation (laisser vide pour revenir aux noms des participants) :', this.titreActif());
    if (nouveau === null) return;
    this.messagerie.renommerConversation(id, nouveau.trim() || null).subscribe({
      next: () => this.messagerie.rafraichirConversations(),
    });
  }

  moi(): string | undefined {
    return this.auth.utilisateur()?.id;
  }

  // 12/10/2026 — bouton "←" visible seulement sous 760px (voir la media
  // query sur .layout) : revient à la liste sans fermer le flux SSE
  // global (seul conversationActiveId est remis à null, comme pour
  // n'importe quel retour à la liste sur cet écran).
  retourListeMobile(): void {
    this.messagerie.conversationActiveId.set(null);
  }

  private minuteriePresence: ReturnType<typeof setInterval> | undefined;

  ngOnInit(): void {
    this.chargerUtilisateurs();
    this.messagerie.rafraichirConversations();
    // Présence (13/09/2026, même patron que le widget flottant) : rafraîchie
    // périodiquement, pas diffusée en direct — voir le commentaire du widget.
    this.minuteriePresence = setInterval(() => this.chargerUtilisateurs(), 25000);
  }

  ngOnDestroy(): void {
    // Ferme juste l'écran actif (le flux SSE global reste ouvert pour la pastille).
    this.messagerie.conversationActiveId.set(null);
    clearInterval(this.minuteriePresence);
  }

  private chargerUtilisateurs(): void {
    this.api.utilisateurs(null).subscribe({ next: (u) => this.utilisateurs.set(u) });
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

  // 12/10/2026 — modèle WhatsApp (confirmé par l'utilisateur) : seul un
  // groupe (2 autres participants ou plus) peut être renommé, jamais une
  // conversation à 2 (son en-tête reste toujours le nom du contact).
  conversationActiveEstGroupe(): boolean {
    const id = this.messagerie.conversationActiveId();
    const c = this.messagerie.conversations().find((x) => x.id === id);
    return (c?.autres_participants?.length ?? 0) > 1;
  }

  // 10/10/2026 — Bloc C du diagnostic "instruction avocat -> collaborateur" :
  // dossier de la conversation actuellement ouverte, si elle en a un
  // (`m.conversation_id` n'est pas fiable — voir conversationActiveId()).
  dossierActif(): { id: string; numero: string | null } | null {
    const id = this.messagerie.conversationActiveId();
    const c = this.messagerie.conversations().find((x) => x.id === id);
    return c?.dossier_id ? { id: c.dossier_id, numero: c.dossier_numero } : null;
  }

  // Présence (13/09/2026, même patron que le widget flottant) : affichée
  // uniquement pour une conversation à deux.
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

  onSaisie(): void {
    const id = this.messagerie.conversationActiveId();
    if (id) this.messagerie.signalerFrappe(id);
  }

  ouvrir(c: Conversation): void {
    this.premierChargement = true;
    this.messagerie.ouvrirConversation(c.id);
    this.chargerUtilisateurs();
  }

  creer(): void {
    this.erreurCreation.set('');
    this.creationEnCours.set(true);
    this.messagerie.creerConversation(this.participantsChoisis, this.titreChoisi).subscribe({
      next: (c) => {
        this.creationEnCours.set(false);
        this.afficherNouvelle.set(false);
        this.participantsChoisis = [];
        this.titreChoisi = '';
        this.messagerie.rafraichirConversations();
        this.premierChargement = true;
        this.messagerie.ouvrirConversation(c.id);
      },
      error: (e) => { this.creationEnCours.set(false); this.erreurCreation.set(e?.error?.error ?? 'Création impossible.'); },
    });
  }

  // Toujours pas d'ajout optimiste au sens strict : dans le cas normal, le
  // message revient via le flux SSE (auquel l'auteur est lui-même abonné)
  // et messagerie.service.ts l'ajoute à messagesActifs. Mais depuis le
  // 12/10/2026, la réponse du POST est quand même passée au service
  // (ajouterMessageLocalementSiAbsent, dédoublonnée par id) — filet de
  // sécurité pour le cas où la diffusion temps réel échoue silencieusement
  // (message trop long pour pg_notify, voir messagerie-bus.js) : sans lui,
  // l'émetteur d'un tel message ne le voyait jamais apparaître.
  envoyer(): void {
    const contenu = this.brouillon.trim();
    const id = this.messagerie.conversationActiveId();
    if (!contenu || !id) return;
    this.brouillon = '';
    const important = this.important;
    this.important = false;
    this.messagerie.envoyerMessage(id, contenu, important).subscribe({
      next: (m) => this.messagerie.ajouterMessageLocalementSiAbsent(m),
    });
  }

  // Masquer/archiver/supprimer une conversation (13/09/2026) : purement
  // personnel — après succès, un simple rafraîchissement de la liste
  // suffit à la faire disparaître (le serveur ne la renvoie plus), sans
  // avoir besoin de manipuler le tableau local à la main.
  // Menu "⋮" (13/09/2026) : `stopPropagation` sur le bouton empêche le clic
  // d'ouverture d'être immédiatement refermé par le listener document
  // ci-dessous (qui, lui, ferme sur tout clic ailleurs — y compris les
  // items du menu, ce qui est voulu : choisir une action referme aussi).
  basculerMenu(id: string, ev: Event): void {
    ev.stopPropagation();
    if (this.menuOuvertId() === id) { this.menuOuvertId.set(null); return; }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.menuPos.set({ top: rect.bottom + 4, left: Math.max(8, rect.right - 156) });
    this.menuOuvertId.set(id);
  }

  @HostListener('document:click')
  fermerMenu(): void {
    this.menuOuvertId.set(null);
  }

  conversationParId(id: string): Conversation | undefined {
    return this.messagerie.conversations().find((c) => c.id === id);
  }

  basculerMasquees(): void {
    this.afficherMasquees.update((v) => !v);
    if (this.afficherMasquees()) this.chargerMasquees();
  }

  private chargerMasquees(): void {
    this.messagerie.conversationsMasquees().subscribe({ next: (c) => this.conversationsMasquees.set(c) });
  }

  private fermerSiActive(c: Conversation): void {
    if (this.messagerie.conversationActiveId() === c.id) this.messagerie.conversationActiveId.set(null);
  }

  masquer(c: Conversation): void {
    this.messagerie.masquerConversation(c.id).subscribe({
      next: () => { this.fermerSiActive(c); this.messagerie.rafraichirConversations(); },
    });
  }

  archiver(c: Conversation): void {
    this.messagerie.archiverConversation(c.id).subscribe({
      next: () => { this.fermerSiActive(c); this.messagerie.rafraichirConversations(); },
    });
  }

  supprimer(c: Conversation): void {
    if (!confirm(`Supprimer « ${this.titreAffiche(c)} » ? L'historique déjà échangé disparaîtra de votre côté (les autres participants gardent tout).`)) return;
    this.messagerie.supprimerConversation(c.id).subscribe({
      next: () => { this.fermerSiActive(c); this.messagerie.rafraichirConversations(); },
    });
  }

  afficherConversation(c: Conversation): void {
    this.messagerie.afficherConversation(c.id).subscribe({
      next: () => { this.chargerMasquees(); this.messagerie.rafraichirConversations(); },
    });
  }

  supprimerMessage(messageId: string): void {
    const id = this.messagerie.conversationActiveId();
    if (!id) return;
    this.messagerie.supprimerMessage(id, messageId).subscribe({
      next: () => this.messagerie.retirerMessageLocalement(messageId),
    });
  }

  // 10/10/2026 — "Transformer en tâche" (Bloc C du diagnostic instruction
  // avocat -> collaborateur) : navigue vers le Plan d'action, dossier déjà
  // filtré et titre pré-rempli depuis le message — l'utilisateur n'a plus
  // qu'à choisir le responsable et valider (jamais de création automatique,
  // on ne devine pas à qui confier la tâche).
  transformerEnTache(m: Message): void {
    const d = this.dossierActif();
    if (!d) return;
    const titre = (m.contenu || '').length > 80 ? m.contenu!.slice(0, 80) + '…' : (m.contenu || '');
    this.router.navigate(['/plan-action'], { queryParams: { dossier: d.id, dossierLabel: d.numero, titre } });
  }
}
