// JURIA — Générateur de courriers, lot 1 (05/11/2026) : réglages du cabinet, cachet, signatures, permission courriers.signer.
const zlib = require("zlib");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const { SECRET } = require("../src/auth");
const { estAutorise } = require("../src/permissions");
const R = require("../src/courrier/reglages");
const { EMAIL_TEST, MDP_TEST, assurerUtilisateurTest, pool } = require("./setup");

let token;

// PNG minimal valide : type de couleur 6 (RVBA) ou 2 (RVB, sans transparence)
function png(largeur, hauteur, typeCouleur) {
  const canaux = typeCouleur === 6 ? 4 : 3;
  const brut = Buffer.alloc((largeur * canaux + 1) * hauteur);
  const bloc = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const t = Buffer.from(type, "latin1");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data])) >>> 0);
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(largeur, 0); ihdr.writeUInt32BE(hauteur, 4); ihdr[8] = 8; ihdr[9] = typeCouleur;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloc("IHDR", ihdr), bloc("IDAT", zlib.deflateSync(brut)), bloc("IEND", Buffer.alloc(0))]);
}

async function creerUtilisateurRole(role) {
  const suffixe = Math.random().toString(36).slice(2, 9);
  const hash = await bcrypt.hash("TestCourrierLot1-123!", 10);
  const { rows } = await pool.query(
    "INSERT INTO utilisateurs (code, prenom, nom, email, mot_de_passe, role, actif, valide_le) " +
    "VALUES ($1,'Test','Lot1',$2,$3,$4::role_utilisateur,TRUE,now()) RETURNING id",
    ["L1" + suffixe.slice(0, 6), "test.lot1." + suffixe + "@jfcavocats-mali.com", hash, role]);
  const jeton = jwt.sign({ sub: rows[0].id, role, nom: "Test Lot1" }, SECRET, { expiresIn: "1h" });
  return { id: rows[0].id, token: jeton };
}

const REGLAGES_DEFAUT = {
  courrier_logo_defaut: "mali", courrier_decor: true, courrier_texte_x_page1_cm: 6.2, courrier_colonne_droite_cm: 10.3,
  courrier_page1_haut_cm: 3.5, courrier_page1_bas_cm: 27.1, courrier_cachet_largeur_cm: 5.4,
};
async function remettreDefauts() {
  const cols = Object.keys(REGLAGES_DEFAUT);
  await pool.query("UPDATE parametres_cabinet SET " + cols.map((c, i) => c + " = $" + (i + 1)).join(", ") +
    ", courrier_cachet_chemin = NULL, courrier_cachet_maj_le = NULL WHERE id = 1", cols.map((c) => REGLAGES_DEFAUT[c]));
}

beforeAll(async () => {
  await assurerUtilisateurTest();
  const login = await request(app).post("/auth/login").send({ email: EMAIL_TEST, mot_de_passe: MDP_TEST });
  token = login.body.token;
  await remettreDefauts();
});
afterAll(async () => { await remettreDefauts(); await pool.end(); });

const auth = (r, t = token) => r.set("Authorization", "Bearer " + t);

describe("Réglages du papier et du logo", () => {
  test("valeurs par défaut = mesures de la feuille vierge", async () => {
    const r = await auth(request(app).get("/api/courrier-reglages"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ logo_defaut: "mali", decor: true, texte_x_page1_cm: 6.2, colonne_droite_cm: 10.3, page1_haut_cm: 3.5, page1_bas_cm: 27.1, cachet_largeur_cm: 5.4 });
    expect(r.body.cachet.present).toBe(false);
  });

  test("modification valide, puis lecture par le moteur (mesures effectives)", async () => {
    const r = await auth(request(app).put("/api/courrier-reglages")).send({ courrier_texte_x_page1_cm: 6.35, courrier_logo_defaut: "std", courrier_decor: false });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ texte_x_page1_cm: 6.35, logo_defaut: "std", decor: false });
    const m = await R.mesuresEffectives();
    expect(m.page1.texteX).toBe(6.35);
    expect(m.droiteX).toBe(10.3);
    await remettreDefauts();
  });

  test("valeurs hors bornes ou inconnues : refusées", async () => {
    expect((await auth(request(app).put("/api/courrier-reglages")).send({ courrier_texte_x_page1_cm: 12 })).status).toBe(400);
    expect((await auth(request(app).put("/api/courrier-reglages")).send({ courrier_colonne_droite_cm: "abc" })).status).toBe(400);
    expect((await auth(request(app).put("/api/courrier-reglages")).send({ courrier_logo_defaut: "autre" })).status).toBe(400);
    expect((await auth(request(app).put("/api/courrier-reglages")).send({})).status).toBe(400);
  });

  test("écriture refusée sans parametres.cabinet.modifier ; lecture permise à qui peut enregistrer un courrier", async () => {
    const u = await creerUtilisateurRole("assistante");
    expect((await auth(request(app).get("/api/courrier-reglages"), u.token)).status).toBe(200);
    expect((await auth(request(app).put("/api/courrier-reglages"), u.token).send({ courrier_decor: false })).status).toBe(403);
    expect((await auth(request(app).post("/api/courrier-reglages/cachet"), u.token).attach("fichier", png(2, 2, 6), "c.png")).status).toBe(403);
  });
});

