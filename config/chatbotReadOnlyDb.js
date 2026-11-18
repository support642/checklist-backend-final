import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

// Dedicated READ-ONLY pool for the AI chatbot's data-analysis tools.
//
// `default_transaction_read_only=on` is enforced by PostgreSQL itself for every
// statement on these connections, so any INSERT / UPDATE / DELETE / DDL sent
// through this pool is rejected by the database ("cannot execute ... in a
// read-only transaction"), even if the application code had a bug.
// `statement_timeout` stops a heavy AI-triggered query from loading the server.
const readOnlyPool = new Pool({
    host: process.env.DB_HOST?.trim(),
    user: process.env.DB_USER?.trim(),
    password: process.env.DB_PASSWORD?.trim(),
    database: process.env.DB_NAME?.trim(),
    port: parseInt(process.env.DB_PORT?.trim() || "5432"),
    ssl: { rejectUnauthorized: false },
    max: 5,
    options: "-c default_transaction_read_only=on -c statement_timeout=20000"
});

readOnlyPool.on("error", (err) => {
    console.error("Chatbot read-only pool error:", err.message);
});

export default readOnlyPool;
