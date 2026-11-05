// JURIA — Générateur de courriers : erreur métier portant un statut HTTP (partagée par la rédaction et la signature).
class ErreurRedaction extends Error {
  constructor(statut, message) { super(message); this.statut = statut; }
}
module.exports = { ErreurRedaction };
