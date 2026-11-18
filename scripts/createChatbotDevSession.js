import { randomUUID } from "crypto";
import pool from "../config/chatbotDb.js";

const username = process.argv[2] || "aditya.jha";

try {
    const userResult = await pool.query(
        `SELECT user_name
         FROM users
         WHERE user_name = $1
         LIMIT 1`,
        [username]
    );

    if (userResult.rows.length === 0) {
        throw new Error(`Mock user '${username}' was not found.`);
    }

    const sessionId = randomUUID();

    await pool.query(
        `INSERT INTO sessions (session_id, username, is_active)
         VALUES ($1, $2, TRUE)`,
        [sessionId, username]
    );

    console.log("\nLocal development session created successfully.");
    console.log("Username:", username);
    console.log("Session ID:", sessionId);
    console.log("\nKeep this session ID private. Do not share it.");

} catch (error) {
    console.error("Session creation failed:", error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
