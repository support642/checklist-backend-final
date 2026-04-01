import pool from "../config/db.js";

const createSessionsTable = async () => {
  const query = `
    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      session_id UUID NOT NULL UNIQUE,
      username VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT TRUE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_username ON sessions(username);
    CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active);
  `;

  try {
    await pool.query(query);
    console.log("✅ Sessions table created or already exists.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creating sessions table:", err);
    process.exit(1);
  }
};

createSessionsTable();
