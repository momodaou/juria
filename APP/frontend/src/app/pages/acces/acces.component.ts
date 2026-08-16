import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';

@Component({
  selector: 'app-acces',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Accès &amp; permissions</h1>
        <p>Évolution des rôles, délégations d'accès, journal d'audit. Réservé associé/admin.</p>
      </div>
    </header>

    @if (erreurGlobale()) {
      <section class="panel"><p class="err">{{ erreurGlobale() }}</p></section>
    } @else {
      <section class="panel">
        <h3>Membres du cabinet</h3>
        <table>
          <tr><th>Nom</th><th>Rôle</th><th>Statut</th><th></th></tr>
          @for (u of utilisateurs(); track u.id) {
            <tr>
              <td>{{ u.prenom }} {{ u.nom }} <span class="muted">({{ u.code }})</span></td>
              <td>
                <select class="sel" [ngModel]="u.role" (ngModelChange)="changerRole(u, $event)">
                  <option value="associe">Associé</option>
                  <option value="collaborateur">Collaborateur</option>
                  <option value="stagiaire">Stagiaire</option>
                  <option value="assistante">Assistante</option>
                  <option value="comptable">Comptable</option>
                  <option value="admin">Admin</option>
                </select>
              </td>
              <td><span class="tag" [class.ok]="u.actif" [class.haute]="!u.actif">{{ u.actif ? 'Actif' : 'Désactivé' }}</span></td>
              <td><button class="lien" (click)="basculerActif(u)">{{ u.actif ? 'Désactiver' : 'Réactiver' }}</button></td>
            </tr>
          }
        </table>
      </section>

      <section class="panel">
        <h3>Délégations d'accès</h3>
        <div class="upload">
          <select class="sel" [(ngModel)]="nouvelleDeleg.utilisateur_id" name="deleUser">
            <option value="">Bénéficiaire…</option>
            @for (u of utilisateurs(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
          </select>
          <select class="sel" [(ngModel)]="nouvelleDeleg.portee" name="delePortee">
            <option value="temporaire">Temporaire</option>
            <option value="permanent">Permanent</option>
          </select>
          <input class="sel" [(ngModel)]="nouvelleDeleg.description" name="deleDesc" placeholder="Ex. Accès facturation" style="flex:1;min-width:180px" />
          @if (nouvelleDeleg.portee === 'temporaire') {
            <input class="sel" type="date" [(ngModel)]="nouvelleDeleg.date_fin" name="deleFin" />
          }
          <button class="btn sm" (click)="accorderDelegation()" [disabled]="!nouvelleDeleg.utilisateur_id || !nouvelleDeleg.description">Accorder</button>
        </div>

        @if (delegations().length) {
          <table>
            <tr><th>Bénéficiaire</th><th>Portée</th><th>Description</th><th>Du</th><th>Au</th><th>Statut</th><th></th></tr>
            @for (d of delegations(); track d.id) {
              <tr>
                <td>{{ d.utilisateur }}</td>
                <td>{{ d.portee }}</td>
                <td>{{ d.description }}</td>
                <td>{{ d.date_debut | date:'dd/MM/yyyy' }}</td>
                <td>{{ d.date_fin ? (d.date_fin | date:'dd/MM/yyyy') : '—' }}</td>
                <td><span class="tag" [class.ok]="d.actif" [class.haute]="!d.actif">{{ d.actif ? 'Active' : 'Révoquée' }}</span></td>
                <td>@if (d.actif) { <button class="lien" (click)="revoquer(d)">Révoquer</button> }</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune délégation.</p> }
      </section>

      <section class="panel">
        <h3>Journal d'audit (100 dernières actions)</h3>
        @if (audit().length) {
          <table>
            <tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th></tr>
            @for (a of audit(); track a.id) {
              <tr>
                <td>{{ a.horodatage | date:'dd/MM/yyyy HH:mm' }}</td>
                <td>{{ a.utilisateur || '—' }}</td>
                <td><span class="tag">{{ a.action }}</span></td>
                <td>{{ a.entite || '—' }}</td>
              </tr>
            }
          </table>
        } @else { <p class="muted">Aucune entrée.</p> }
      </section>
    }
  `,
  styles: [`
    .sel{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:13px}
    .upload{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
    .btn.sm{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer;font-size:13px}
    .btn.sm:disabled{opacity:.6}
    .lien{background:none;border:none;color:var(--gold);cursor:pointer;font-size:12.5px;padding:0}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    .tag.haute{background:#fbe6e5;color:#b13a36}
  `],
})
export class AccesComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly utilisateurs = signal<any[]>([]);
  readonly delegations = signal<any[]>([]);
  readonly audit = signal<any[]>([]);
  readonly erreurGlobale = signal('');

  nouvelleDeleg: any = { portee: 'temporaire' };

  ngOnInit(): void {
    this.api.utilisateurs(undefined).subscribe({ next: (u) => this.utilisateurs.set(u) });
    this.chargerDelegations();
    this.api.journalAudit().subscribe({
      next: (a) => this.audit.set(a),
      error: (e) => this.erreurGlobale.set(e?.error?.error ?? 'Accès réservé aux associés/admin.'),
    });
  }

  chargerDelegations(): void {
    this.api.delegations().subscribe({ next: (d) => this.delegations.set(d) });
  }

  changerRole(u: any, role: string): void {
    this.api.majRoleUtilisateur(u.id, role).subscribe({ next: () => { u.role = role; } });
  }

  basculerActif(u: any): void {
    this.api.majActifUtilisateur(u.id, !u.actif).subscribe({ next: () => { u.actif = !u.actif; } });
  }

  accorderDelegation(): void {
    this.api.creerDelegation(this.nouvelleDeleg).subscribe({
      next: () => { this.nouvelleDeleg = { portee: 'temporaire' }; this.chargerDelegations(); },
    });
  }

  revoquer(d: any): void {
    this.api.revoquerDelegation(d.id).subscribe({ next: () => this.chargerDelegations() });
  }
}
