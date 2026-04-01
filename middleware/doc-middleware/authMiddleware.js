import pool from "../../config/db.js";
import { buildUnifiedPermissions, hasPermission } from "../../utils/permissionAdapter.js";

export async function authMiddleware(req, res, next) {
  // Extract user info (username is required)
  const username = req.headers["x-user-name"] || req.query.username || req.body.username;

  if (!username) {
    return res.status(401).json({ error: "Not authorized. Please log in through the main application." });
  }

  try {
    // 1. Fetch full user data including all permission formats
    const query = `
      SELECT user_name, role, system_access, page_access, subscription_access_system
      FROM users 
      WHERE user_name = $1
      LIMIT 1
    `;
    const { rows } = await pool.query(query, [username]);

    if (rows.length === 0) {
      return res.status(401).json({ error: "User not found or session invalid." });
    }

    const user = rows[0];

    // 2. Populate req.user
    req.user = {
      username: user.user_name,
      role: user.role || "user"
    };

    // 3. Attach Unified Permissions to request
    req.permissions = buildUnifiedPermissions(user);

    next();
  } catch (err) {
    console.error("Auth Middleware Error:", err);
    res.status(500).json({ error: "Authentication internal error" });
  }
}

/**
 * Middleware factory for checking permissions on specific routes.
 * @param {string} module 
 * @param {string} page 
 * @param {string} action - 'view' or 'modify'
 */
export const checkPermission = (module, page, action) => {
  return (req, res, next) => {
    if (!req.permissions) {
      return res.status(403).json({ error: "No permissions loaded for user." });
    }

    if (hasPermission(req.permissions, module, page, action)) {
      return next();
    }

    res.status(403).json({
      error: `Insufficient permissions. Ask super_admin to access ${module}.${page}.${action}`
    });
  };
};
