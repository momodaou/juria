import { Component, inject, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, Dossier } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';

@Component({
  selector: 'app-role-audience',
  standalone: true,
  imports: [DatePipe, FormsModule, RouterLink],
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
                <td><a class="lien" [routerLink]="['/dossiers', l.dossier_id]">{{ l.dossier_numero }} — {{ l.dossier_intitule }}</a></td>
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

    <section class="panel">
      <h3>Diligences</h3>
      <p class="muted" style="margin-bottom:12px">Rendez-vous et démarches de terrain (audition en juridiction, enquête, formalité, expertise…) — distinct du rôle hebdomadaire ci-dessus. Peut aussi être créée automatiquement par le Registre du courrier (ex. convocation reçue sur un dossier).</p>
      @if (diligences().length) {
        <table>
          <tr><th>Date</th><th>Heure</th><th>Type</th><th>Dossier</th><th>Membre</th><th>Lieu</th><th>Objet</th><th></th></tr>
          @for (dl of diligences(); track dl.id) {
            <tr>
              <td>{{ dl.date_diligence | date:'dd/MM/yyyy' }}</td>
              <td>{{ dl.heure || '—' }}</td>
              <td>{{ libelleTypeDiligence(dl.type_diligence) }}@if (dl.type_diligence === 'autre' && dl.type_precision) { : {{ dl.type_precision }} }</td>
              <td>@if (dl.dossier_id) { <a class="lien" [routerLink]="['/dossiers', dl.dossier_id]">{{ dl.dossier_numero }}</a> } @else { — }</td>
              <td>{{ dl.membre_nom || '—' }}</td>
              <td>{{ dl.lieu || '—' }}</td>
              <td>{{ dl.objet || '—' }}</td>
              <td>
                @if (auth.peut('audiences.diligence.gerer')) {
                  <button class="lien" (click)="majDiligence(dl, 'fait')">Fait</button>
                  <button class="lien" (click)="majDiligence(dl, 'reporte')">Reporter</button>
                  <button class="lien" (click)="majDiligence(dl, 'annule')">Annuler</button>
                }
              </td>
            </tr>
          }
        </table>
      } @else { <p class="muted">Aucune diligence à faire.</p> }

      @if (auth.peut('audiences.diligence.gerer')) {
        <h4 style="margin:18px 0 8px">Nouvelle diligence</h4>
        <div class="grid2">
          <div>
            <label>Type</label>
            <select class="in" [(ngModel)]="nouvelleDiligence.type_diligence" name="dltype">
              @for (t of typesDiligence(); track t.code) { <option [value]="t.code">{{ t.libelle }}</option> }
            </select>
          </div>
          @if (nouvelleDiligence.type_diligence === 'autre') {
            <div><label>Préciser</label><input class="in" [(ngModel)]="nouvelleDiligence.type_precision" name="dlprecision" /></div>
          }
          <div class="col2">
            <label>Dossier (optionnel)</label>
            <input class="in" [(ngModel)]="dlDossierRecherche" name="dlDossierRecherche"
                   (ngModelChange)="rechercherDossiersDiligence()" placeholder="Rechercher un dossier par numéro ou intitulé…" />
            @if (dlDossierResultats().length) {
              <div class="suggestions">
                @for (d of dlDossierResultats(); track d.id) {
                  <button type="button" class="chip" (click)="choisirDossierDiligence(d)">{{ d.numero }} — {{ d.intitule }}</button>
                }
              </div>
            }
            @if (nouvelleDiligence.dossier_id) { <p class="muted">Sélectionné : {{ dlDossierLabel }} <button class="lien" (click)="viderDossierDiligence()">retirer</button></p> }
          </div>
          <div>
            <label>Membre assigné</label>
            <select class="in" [(ngModel)]="nouvelleDiligence.membre_id" name="dlmembre">
              <option value="">—</option>
              @for (u of membres(); track u.id) { <option [value]="u.id">{{ u.prenom }} {{ u.nom }}</option> }
            </select>
          </div>
          <div><label>Date</label><input class="in" type="date" [(ngModel)]="nouvelleDiligence.date_diligence" name="dldate" /></div>
          <div><label>Heure</label><input class="in" type="time" [(ngModel)]="nouvelleDiligence.heure" name="dlheure" /></div>
          <div><label>Lieu</label><input class="in" [(ngModel)]="nouvelleDiligence.lieu" name="dllieu" /></div>
          <div class="col2"><label>Objet</label><input class="in" [(ngModel)]="nouvelleDiligence.objet" name="dlobjet" /></div>
        </div>
        <button class="btn" (click)="ajouterDiligence()" [disabled]="!nouvelleDiligence.date_diligence">Ajouter</button>
      }
    </section>

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
    .btn.sm{padding:6px 11px;font-size:var(--fs-sm)}
    .btn:disabled{opacity:.6}
    .statut-bar{display:flex;align-items:center;gap:12px;margin-bottom:14px}
    .tag.ok{background:#e3f5ec;color:#157a4f}
    tr.urgent td{background:#fff5f4}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:720px}
    .col2{grid-column:1 / -1}
    .suggestions{display:flex;flex-wrap:wrap;gap:6px;margin:-6px 0 12px}
    .chip{background:#fff;border:1px solid var(--line);border-radius:12px;padding:5px 11px;font-size:var(--fs-sm);cursor:pointer}
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

  // Diligences (11/09/2026, gap comblé — voir CLAUDE.md/HISTORY.md).
  readonly diligences = signal<any[]>([]);
  readonly typesDiligence = signal<{ code: string; libelle: string }[]>([]);
  readonly membres = signal<any[]>([]);
  readonly dlDossierResultats = signal<Dossier[]>([]);
  dlDossierRecherche = '';
  dlDossierLabel = '';
  nouvelleDiligence: any = { type_diligence: 'diligence' };

  semaine = new Date().toISOString().slice(0, 10);
  dossierRecherche = '';
  dossierLabel = '';
  nouvelleLigne: any = { type: 'mise_en_etat', urgente: false };
  retourForm: any = { resultat: 'renvoi', motif_renvoi_id: '', prochaine_date: '', observations: '' };

  libelleStatut(s: string): string {
    return ({ brouillon: 'Brouillon', valide: 'Validé', diffuse: 'Diffusé' } as Record<string, string>)[s] ?? s;
  }

  libelleTypeDiligence(code: string): string {
    return this.typesDiligence().find((t) => t.code === code)?.libelle ?? code;
  }

  ngOnInit(): void {
    this.charger();
    this.api.motifsRenvoi().subscribe({ next: (m) => this.motifs.set(m) });
    this.api.listesValeurs('type_diligence').subscribe({ next: (v) => this.typesDiligence.set(v) });
    this.api.utilisateurs().subscribe({ next: (u) => this.membres.set(u) });
    this.chargerDiligences();
  }

  charger(): void {
    this.api.roleAudience(this.semaine).subscribe({ next: (r) => this.role.set(r) });
  }

  chargerDiligences(): void {
    this.api.diligences({ statut: 'a_faire' }).subscribe({ next: (d) => this.diligences.set(d) });
  }

  rechercherDossiersDiligence(): void {
    this.nouvelleDiligence.dossier_id = null;
    if (this.dlDossierRecherche.length < 2) { this.dlDossierResultats.set([]); return; }
    this.api.dossiers(this.dlDossierRecherche).subscribe({ next: (d) => this.dlDossierResultats.set(d) });
  }

  choisirDossierDiligence(d: Dossier): void {
    this.nouvelleDiligence.dossier_id = d.id;
    this.dlDossierLabel = `${d.numero} — ${d.intitule}`;
    this.dlDossierResultats.set([]);
    this.dlDossierRecherche = '';
  }

  viderDossierDiligence(): void {
    this.nouvelleDiligence.dossier_id = null;
    this.dlDossierLabel = '';
  }

  ajouterDiligence(): void {
    this.erreur.set('');
    this.api.creerDiligence(this.nouvelleDiligence).subscribe({
      next: () => {
        this.nouvelleDiligence = { type_diligence: 'diligence' };
        this.dlDossierLabel = '';
        this.chargerDiligences();
      },
      error: (e) => this.erreur.set(e?.error?.error ?? 'Ajout impossible.'),
    });
  }

  majDiligence(dl: any, statut: string): void {
    this.api.majStatutDiligence(dl.id, statut).subscribe({ next: () => this.chargerDiligences() });
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
