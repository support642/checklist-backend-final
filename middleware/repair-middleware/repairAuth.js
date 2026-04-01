import pool from "../../config/db.js";
import { buildUnifiedPermissions, hasPermission } from "../../utils/permissionAdapter.js";

/**
 * Middleware to authenticate and attach permissions for the repair module.
 */
export async function repairAuthMiddleware(req, res, next) {
  // Extract user info (username is required)
  const username = req.headers["x-user-name"] || req.query.username || req.body.username;

  if (!username) {
    return res.status(401).json({ error: "Not authorized. Please log in through the main application." });
  }

  try {
    // 1. Fetch user data including permissions
    const query = `
      SELECT user_name, role, system_access, page_access 
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
    console.error("Repair Auth Middleware Error:", err);
    res.status(500).json({ error: "Authentication internal error" });
  }
}

/**
 * Middleware factory for checking permissions on specific repair routes.
 */
export const checkRepairPermission = (page, action) => {
  return (req, res, next) => {
    if (!req.permissions) {
      return res.status(403).json({ error: "No permissions loaded for user." });
    }

    // Module is always 'repair'
    if (hasPermission(req.permissions, 'repair', page, action)) {
      return next();
    }

    res.status(403).json({ 
      error: `Insufficient permissions. Access to repair module (${page}.${action}) denied.` 
    });
  };
};
