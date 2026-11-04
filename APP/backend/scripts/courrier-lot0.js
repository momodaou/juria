// JURIA — Générateur de courriers, lot 0 : fabrique les fichiers d'essai (Word, PDF, calibrage) dans un dossier.
//
// Usage (Docker) : node scripts/courrier-lot0.js <dossier de sortie>
//   COURRIER_SIGNATURES_DIR=<dossier des signatures> : produit aussi des PDF signés (cachet + signature de chaque associé).
const fs = require("fs");
const path = require("path");
const { genererPdf } = require("../src/courrier/moteurPdf");
const { genererDocx } = require("../src/courrier/moteurDocx");
const { genererCalibragePdf } = require("../src/courrier/calibragePdf");
const { standard, courte, constitution } = require("../src/courrier/contenuExemple");

async function main() {
  const sortieDir = path.resolve(process.argv[2] || "./sortie-lot0");
  fs.mkdirSync(sortieDir, { recursive: true });
  const ecrire = (nom, buf) => { fs.writeFileSync(path.join(sortieDir, nom), buf); console.log("•", nom, Math.round(buf.length / 1024), "Ko"); };

  for (const [nom, lettre] of [["lettre-standard", standard], ["lettre-courte", courte], ["lettre-constitution", constitution]]) {
    for (const sortie of ["A", "B"]) {
      const { buffer, pages } = await genererPdf(lettre, { sortie });
      ecrire(`essai-${sortie}-${nom}.pdf`, buffer);
      ecrire(`essai-${sortie}-${nom}.docx`, await genererDocx(lettre, { sortie, pages }));
      console.log("   pages :", pages);
    }
  }
  ecrire("calibrage-papier-en-tete.pdf", await genererCalibragePdf());

  const dir = process.env.COURRIER_SIGNATURES_DIR;
  if (dir && fs.existsSync(path.join(dir, "positions.json"))) {
    const pos = JSON.parse(fs.readFileSync(path.join(dir, "positions.json"), "utf8"));
    const signataires = {
      DAOU: ["Mohamed DAOU", "Avocat aux Barreaux du Mali & de Paris"],
      DJITEYE: ["Mahamane DJITEYE", "Avocat au Barreau du Mali"],
      KONATE: ["Mamadou I. KONATE", "Avocat aux Barreaux du Mali & de Paris"],
    };
    for (const [cle, [nom, qualite]] of Object.entries(signataires)) {
      const lettre = { ...standard, signature: { bloc: "psc", nom, qualite } };
      const signature = {
        cachetBuf: fs.readFileSync(path.join(dir, pos.cachet.fichier)), cachet: pos.cachet,
        sigBuf: fs.readFileSync(path.join(dir, pos[cle].fichier)), sig: pos[cle],
      };
      const { buffer } = await genererPdf(lettre, { sortie: "B", signature });
      ecrire(`essai-B-signe-${cle}.pdf`, buffer);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
