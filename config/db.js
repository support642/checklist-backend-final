import pg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST?.trim(),
  user: process.env.DB_USER?.trim(),
  password: process.env.DB_PASSWORD?.trim(),
  database: process.env.DB_NAME?.trim(),
  port: parseInt(process.env.DB_PORT?.trim() || "5432"),
  ssl: { rejectUnauthorized: false }, // required for AWS RDS
});

pool
  .connect()
  .then(() => console.log("✅ Connected to AWS RDS PostgreSQL"))
  .catch((err) => console.error("❌ Database connection error:", err.message));

  export default pool;


