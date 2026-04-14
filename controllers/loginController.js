import pool from "../config/db.js";
import { randomUUID } from "crypto";

// Map to store active SSE connections: username -> Response[]
export const activeClients = new Map();

export const authStream = async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).end();
  }

  // Setup Server-Sent Events headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send an initial heartbeat to confirm connection
  res.write("data: connected\n\n");

  // Check if session exists for this user in DB
  try {
    const { rows } = await pool.query(
      "SELECT is_active FROM sessions WHERE username = $1 AND is_active = TRUE LIMIT 1",
      [username]
    );

    if (rows.length === 0) {
      // If no active session, trigger immediate logout
      res.write("event: force_logout\ndata: {}\n\n");
    }
  } catch (err) {
    console.error("SSE Session Check Error:", err);
  }

  if (!activeClients.has(username)) {
    activeClients.set(username, []);
  }
  activeClients.get(username).push(res);

  // Remove connection when client disconnects
  req.on("close", () => {
    const clients = activeClients.get(username) || [];
    activeClients.set(
      username,
      clients.filter((client) => client !== res)
    );
  });
};

export const triggerUserLogout = async (username) => {
  try {
    // 1. Invalidate sessions in DB
    await pool.query(
      "UPDATE sessions SET is_active = false WHERE username = $1",
      [username]
    );

    // 2. Trigger SSE logout event
    const clients = activeClients.get(username);
    if (clients && clients.length > 0) {
      clients.forEach((client) => {
        client.write("event: force_logout\ndata: {}\n\n");
      });
    }
  } catch (err) {
    console.error("Error in triggerUserLogout:", err);
  }
};

export const loginUserController = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password)
      return res.status(400).json({ error: "Username and Password are required" });

    // Query PostgreSQL
    const query = `
      SELECT user_name, password, role, status, email_id, number, user_access, unit, division, department, 
             system_access, page_access, subscription_access_system, designation
      FROM users 
      WHERE user_name = $1 AND password = $2
      LIMIT 1
    `;

    const { rows } = await pool.query(query, [username, password]);

    // No user found
    if (rows.length === 0) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = rows[0];

    // Create session_id
    const session_id = randomUUID();
    await pool.query(
      "INSERT INTO sessions (session_id, username, is_active) VALUES ($1, $2, TRUE)",
      [session_id, user.user_name]
    );

    return res.json({
      user_name: user.user_name,
      role: user.role,
      email_id: user.email_id,
      number: user.number,
      designation: user.designation,
      user_access: user.user_access,
      unit: user.unit,
      division: user.division,
      department: user.department,
      system_access: user.system_access,
      page_access: user.page_access,
      subscription_access_system: user.subscription_access_system,
      session_id: session_id
    });

  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
};
