import pool from "./db.js";

// Chatbot connects to the existing AWS RDS PostgreSQL pool (read queries for tasks, users, and reporting)
// Zero database schema alterations or migrations are executed.
export default pool;
