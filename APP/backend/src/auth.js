// JURIA — authentification (jeton JWT) et contrôle des rôles
const jwt = require("jsonwebtoken");

const SECRET = process.env.JWT_SECRET || "dev-secret-a-changer";

// Middleware : vérifie le jeton et attache req.user = { sub, role, nom }
function authenticate(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Token manquant" });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

// Middleware d'autorisation : requireRole('associe', 'comptable')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Accès refusé (rôle insuffisant)" });
    }
    next();
  };
}

module.exports = { authenticate, requireRole, SECRET };
