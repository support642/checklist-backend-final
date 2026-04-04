import pg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pg;

const docPool = new Pool({
  host: process.env.DB_HOST?.trim(),
  user: process.env.DB_USER?.trim(),
  password: process.env.DB_PASSWORD?.trim(),
  database: process.env.DOC_DB_NAME?.trim(),
  port: process.env.DB_PORT?.trim(),
  ssl: { rejectUnauthorized: false }, // required for AWS RDS
});

docPool
  .connect()
  .then(() => console.log("✅ Connected to Documentation Module DB"))
  .catch((err) => console.error("❌ Database connection error:", err.message));

export default docPool;
