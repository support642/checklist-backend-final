import pool from "../config/db.js";

export const sessionMiddleware = async (req, res, next) => {
  // Exclude login and SSE stream from session check
  const excludedPaths = ["/api/login", "/api/login/stream"];
  if (excludedPaths.some(path => req.path.startsWith(path))) {
    return next();
  }

  const sessionId = req.headers["x-session-id"];

  if (!sessionId) {
    return res.status(401).json({ error: "Session ID missing. Please log in.", force_logout: true });
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
