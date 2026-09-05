import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-role-audience',
  standalone: true,
  imports: [DatePipe, FormsModule],
  template: `
    <header class="page-head">
      <div>
        <h1>Rôle d'audience</h1>
        <p>Agenda hebdomadaire des audiences — semaine du {{ role()?.semaine_debut | date:'dd/MM/yyyy' }}
          au {{ role()?.semaine_fin | date:'dd/MM/yyyy' }}</p>
      </div>
      <div class="actions">
        <button class="btn ghost" (click)="semaineDecalage(-7)">← Semaine précédente</button>
        <button class="btn ghost" (click)="semaineDecalage(7)">Semaine suivante →</button>
      </div>
    </header>

    @if (role(); as r) {
      <section class="panel">
        <div class="statut-bar">
          <span class="tag" [class.ok]="r.statut === 'diffuse'">
            {{ r.statut ? libelleStatut(r.statut) : 'Aucun rôle pour cette semaine' }}
          </span>
          @if (r.id && r.statut === 'brouillon' && auth.peut('audiences.role.valider')) { <button class="btn sm" (click)="valider(r.id)">Valider le rôle</button> }
          @if (r.id && r.statut === 'valide' && auth.peut('audiences.role.diffuser')) { <button class="btn sm" (click)="diffuser(r.id)">Diffuser à l'équipe</button> }
        </div>

        @if (r.lignes?.length) {
          <table>
            <tr><th>Date</th><th>Heure</th><th>Dossier</th><th>Juridiction</th><th>Type</th><th>Avocat</th><th>Résultat</th><th></th></tr>
            @for (l of r.lignes; track l.id) {
              <tr [class.urgent]="l.urgente">
                <td>{{ l.date_prevue | date:'dd/MM/yyyy' }}</td>
                <td>{{ l.heure || '—' }}</td>
                <td>{{ l.dossier_numero }} — {{ l.dossier_intitule }}</td>
                <td>{{ l.juridiction || '—' }}</td>
                <td>{{ l.type }}</td>
                <td>{{ l.avocat_nom || '—' }}</td>
                <td>
                  @if (l.resultat) {
                    <span class="tag">{{ l.resultat }}</span>
                    @if (l.motif_renvoi) { <span class="muted"> · {{ l.motif_renvoi }}</span> }
                  } @else { <span class="muted">à saisir</span> }
                </td>
                <td>
                  @if (!l.resultat && auth.peut('audiences.retour.saisir')) { <button class="lien" (click)="ouvrirRetour(l)">Saisir le retour</button> }
                </td>
              </tr>
            }
          </table>
        } @else {
          <p class="muted">Aucune audience programmée cette semaine.</p>
        }
      </section>

      @if (ligneRetour(); as l) {
        <section class="panel">
          <h3>Retour d'audience — {{ l.dossier_numero }} ({{ l.date_prevue | date:'dd/MM/yyyy' }})</h3>
          <div class="grid2">
            <div>
              <label>Résultat</label>
              <select class="in" [(ngModel)]="retourForm.resultat" name="resultat">
                <option value="renvoi">Renvoi</option>
                <option value="delibere">Mise en délibéré</option>
                <option value="plaide">Plaidée</option>
                <option value="radiation">Radiation</option>
                <option value="conciliation">Conciliation</option>
                <option value="autre">Autre</option>
              </select>
            </div>
            @if (retourForm.resultat === 'renvoi') {
              <div>
                <label>Motif du renvoi</label>
                <select class="in" [(ngModel)]="retourForm.motif_renvoi_id" name="motif">
                  <option value="">—</option>
                  @for (m of motifs(); track m.id) { <option [value]="m.id">{{ m.libelle }}</option> }
                </select>
              </div>
              <div>
                <label>Prochaine date</label>
                <input class="in" type="date" [(ngModel)]="retourForm.prochaine_date" name="prochaine" />
              </div>
            }
            <div class="col2">
              <label>Observations</label>
              <input class="in" [(ngModel)]="retourForm.observations" name="obs" />
            </div>
          </div>
          <div class="actions">
            <button class="btn" (click)="enregistrerRetour(l.audience_id)">Enregistrer le retour</button>
            <button class="btn ghost" (click)="ligneRetour.set(null)">Annuler</button>
          </div>
        </section>
      }
    }

    @if (auth.peut('audiences.ligne.creer')) {
    <section class="panel">
      <h3>Programmer une audience</h3>
      <div class="grid2">
        <div class="col2">
          <label>Dossier</label>
          <input class="in" [(ngModel)]="dossierRecherche" name="dossierRecherche"
                 (ngModelChange)="rechercherDossiers()" placeholder="Rechercher un dossier par numéro ou intitulé…" />
          @if (dossierResultats().length) {
            <div class="suggestions">
              @for (d of dossierResultats(); track d.id) {
                <button type="button" class="chip" (click)="choisirDossier(d)">{{ d.numero }} — {{ d.intitule }}</button>
              }
            </div>
          }
          @if (nouvelleLigne.dossier_id) { <p class="muted">Sélectionné : {{ dossierLabel }}</p> }
        </div>
        <div><label>Date</label><input class="in" type="date" [(ngModel)]="nouvelleLigne.date_prevue" name="date" /></div>
        <div><label>Heure</label><input class="in" type="time" [(ngModel)]="nouvelleLigne.heure" name="heure" /></div>
        <div><label>Juridiction</label><input class="in" [(ngModel)]="nouvelleLigne.juridiction" name="juridiction" /></div>
        <div>
          <label>Type</label>
          <select class="in" [(ngModel)]="nouvelleLigne.type" name="type">
            <option value="mise_en_etat">Mise en état</option>
            <option value="plaidoirie">Plaidoirie</option>
            <option value="conciliation">Conciliation</option>
            <option value="refere">Référé</option>
            <option value="prononce">Prononcé</option>
            <option value="autre">Autre</option>
          </select>
        </div>
        <div class="col2"><label>Instructions à l'avocat</label><input class="in" [(ngModel)]="nouvelleLigne.instructions" name="instr" /></div>
        <div><label><input type="checkbox" [(ngModel)]="nouvelleLigne.urgente" name="urgente" /> Urgente / dernière minute</label></div>
      </div>
      <button class="btn" (click)="ajouter()" [disabled]="!nouvelleLigne.dossier_id || !nouvelleLigne.date_prevue">Ajouter au rôle</button>
      @if (erreur()) { <p class="err">{{ erreur() }}</p> }
    </section>
    }
  `,
  styles: [`
    .actions{display:flex;gap:8px}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer}
    .btn.ghost{background:#fff;border:1px solid var(--line);color:var(--slate)}
    .btn.sm{padding:6px 11px;font-size:12.5px}
    .btn:disabled{opacity:.6}
    .statut-bar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.urgent td{background:#fff5f4}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:14px}
    label{font-size:12px;color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:720px}
    .col2{grid-column:1 / -1}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:12.5px;cursor:pointer}
  `],
})
export class RoleAudienceComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly role = signal<any | null>(null);
  readonly motifs = signal<{ id: string; libelle: string }[]>([]);
  readonly dossierResultats = signal<Dossier[]>([]);
  readonly ligneRetour = signal<any | null>(null);
  readonly erreur = signal('');

  semaine = new Date().toISOString().slice(0, 10);
  dossierRecherche = '';
  dossierLabel = '';
  nouvelleLigne: any = { type: 'mise_en_etat', urgente: false };
  retourForm: any = { resultat: 'renvoi', motif_renvoi_id: '', prochaine_date: '', observations: '' };

  libelleStatut(s: string): string {
    return ({ brouillon: 'Brouillon', valide: 'Validé', diffuse: 'Diffusé' } as Record<string, string>)[s] ?? s;
  }

  ngOnInit(): void {
    this.charger();
    this.api.motifsRenvoi().subscribe({ next: (m) => this.motifs.set(m) });
  }

  charger(): void {
    this.api.roleAudience(this.semaine).subscribe({ next: (r) => this.role.set(r) });
  }

  semaineDecalage(jours: number): void {
    const d = new Date(this.semaine + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + jours);
    this.semaine = d.toISOString().slice(0, 10);
    this.charger();
  }

  rechercherDossiers(): void {
    this.nouvelleLigne.dossier_id = null;
    if (this.dossierRecherche.length < 2) { this.dossierResultats.set([]); return; }
    this.api.dossiers(this.dossierRecherche).subscribe({ next: (d) => this.dossierResultats.set(d) });
  }

  choisirDossier(d: Dossier): void {
    this.nouvelleLigne.dossier_id = d.id;
    this.dossierLabel = `${d.numero} — ${d.intitule}`;
    this.dossierResultats.set([]);
    this.dossierRecherche = '';
  }

  ajouter(): void {
    this.erreur.set('');
    this.api.ajouterLigneRole(this.nouvelleLigne).subscribe({
      next: () => {
        this.nouvelleLigne = { type: 'mise_en_etat', urgente: false };
        this.dossierLabel = '';
        this.charger();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  valider(id: string): void {
    this.api.validerRole(id).subscribe({ next: () => this.charger() });
  }

  diffuser(id: string): void {
    this.api.diffuserRole(id).subscribe({ next: () => this.charger() });
  }

  ouvrirRetour(l: any): void {
    this.retourForm = { resultat: 'renvoi', motif_renvoi_id: '', prochaine_date: '', observations: '' };
    this.ligneRetour.set(l);
  }

  enregistrerRetour(audienceId: string): void {
    const payload = { ...this.retourForm, prochaine_date: this.retourForm.prochaine_date || null, motif_renvoi_id: this.retourForm.motif_renvoi_id || null };
    this.api.retourAudience(audienceId, payload).subscribe({
      next: () => { this.ligneRetour.set(null); this.charger(); },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Enregistrement du retour impossible.'),
    });
  }
}