describe("Cachet du cabinet", () => {
  test("dépôt d'un PNG transparent, présence signalée sans jamais renvoyer l'image, retrait", async () => {
    const ok = await auth(request(app).post("/api/courrier-reglages/cachet")).attach("fichier", png(4, 3, 6), { filename: "cachet.png", contentType: "image/png" });
    expect(ok.status).toBe(201);
    const r = await auth(request(app).get("/api/courrier-reglages"));
    expect(r.body.cachet.present).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain("courrier/prive");
    expect(Buffer.compare(await R.lireCachet(), png(4, 3, 6))).toBe(0);
    expect((await auth(request(app).delete("/api/courrier-reglages/cachet"))).body.present).toBe(false);
    expect((await auth(request(app).get("/api/courrier-reglages"))).body.cachet.present).toBe(false);
  });

  test("refusés : PNG sans transparence, fichier non PNG, trop grand, absent", async () => {
    const rvb = await auth(request(app).post("/api/courrier-reglages/cachet")).attach("fichier", png(4, 3, 2), { filename: "c.png", contentType: "image/png" });
    expect(rvb.status).toBe(400);
    expect(rvb.body.error).toMatch(/transparent/i);
    const txt = await auth(request(app).post("/api/courrier-reglages/cachet")).attach("fichier", Buffer.from("pas une image du tout, juste du texte en clair ok"), { filename: "c.png", contentType: "image/png" });
    expect(txt.status).toBe(400);
    expect(R.validerPng(png(6000, 2, 6)).erreur).toMatch(/Dimensions/);
    expect((await auth(request(app).post("/api/courrier-reglages/cachet"))).status).toBe(400);
  });
});

describe("Signataires : qualité et signature", () => {
  test("qualité enregistrée ; signature déposée, lisible seulement par le serveur ; aucune route ne la renvoie", async () => {
    const s = await creerUtilisateurRole("associe");
    const q = await auth(request(app).put("/api/courrier-reglages/signataires/" + s.id)).send({ qualite_signature: "Avocat aux Barreaux du Mali & de Paris" });
    expect(q.status).toBe(200);
    const image = png(5, 5, 6);
    const dep = await auth(request(app).post("/api/courrier-reglages/signataires/" + s.id + "/signature")).attach("fichier", image, { filename: "sig.png", contentType: "image/png" });
    expect(dep.status).toBe(201);
    const liste = (await auth(request(app).get("/api/courrier-reglages"))).body.signataires.find((x) => x.id === s.id);
    expect(liste.qualite_signature).toBe("Avocat aux Barreaux du Mali & de Paris");
    expect(liste.signature.presente).toBe(true);
    expect(Object.keys(liste)).not.toContain("signature_chemin");
    expect(Buffer.compare(await R.lireSignature(s.id), image)).toBe(0);
    expect((await auth(request(app).get("/api/courrier-reglages/signataires/" + s.id + "/signature"))).status).toBe(404);
    const ret = await auth(request(app).delete("/api/courrier-reglages/signataires/" + s.id + "/signature"));
    expect(ret.body.presente).toBe(false);
    expect(await R.lireSignature(s.id)).toBeNull();
  });

  test("utilisateur inconnu : 404 ; identifiant invalide : 400 ; signature sans transparence : 400", async () => {
    const inconnu = "00000000-0000-4000-8000-000000000000";
    expect((await auth(request(app).put("/api/courrier-reglages/signataires/" + inconnu)).send({ qualite_signature: "x" })).status).toBe(404);
    expect((await auth(request(app).put("/api/courrier-reglages/signataires/pas-un-uuid")).send({ qualite_signature: "x" })).status).toBe(400);
    const s = await creerUtilisateurRole("associe");
    expect((await auth(request(app).post("/api/courrier-reglages/signataires/" + s.id + "/signature")).attach("fichier", png(4, 4, 2), { filename: "s.png", contentType: "image/png" })).status).toBe(400);
  });
});

describe("Permission courriers.signer", () => {
  test("cochée par défaut pour associé et associé-fondateur seulement", async () => {
    const u = await creerUtilisateurRole("associe");
    expect(await estAutorise("associe", "courriers.signer", u.id)).toBe(true);
    expect(await estAutorise("associe_fondateur", "courriers.signer", u.id)).toBe(true);
    for (const role of ["of_counsel", "collaborateur", "avocat_stagiaire", "juriste", "admin_general", "assistante", "comptable", "admin_it"]) {
      expect(await estAutorise(role, "courriers.signer", u.id)).toBe(false);
    }
  });
});
