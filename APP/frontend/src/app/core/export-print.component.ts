import { Component, OnInit, inject } from '@angular/core';
import { ApiService } from './api.service';

// Export Excel/CSV + impression PDF « sur chaque écran » (règle métier
// transverse du cahier des charges — déjà présente dans la démo HTML
// fournie par l'utilisateur, jamais reconstruite dans JURIA jusqu'ici :
// gap signalé le 28/08/2026, « je croyais que des maquettes le
// montraient »). Rendu une seule fois dans app.component.ts, au-dessus de
// <router-outlet> (même patron que <app-messagerie-widget>) — entièrement
// générique, basé sur le DOM affiché (pas de câblage écran par écran) :
// - Exporter : sérialise chaque <table> visible dans #vue-active en CSV
//   (Excel), reproduit la logique de la démo (exportCSV()).
// - Imprimer / PDF : clone le HTML de #vue-active dans une fenêtre dédiée
//   avec un en-tête cabinet, masque boutons/champs de saisie (valeurs live
//   non fiables via innerHTML), puis déclenche l'impression navigateur
//   (reproduit imprimerVue()) — « imprimer / enregistrer en PDF » via la
//   boîte de dialogue native, pas un PDF généré serveur (cohérent avec
//   « n'importe quel écran », y compris des écrans qui n'ont pas de PDF
//   dédié comme la matrice de permissions).
@Component({
  selector: 'app-export-print',
  standalone: true,
  imports: [],
  template: `
    <div class="ep-barre">
      <button type="button" class="ep-btn" (click)="exporter()" title="Extraire l'écran courant en fichier Excel/CSV">⭳ Exporter (Excel)</button>
      <button type="button" class="ep-btn" (click)="imprimer()" title="Imprimer / enregistrer en PDF l'écran courant">🖶 Imprimer / PDF</button>
    </div>
  `,
  styles: [`
    .ep-barre{display:flex;justify-content:flex-end;gap:8px;padding:14px 28px 0}
    .ep-btn{background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 12px;font-size:12.5px;font-weight:600;color:var(--slate);cursor:pointer}
    .ep-btn:hover{border-color:var(--gold);color:var(--gold)}
    @media print { .ep-barre{display:none} }
  `],
})
export class ExportPrintComponent implements OnInit {
  private readonly api = inject(ApiService);
  private raisonSociale = 'JFC AVOCATS MALI';

  ngOnInit(): void {
    // Lecture ouverte (voir parametres.js) : disponible à tout rôle
    // authentifié, pas besoin de permission dédiée pour un en-tête d'impression.
    this.api.parametresCabinet().subscribe({
      next: (c) => { if (c?.raison_sociale) this.raisonSociale = c.raison_sociale; },
      error: () => {},
    });
  }

  private nomVue(): string {
    const h1 = document.querySelector('#vue-active h1');
    return (h1?.textContent || 'JURIA').replace(/[^\w -]/g, '').trim() || 'JURIA';
  }

  exporter(): void {
    const conteneur = document.getElementById('vue-active');
    const tables = conteneur ? conteneur.querySelectorAll('table') : [];
    if (!tables.length) { alert('Rien à exporter sur cet écran (aucun tableau).'); return; }
    let csv = '';
    tables.forEach((tb, ti) => {
      if (ti) csv += '\n';
      tb.querySelectorAll('tr').forEach((tr) => {
        const cellules = Array.from(tr.querySelectorAll('th,td')).map((c) => {
          const texte = (c.textContent || '').replace(/\s+/g, ' ').trim();
          return '"' + texte.replace(/"/g, '""') + '"';
        });
        if (cellules.join('').replace(/"/g, '').trim()) csv += cellules.join(';') + '\n';
      });
    });
    // BOM UTF-8 : Excel n'interprète correctement les accents qu'avec lui.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `JURIA_${this.nomVue().replace(/ /g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  imprimer(): void {
    const conteneur = document.getElementById('vue-active');
    if (!conteneur) return;
    const contenu = conteneur.innerHTML;
    const nom = this.nomVue();
    const w = window.open('', '_print', 'width=900,height=650');
    if (!w) { alert("Impression bloquée par le navigateur (pop-up) — autorisez les fenêtres pop-up pour JURIA."); return; }
    w.document.write(`<html><head><title>JURIA — ${nom}</title><style>
      body{font-family:Arial,Helvetica,sans-serif;color:#1F2A44;padding:24px}
      h1{font-size:18px;color:#1F2A44;border-bottom:2px solid #B08D57;padding-bottom:6px}
      .sub{color:#6B7280;font-size:12px;margin:2px 0 16px}
      table{border-collapse:collapse;width:100%;margin:10px 0;font-size:12px}
      th,td{border:1px solid #C7CDD6;padding:5px 8px;text-align:left}
      th{background:#1F2A44;color:#fff}
      button,input,select,.ep-barre{display:none!important}
    </style></head><body><h1>${this.raisonSociale} — JURIA · ${nom}</h1>
    <div class="sub">Édition du ${new Date().toLocaleString('fr-FR')} — document exporté depuis l'application</div>
    ${contenu}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }
}
