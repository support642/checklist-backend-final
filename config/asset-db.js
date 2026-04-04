import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
dotenv.config();

const pool = new Pool({
    user: process.env.DB_USER?.trim(),
    host: process.env.DB_HOST?.trim(),
    database: process.env.AM_DB_NAME?.trim(),
    password: process.env.DB_PASSWORD?.trim(),
    port: parseInt(process.env.DB_PORT?.trim() || "5432"),
    ssl: { rejectUnauthorized: false },
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL Database established');
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle pg client', err);
    process.exit(-1);
});

export const query = (text, params) => pool.query(text, params);
export { pool };

export default {
    query,
    pool
};
