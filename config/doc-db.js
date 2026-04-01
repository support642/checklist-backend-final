import pg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pg;

const docPool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DOC_DB_NAME,
  port: process.env.DB_PORT,
  ssl: { rejectUnauthorized: false }, // required for AWS RDS
});

docPool
  .connect()
  .then(() => console.log("✅ Connected to Documentation Module DB"))
  .catch((err) => console.error("❌ Database connection error:", err.message));

export default docPool;
