const jwt = require("jsonwebtoken");
const User = require("../models/User");

const JWT_SECRET = process.env.JWT_SECRET || "safetest_jwt_secret_key_development_only";

// Protect routes for authenticated users
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);

      req.user = await User.findById(decoded.id).select("-password");
      if (!req.user) {
        return res.status(401).json({ error: "User not found or deleted" });
      }

      next();
    } catch (error) {
      console.error("Auth token verification error:", error.message);
      return res.status(401).json({ error: "Not authorized, token invalid or expired" });
    }
  } else {
    return res.status(401).json({ error: "Not authorized, no token provided" });
  }
};

// Authorize roles (e.g. 'teacher', 'admin')
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Role '${req.user ? req.user.role : "unknown"}' cannot perform this action.`,
      });
    }
    next();
  };
};

module.exports = { protect, requireRole, JWT_SECRET };
