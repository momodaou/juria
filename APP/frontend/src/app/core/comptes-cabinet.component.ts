import { Component, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService, CompteBancaire } from './api.service';
import { MenuActionsComponent, ActionMenuItem } from './menu-actions.component';

// Comptes du cabinet (20/10/2026) : deux familles, chacune avec ses propres
// champs. « Banque » (usage fonctionnement ou CARPA) et « Mobile money ». La
// caisse n'est pas un compte de réception (elle ne sert qu'aux dépenses) et
// un virement de l'étranger est une variante du virement, pas un compte.
@Component({
  selector: 'app-comptes-cabinet',
  standalone: true,
  imports: [FormsModule, MenuActionsComponent],
  template: `
    <section class="panel">
      <h3>Comptes du cabinet</h3>
      <p class="muted">Comptes qui reçoivent les règlements des clients : banque et mobile money. La caisse n'en fait pas partie, elle ne sert qu'aux dépenses. Un compte désactivé n'apparaît plus dans les sélecteurs de règlement mais reste visible ici (historique).</p>

      <!-- 20/10/2026 — déplacé ici (au-dessus du tableau) : affiché seulement au
           bas du formulaire Ajouter/Modifier, un refus de suppression (compte déjà
           référencé par un paiement/une dépense/une facture) passait inaperçu,
           l'utilisateur devant faire défiler toute la page pour le voir. -->
      @if (message()) { <p class="msg" [class.msg-err]="messageErreur()">{{ message() }}</p> }

      @if (comptes().length) {
        <div class="table-scroll">
          <table>
            <tr><th>Compte</th><th>Coordonnées</th><th>Sur les factures</th><th>Statut</th><th></th></tr>
            @for (c of comptes(); track c.id) {
              <tr>
                <td><b>{{ c.intitule }}</b><br /><span class="muted">{{ famille(c) }}</span></td>
                <td>
                  @if (c.type === 'mobile_money') {
                    {{ libelleOperateur(c.operateur) }} — {{ c.telephone || '—' }}
                  } @else if (estBanque(c)) {
                    {{ c.banque || '—' }} — n° {{ c.numero || '—' }}
                    @if (c.code_banque || c.code_guichet || c.cle_rib) {
                      <br /><span class="muted">Code banque {{ c.code_banque || '—' }} · guichet {{ c.code_guichet || '—' }} · clé {{ c.cle_rib || '—' }}</span>
                    }
                    @if (c.iban) { <br /><span class="muted">IBAN {{ c.iban }}@if (c.bic) { · BIC {{ c.bic }} }</span> }
                  } @else { <span class="muted">—</span> }
                </td>
                <td>{{ estBanque(c) || c.type === 'mobile_money' ? (c.afficher_sur_factures ? 'Oui' : 'Non') : '—' }}</td>
                <td><span class="tag" [class.ok]="c.actif" [class.haute]="!c.actif">{{ c.actif ? 'Actif' : 'Inactif' }}</span></td>
                <td><app-menu-actions [actions]="actionsPourCompte(c)" /></td>
              </tr>
            }
          </table>
        </div>
      } @else { <p class="muted">Aucun compte enregistré.</p> }

      <h4 style="margin-top:14px">{{ enEditionId() ? 'Modifier le compte' : 'Ajouter un compte' }}</h4>
      <div class="famille">
        <button type="button" class="mode-btn" [class.active]="famille_() === 'banque'" [disabled]="!!enEditionId()" (click)="choisirFamille('banque')">Compte bancaire</button>
        <button type="button" class="mode-btn" [class.active]="famille_() === 'mobile'" [disabled]="!!enEditionId()" (click)="choisirFamille('mobile')">Mobile money</button>
      </div>
      <div class="grid2">
        <div><label>Intitulé</label><input class="in" [(ngModel)]="form.intitule" name="ctIntitule" [placeholder]="famille_() === 'mobile' ? 'Ex. Orange Money du cabinet' : 'Ex. Compte courant BDM'" /></div>
        @if (famille_() === 'mobile') {
          <div>
            <label>Opérateur</label>
            <select class="in" [(ngModel)]="form.operateur" name="ctOperateur">
              <option value="">— choisir —</option>
              <option value="orange_money">Orange Money</option>
              <option value="moov_money">Moov Money</option>
              <option value="wave">Wave</option>
              <option value="sama_money">Sama Money</option>
              <option value="autre">Autre</option>
            </select>
          </div>
          <div><label>Numéro du portefeuille</label><input class="in" [(ngModel)]="form.telephone" name="ctTel" placeholder="Ex. 70 00 00 00" /></div>
        } @else {
          <div>
            <label>Usage</label>
            <select class="in" [(ngModel)]="form.type" name="ctUsage">
              <option value="fonctionnement">Fonctionnement</option>
              <option value="carpa">CARPA</option>
            </select>
          </div>
          <div><label>Banque</label><input class="in" [(ngModel)]="form.banque" name="ctBanque" placeholder="Ex. BDM SA" /></div>
          <div><label>N° de compte</label><input class="in" [(ngModel)]="form.numero" name="ctNumero" /></div>
          <div><label>Code banque</label><input class="in" [(ngModel)]="form.code_banque" name="ctCodeBanque" /></div>
          <div><label>Code guichet</label><input class="in" [(ngModel)]="form.code_guichet" name="ctCodeGuichet" /></div>
          <div><label>Clé RIB</label><input class="in" [(ngModel)]="form.cle_rib" name="ctCleRib" /></div>
          <div><label>IBAN</label><input class="in" [(ngModel)]="form.iban" name="ctIban" /></div>
          <div><label>BIC (SWIFT)</label><input class="in" [(ngModel)]="form.bic" name="ctBic" /></div>
        }
        <div class="col2">
          <label class="case"><input type="checkbox" [(ngModel)]="form.afficher_sur_factures" name="ctAfficher" /> Afficher ce compte sur les factures (informations de paiement)</label>
        </div>
      </div>
      <div class="btns">
        <button class="btn" (click)="enregistrer()" [disabled]="enCours()">{{ enCours() ? 'Enregistrement…' : (enEditionId() ? 'Enregistrer les modifications' : 'Ajouter') }}</button>
        @if (enEditionId()) { <button class="lien" (click)="annuler()">Annuler</button> }
      </div>
      @if (doublons().length) {
        <div class="doublon">
          <b>⚠ Un compte très proche existe déjà :</b>
          @for (d of doublons(); track d.id) { <p>{{ d.intitule }}@if (d.banque) { — {{ d.banque }} }@if (d.numero) { — {{ d.numero }} }</p> }
          <div class="btns">
            <button class="btn ghost" (click)="doublons.set([])">Annuler, je vérifie</button>
            <button class="btn" (click)="creerReellement()" [disabled]="enCours()">Ajouter quand même</button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [`
    .msg{font-size:var(--fs-base);color:var(--slate);margin:0 0 14px}
    .msg-err{color:var(--red);font-weight:600}
    .in{display:block;width:100%;border:1px solid var(--line);border-radius:8px;padding:9px 12px;margin:4px 0 12px;font-size:var(--fs-md)}
    label{font-size:var(--fs-sm);color:var(--slate);font-weight:600}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 16px;max-width:600px}
    .col2{grid-column:1 / -1}
    .btn{background:var(--gold);color:#1b2436;border:none;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer}
    .btn:disabled{opacity:.6}
    .famille{display:flex;gap:8px;margin:6px 0 12px}
    .mode-btn{background:#fff;border:1px solid var(--line);border-radius:8px;padding:8px 14px;font-size:var(--fs-base);cursor:pointer;color:var(--slate)}
    .mode-btn.active{background:var(--navy);color:#fff;border-color:var(--navy)}
    .mode-btn:disabled{opacity:.6;cursor:default}
    .case{display:flex;align-items:center;gap:8px;font-weight:400}
    .case input{width:auto}
    .doublon{background:#fffaf0;border:1px solid #f0dcae;border-radius:10px;padding:14px 16px;margin-top:12px}
    .doublon p{margin:4px 0;font-size:var(--fs-base)}
    .doublon .btns{display:flex;gap:8px;margin-top:10px}
    .btns{display:flex;gap:12px;align-items:center;margin-top:12px}
  `],
})
export class ComptesCabinetComponent implements OnInit {
  private readonly api = inject(ApiService);

  readonly comptes = signal<CompteBancaire[]>([]);
  readonly message = signal('');
  readonly messageErreur = signal(false);
  readonly doublons = signal<any[]>([]);
  readonly enCours = signal(false);
  readonly enEditionId = signal<string | null>(null);
  readonly famille_ = signal<'banque' | 'mobile'>('banque');
  form: any = this.formVide('banque');

  ngOnInit(): void { this.charger(); }

  private formVide(famille: 'banque' | 'mobile'): any {
    return famille === 'mobile'
      ? { type: 'mobile_money', operateur: '', afficher_sur_factures: true }
      : { type: 'fonctionnement', afficher_sur_factures: true };
  }

  charger(): void {
    this.api.comptesBancairesGestion().subscribe({ next: (c) => this.comptes.set(c), error: () => {} });
  }

  choisirFamille(f: 'banque' | 'mobile'): void {
    this.famille_.set(f);
    this.form = this.formVide(f);
    this.message.set('');
    this.messageErreur.set(false);
    this.doublons.set([]);
  }

  estBanque(c: CompteBancaire): boolean { return c.type === 'fonctionnement' || c.type === 'carpa'; }

  famille(c: CompteBancaire): string {
    if (c.type === 'mobile_money') return 'Mobile money';
    if (c.type === 'carpa') return 'Compte bancaire · CARPA';
    if (c.type === 'fonctionnement') return 'Compte bancaire · Fonctionnement';
    return 'Ancien type (' + (c.type === 'especes' ? 'espèces' : c.type === 'virement_etranger' ? 'virement étranger' : c.type) + '), à désactiver';
  }

  private readonly LIBELLES_OPERATEUR: Record<string, string> = {
    orange_money: 'Orange Money', moov_money: 'Moov Money', wave: 'Wave', sama_money: 'Sama Money', autre: 'Autre opérateur',
  };
  libelleOperateur(o: string | null): string { return o ? (this.LIBELLES_OPERATEUR[o] || o) : '—'; }

  actionsPourCompte(c: CompteBancaire): ActionMenuItem[] {
    const actions: ActionMenuItem[] = [];
    if (this.estBanque(c) || c.type === 'mobile_money') actions.push({ label: 'Modifier', action: () => this.modifier(c) });
    actions.push({ label: c.actif ? 'Désactiver' : 'Réactiver', action: () => this.basculer(c) });
    actions.push({ label: 'Supprimer', danger: true, action: () => this.supprimer(c) });
    return actions;
  }

  modifier(c: CompteBancaire): void {
    this.message.set('');
    this.messageErreur.set(false);
    this.doublons.set([]);
    this.famille_.set(c.type === 'mobile_money' ? 'mobile' : 'banque');
    this.form = { ...c, operateur: c.operateur ?? '' };
    this.enEditionId.set(c.id);
  }

  annuler(): void {
    this.enEditionId.set(null);
    this.form = this.formVide(this.famille_());
    this.message.set('');
    this.messageErreur.set(false);
  }

  enregistrer(): void {
    this.message.set('');
    this.messageErreur.set(false);
    this.doublons.set([]);
    const id = this.enEditionId();
    if (id) {
      this.enCours.set(true);
      this.api.majCompteBancaire(id, this.form).subscribe({
        next: () => { this.enCours.set(false); this.annuler(); this.message.set('Compte modifié.'); this.charger(); },
        error: (e) => { this.enCours.set(false); this.message.set(e?.error?.error ?? 'Modification impossible.'); this.messageErreur.set(true); },
      });
      return;
    }
    const cle = this.famille_() === 'mobile' ? this.form.telephone : this.form.numero;
    this.api.verifierDoublonCompteBancaire(this.form.intitule ?? '', cle).subscribe({
      next: (d) => { if (d.length) this.doublons.set(d); else this.creerReellement(); },
      error: () => this.creerReellement(),
    });
  }

  creerReellement(): void {
    this.doublons.set([]);
    this.enCours.set(true);
    this.api.creerCompteBancaire(this.form).subscribe({
      next: () => { this.enCours.set(false); this.form = this.formVide(this.famille_()); this.message.set('Compte ajouté.'); this.charger(); },
      error: (e) => { this.enCours.set(false); this.message.set(e?.error?.error ?? 'Ajout impossible.'); this.messageErreur.set(true); },
    });
  }

  basculer(c: CompteBancaire): void {
    this.message.set('');
    this.messageErreur.set(false);
    this.api.majCompteBancaire(c.id, { actif: !c.actif }).subscribe({
      next: () => this.charger(),
      error: (e) => { this.message.set(e?.error?.error ?? 'Mise à jour impossible.'); this.messageErreur.set(true); },
    });
  }

  supprimer(c: CompteBancaire): void {
    if (!confirm('Supprimer définitivement le compte « ' + c.intitule + ' » ? Cette action est irréversible.')) return;
    this.message.set('');
    this.messageErreur.set(false);
    this.api.supprimerCompteBancaire(c.id).subscribe({
      next: () => this.charger(),
      error: (e) => { this.message.set(e?.error?.error ?? 'Suppression impossible : désactivez le compte à la place.'); this.messageErreur.set(true); },
    });
  }
}
