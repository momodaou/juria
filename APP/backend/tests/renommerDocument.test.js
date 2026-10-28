// JURIA — renommage des pièces de la GED (28/10/2026) : au téléversement et après coup.
const request = require("supertest");
const app = require("../server");
const { nomAvecExtension } = require("../src/nomDocument");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;
let userId;
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  userId = login.body.utilisateur.id;
});
afterAll(async () => { await pool.end(); });

async function dossier() {
  const client = await request(app).post("/api/clients").set(auth())
    .send({ type: "morale", denomination: `Client REN ${Date.now()}-${Math.random()}` });
  const d = await request(app).post("/api/dossiers").set(auth()).send({
    client_id: client.body.id, intitule: "Dossier test renommage", pole: "contentieux",
    matiere: "Droit civil", mode_honoraires: "forfait", urgence: "moyenne", responsable_id: userId,
  });
  return d.body.id;
}

describe("nomAvecExtension", () => {
  test("verrouille l'extension de référence", () => {
    expect(nomAvecExtension("Contrat de bail", "scan0001.pdf")).toBe("Contrat de bail.pdf");
    expect(nomAvecExtension("Contrat de bail.pdf", "scan0001.pdf")).toBe("Contrat de bail.pdf");
    expect(nomAvecExtension("Contrat.docx", "scan.pdf")).toBe("Contrat.docx.pdf");
  });
  test("nettoie séparateurs et espaces, refuse vide et trop long", () => {
    expect(nomAvecExtension("  a/b\\c   d ", "x.pdf")).toBe("a b c d.pdf");
    expect(() => nomAvecExtension("   ", "x.pdf")).toThrow(/vide/);
    expect(() => nomAvecExtension(".pdf", "x.pdf")).toThrow(/vide/);
    expect(() => nomAvecExtension("a".repeat(300), "x.pdf")).toThrow(/trop long/);
  });
});

describe("Renommer une pièce", () => {
  test("au téléversement : nom choisi + extension d'origine conservée", async () => {
    const id = await dossier();
    const r = await request(app).post("/api/documents").set(auth()).field("dossier_id", id).field("nom", "Pièce n°1 — bail")
      .attach("fichier", Buffer.from("x"), { filename: "scan0001.txt", contentType: "text/plain" });
    expect(r.status).toBe(201);
    expect(r.body.nom).toBe("Pièce n°1 — bail.txt");
  });

  test("sans nom saisi : nom du fichier d'origine", async () => {
    const id = await dossier();
    const r = await request(app).post("/api/documents").set(auth()).field("dossier_id", id).field("nom", "  ")
      .attach("fichier", Buffer.from("x"), { filename: "scan0002.txt", contentType: "text/plain" });
    expect(r.body.nom).toBe("scan0002.txt");
  });

  test("après coup : renommage, extension verrouillée, journal d'audit, téléchargement OK", async () => {
    const id = await dossier();
    const up = await request(app).post("/api/documents").set(auth()).field("dossier_id", id)
      .attach("fichier", Buffer.from("contenu"), { filename: "scan0003.txt", contentType: "text/plain" });
    const r = await request(app).put(`/api/documents/${up.body.id}/nom`).set(auth()).send({ nom: "Mise en demeure.pdf" });
    expect(r.status).toBe(200);
    expect(r.body.nom).toBe("Mise en demeure.pdf.txt");
    const r2 = await request(app).put(`/api/documents/${up.body.id}/nom`).set(auth()).send({ nom: "Mise en demeure" });
    expect(r2.body.nom).toBe("Mise en demeure.txt");
    const audit = await pool.query("SELECT details FROM journal_audit WHERE action='document_renomme' AND entite_id=$1 ORDER BY id", [up.body.id]);
    expect(audit.rows.length).toBe(2);
    expect(audit.rows[1].details.avant).toBe("Mise en demeure.pdf.txt");
    expect(audit.rows[1].details.apres).toBe("Mise en demeure.txt");
    const dl = await request(app).get(`/api/documents/${up.body.id}/download`).set(auth());
    expect(dl.status).toBe(200);
    expect(dl.text).toBe("contenu");
  });

  test("nom vide → 400 ; document inconnu → 404 ; renommer au même nom ne journalise rien", async () => {
    const id = await dossier();
    const up = await request(app).post("/api/documents").set(auth()).field("dossier_id", id)
      .attach("fichier", Buffer.from("x"), { filename: "a.txt", contentType: "text/plain" });
    expect((await request(app).put(`/api/documents/${up.body.id}/nom`).set(auth()).send({ nom: " " })).status).toBe(400);
    expect((await request(app).put(`/api/documents/00000000-0000-0000-0000-000000000000/nom`).set(auth()).send({ nom: "b" })).status).toBe(404);
    await request(app).put(`/api/documents/${up.body.id}/nom`).set(auth()).send({ nom: "a" });
    const audit = await pool.query("SELECT 1 FROM journal_audit WHERE action='document_renomme' AND entite_id=$1", [up.body.id]);
    expect(audit.rows.length).toBe(0);
  });
});
