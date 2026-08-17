// JURIA — liste blanche de types de fichiers acceptés en téléversement
// (pièces GED, KYC, bibliothèque). Rejette les autres types dès multer,
// avant même d'atteindre le stockage.
const TYPES_AUTORISES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain",
]);

// Utilisable comme option `fileFilter` de multer.
function filtreTypeFichier(req, file, cb) {
  if (TYPES_AUTORISES.has(file.mimetype)) return cb(null, true);
  cb(new Error(`Type de fichier non autorisé (${file.mimetype}). Formats acceptés : PDF, images, Word, Excel, PowerPoint, texte brut.`));
}

module.exports = { filtreTypeFichier, TYPES_AUTORISES };
