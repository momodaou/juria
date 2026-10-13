import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

// Registre « Conflits en attente de décision » (13/10/2026) — comble le
// vrai bug trouvé en réfléchissant à la validation des nouveaux dossiers :
// la décision (accepte/refuse/oriente) n'était reachable QUE depuis
// l'écran où le collaborateur bloqué a lui-même lancé le contrôle (voir
// ouverture.component.ts) — aucun registre, aucune notification. Un
// associé devait physiquement s'asseoir devant la machine du collaborateur
// bloqué pour pouvoir décider. Corrigé par : (1) un e-mail immédiat aux
// titulaires de `conflits.decision` dès qu'un contrôle sort "potentiel",
// (2) GET / ci-dessous, qui liste les contrôles en attente pour que la
// décision se prenne depuis le propre compte de l'associé, où qu'il soit —
// la route de décision elle-même (POST /:id/decision) était déjà
// reachable à distance, seule l'absence d'écran/notification bloquait.
// Destinataires résolus depuis permissions_role (même principe que
// alertesDoublons.js : jamais une liste de rôles recopiée à la main, qui a
// déjà dérivé de la réalité de la matrice sur ce projet).
//
// 3 correctifs le 13/10/2026 après-midi (constat utilisateur) :
// - GET / était pollué par 32 entrées historiques 'absence' (aucun
//   conflit, jamais de décision attendue, filtre serveur corrigé — voir
//   conflicts.js) qui ressemblaient à des dossiers « déjà créés » dans
//   cette liste, triée par ancienneté croissante (le vrai contrôle récent
//   était enterré tout en bas).
// - Le lien du mail pointe désormais vers CE contrôle précis (?id=),
//   lu ici pour défiler/surligner directement la bonne entrée.
// - « Supprimer » ajouté (abandon/doublon, sans rapport avec les
//   dossiers — voir le commentaire de DELETE /:id côté serveur).
@Component({
  selector: 'app-conflits',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
    <header class="page-head">
      <div>
        <h1>Conflits en attente de décision</h1>
        <p>Contrôles de conflit d'intérêts signalant un rapprochement potentiel — décidez ici depuis votre propre compte, sans avoir à être sur l'écran du collaborateur bloqué. Le plus récent est en tête.</p>
      </div>
    </header>

    @if (idCible() && !chargement() && !trouveCible()) {
      <p class="bandeau-filtre">Le contrôle signalé par le lien reçu a déjà été traité (ou n'existe plus) — voici les contrôles encore en attente.</p>
    }

    @if (chargement()) {
      <p class="muted">Chargement…</p>
    } @else if (!liste().length) {
      <p class="muted">Aucun conflit en attente de décision.</p>
    } @else {
      @for (c of liste(); track c.id) {
        <section class="panel result warn" [id]="'conflit-' + c.id" [class.surligne]="c.id === idCible()">
          <h3>{{ c.intitule_projet || 'Projet non précisé' }}</h3>
          <p class="muted">Soumis par {{ c.cree_par_nom || '—' }} ({{ c.cree_par_code }}) le {{ c.cree_le | date: 'dd/MM/yyyy à HH:mm' }}</p>
          <p><span class="terme">Noms recherchés :</span> {{ c.noms_recherches }}</p>

          @for (d of c.details; track d.terme) {
            <div class="match">
              <span class="terme">{{ d.terme }}</span> :
              @for (m of d.correspondances; track m.id) {
                <span class="chip">{{ m.nom }} ({{ m.source }}{{ m.dossier ? ' · ' + m.dossier : '' }})</span>
              }
            </div>
          }

          <div class="decision">
            <label>Décision</label>
            <input class="in" [(ngModel)]="motifs[c.id]" [name]="'motif-' + c.id" placeholder="Motif (obligatoire)" />
            @if (erreurs[c.id]) { <p class="err">{{ erreurs[c.id] }}</p> }
            <div class="btns">
              <button class="btn ghost" (click)="decider(c, 'refuse')">Refuser</button>
              <button class="btn ghost" (click)="decider(c, 'oriente')">Orienter vers un confrère</button>
              <button class="btn" (click)="decider(c, 'accepte')">Accepter (motivé)</button>
            </div>
            <p><a class="lien" style="color:var(--grey)" (click)="supprimer(c)">Supprimer (abandon ou doublon — sans lien avec un dossier)</a></p>
          </div>
        </section>
      }
    }

    <p><a class="lien" [routerLink]="['/ouverture']">← Retour à l'ouverture d'un dossier</a></p>
  `,
  styles: [`
    .in{display:block;width:100%;max-width:520px;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .result.warn{background:#fffaf0;border:1px solid #f0dcae}
    .result.surligne{border:2px solid var(--navy);box-shadow:0 0 0 3px rgba(27,36,54,.12)}
    .match{margin-top:8px;font-size:var(--fs-base)}
    .terme{font-weight:600}
    .chip{display:inline-block;background:#fff;border:1px solid var(--line);border-radius:12px;padding:2px 9px;margin:2px;font-size:var(--fs-sm)}
    .decision{margin-top:14px}
    .decision .btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
    .muted{color:var(--grey);font-size:var(--fs-sm)}
    .bandeau-filtre{background:var(--light);border:1px solid var(--line);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:var(--fs-base)}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:inherit;padding:0;text-decoration:underline}
  `],
})
export class ConflitsComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);

  readonly chargement = signal(true);
  readonly liste = signal<any[]>([]);
  readonly idCible = signal<string | null>(null);
  motifs: Record<string, string> = {};
  erreurs: Record<string, string> = {};

  ngOnInit(): void {
    this.idCible.set(this.route.snapshot.queryParamMap.get('id'));
    this.charger();
  }

  trouveCible(): boolean {
    const id = this.idCible();
    return !!id && this.liste().some((c) => c.id === id);
  }

  private charger(): void {
    this.chargement.set(true);
    this.api.conflitsEnAttente().subscribe({
      next: (r) => {
        this.liste.set(r);
        this.chargement.set(false);
        const id = this.idCible();
        if (id) {
          // Laisse le @for insérer les sections dans le DOM avant de cibler
          // (même nécessité que le tiroir du Tableau de bord, 13/09/2026).
          setTimeout(() => {
            document.getElementById('conflit-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 50);
        }
      },
      error: () => this.chargement.set(false),
    });
  }

  decider(c: any, decision: string): void {
    const motif = (this.motifs[c.id] || '').trim();
    if (!motif) { this.erreurs[c.id] = 'Le motif est obligatoire.'; return; }
    delete this.erreurs[c.id];
    this.api.decisionConflit(c.id, { decision, motif }).subscribe({
      next: () => this.liste.update((l) => l.filter((x) => x.id !== c.id)),
      error: (e) => { this.erreurs[c.id] = e?.error?.error ?? 'Décision impossible.'; },
    });
  }

  supprimer(c: any): void {
    if (!confirm('Supprimer cette entrée du registre ? Ceci ne supprime aucun dossier et n’envoie aucun e-mail — utile pour un contrôle abandonné ou saisi en double.')) return;
    this.api.supprimerConflit(c.id).subscribe({
      next: () => this.liste.update((l) => l.filter((x) => x.id !== c.id)),
      error: (e) => { this.erreurs[c.id] = e?.error?.error ?? 'Suppression impossible.'; },
    });
  }
}
