// JURIA — Générateur de courriers, lot A (13/11/2026) : lettres à la juridiction (constitution en appel, constitution + renvoi,
// déclaration d'appel, réponse à sommation) et lignes « Audience » / « Nature » des moteurs PDF et Word.
const G = require("../src/courrier/gabarits");
const { genererCourrier, ErreurContenu } = require("../src/courrier/composer");
const bcrypt = require("bcryptjs");
const { pool } = require("./setup");

const NOUVEAUX = ["constitution_appel", "constitution_renvoi", "declaration_appel", "reponse_sommation"];
let signataireId;
beforeAll(async () => {
  const sfx = Math.random().toString(36).slice(2, 8);
  const { rows } = await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le, nom_signature, qualite_signature) " +
    "VALUES ($1,'Test','Lot A',$2,$3,'associe',TRUE,now(),'Me Test','Avocat au Barreau du Mali') RETURNING id",
    ["LA" + sfx, "test.lota." + sfx + "@jfcavocats-mali.com", await bcrypt.hash("x-LotA-123!", 4)]);
  signataireId = rows[0].id;
});
afterAll(async () => { await pool.end(); });

describe("Lot A : gabarits des lettres à la juridiction", () => {
  test("les 4 gabarits existent, avec un bloc de signature et des cases obligatoires", () => {
    const l = G.listerGabarits();
    NOUVEAUX.forEach((code) => {
      const g = l.find((x) => x.code === code);
      expect(g).toBeTruthy();
      expect(["psc", "con"]).toContain(g.bloc_signature);
      expect(g.champs.some((c) => c.cle === "paragraphes" && c.obligatoire)).toBe(true);
    });
  });

  test("les valeurs par défaut ne contiennent aucune donnée d'acte réel", () => {
    const interdits = /SAULER|FLUICONNECTO|COMATEX|TOUR[ÉE]|KANT[ÉE]|CAMARA|Wave|SISSOKO|COULIBALY|Sentinelle/i;
    NOUVEAUX.forEach((code) => expect(JSON.stringify(G.valeursParDefaut(code))).not.toMatch(interdits));
  });

  test("validation : affaire obligatoire en constitution en appel et en renvoi, destinataire obligatoire pour la réponse à sommation", () => {
    ["constitution_appel", "constitution_renvoi", "declaration_appel"].forEach((code) => {
      expect(G.validerContenu(code, {}).erreurs.map((e) => e.cle)).toContain("affaire");
      expect(G.validerContenu(code, { affaire: "A c/ B" }).erreurs).toEqual([]);
    });
    expect(G.validerContenu("reponse_sommation", {}).erreurs.map((e) => e.cle)).toContain("destinataire");
    expect(G.validerContenu("reponse_sommation", { destinataire: "Monsieur le Directeur Général\nde la société X" }).erreurs).toEqual([]);
  });

  test("audience et nature sont transmises à la lettre composée", () => {
    const { contenu } = G.validerContenu("constitution_renvoi", { affaire: "A c/ B", audience: "Audience du 13 décembre 2026", nature: "Divorce" });
    const l = G.composerLettre("constitution_renvoi", contenu, { nref: "DEP-2026-000001", signataire: { nom: "Me X", qualite: "" } });
    expect(l.audience).toBe("Audience du 13 décembre 2026");
    expect(l.nature).toBe("Divorce");
  });

  test("PDF et Word générés pour chacun des 4 gabarits, avec Nature et Audience dans le Word", async () => {
    for (const code of NOUVEAUX) {
      const valeurs = { affaire: "A c/ B", nature: "Nature de test", audience: "Audience de test", destinataire: "Monsieur le Directeur\nde la société X" };
      const r = await genererCourrier({ gabarit: code, valeurs, signataireId, nref: "DEP-2026-000777" });
      expect(r.pdf.slice(0, 5).toString()).toBe("%PDF-");
      expect(r.docx.length).toBeGreaterThan(1000);
      if (code === "constitution_renvoi") { expect(r.lettre.nature).toBe("Nature de test"); expect(r.lettre.audience).toBe("Audience de test"); }
    }
  });

  test("déclaration d'appel : formule d'appel et de politesse accordées au genre du destinataire", () => {
    const f = G.validerContenu("declaration_appel", { affaire: "A c/ B", destinataire: "Madame la Greffière en Cheffe\ndu Tribunal" }).contenu;
    expect(f.appel).toBe("Chère Maître,");
    expect(f.politesse).toContain("recevez Chère Maître, l'expression");
    const m = G.validerContenu("declaration_appel", { affaire: "A c/ B", destinataire: "Monsieur le Greffier en Chef\ndu Tribunal" }).contenu;
    expect(m.appel).toBe("Cher Maître,");
    expect(m.politesse).toContain("recevez Cher Maître, l'expression");
    // une formule saisie à la main est respectée
    const libre = G.validerContenu("declaration_appel", { affaire: "A c/ B", destinataire: "Madame la Greffière", appel: "Maître," }).contenu;
    expect(libre.appel).toBe("Maître,");
    expect(libre.politesse).toContain("recevez Maître, l'expression");
  });

  test("déclaration d'appel : article 172 proposé par défaut, bloc de signature « Le Conseil »", () => {
    const g = G.listerGabarits().find((x) => x.code === "declaration_appel");
    expect(g.bloc_signature).toBe("con");
    expect(G.valeursParDefaut("declaration_appel").paragraphes.join(" ")).toMatch(/article 172/);
  });

  test("ampliation : facultative, transmise à la lettre et imprimée en Word et PDF", async () => {
    const sans = G.validerContenu("reponse_sommation", { destinataire: "Monsieur le DG" });
    expect(sans.erreurs).toEqual([]);
    expect(sans.contenu.ampliation).toEqual([]);
    const { contenu } = G.validerContenu("reponse_sommation", { destinataire: "Monsieur le DG", ampliation: "Étude Untel, Huissiers\nBamako" });
    expect(G.composerLettre("reponse_sommation", contenu, { nref: "x", signataire: { nom: "Me X", qualite: "" } }).ampliation).toEqual(["Étude Untel, Huissiers", "Bamako"]);
    const r = await genererCourrier({ gabarit: "reponse_sommation", valeurs: { destinataire: "Monsieur le DG", ampliation: "Étude Untel, Huissiers" }, signataireId, nref: "DEP-2026-000778" });
    expect(r.pdf.slice(0, 5).toString()).toBe("%PDF-");
    const JSZip = require("jszip");
    const xml = await (await JSZip.loadAsync(r.docx)).file("word/document.xml").async("string");
    expect(xml).toContain("Ampliation");
    expect(xml).toContain("Étude Untel");
  });

  test("gabarit inconnu toujours refusé", async () => {
    await expect(genererCourrier({ gabarit: "inconnu", valeurs: {}, signataireId })).rejects.toBeInstanceOf(ErreurContenu);
  });
});
