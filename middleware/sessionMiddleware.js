import pool from "../config/db.js";

export const sessionMiddleware = async (req, res, next) => {
  // Normalize path to remove duplicate slashes (e.g. /api//login) which happens often on Vercel deployments
  const normalizedPath = req.path.replace(/\/+/g, '/');

  const isExcluded = normalizedPath.endsWith("/login") ||
    normalizedPath.endsWith("/login/stream") ||
    normalizedPath.includes("/whatsapp/webhook");

  if (isExcluded) {
    return next();
  }

  const sessionId = req.headers["x-session-id"];

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!sessionId || !uuidRegex.test(sessionId)) {
    return res.status(401).json({ error: "Session ID missing or invalid. Please log in.", force_logout: true });
  }

  try {
    const query = "SELECT is_active, username FROM sessions WHERE session_id = $1 LIMIT 1";
    const { rows } = await pool.query(query, [sessionId]);

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ error: "Session invalid or expired. Please log in again.", force_logout: true });
    }

    // Attach user info to request for downstream use if needed
    req.user = { username: rows[0].username };
    next();
  } catch (err) {
    console.error("Session Middleware Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
