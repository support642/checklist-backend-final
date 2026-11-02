import pool from "../config/db.js";

// SQL fragment: keeps only rows whose doer is an existing, active user.
// `nameRef` is the (qualified) task column holding the doer name, e.g. "checklist.name" or "t.name".
export const activeDoerClause = (nameRef) => ` AND EXISTS (
  SELECT 1 FROM users au
  WHERE LOWER(TRIM(au.user_name)) = LOWER(TRIM(${nameRef}))
    AND LOWER(COALESCE(au.status::text, 'active')) = 'active'
) `;

// Returns the distinct doer names that are not an existing active user.
export const findInvalidDoers = async (names, db = pool) => {
  const unique = [...new Set((names || []).map((n) => String(n ?? "").trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const { rows } = await db.query(
    `SELECT LOWER(TRIM(user_name)) AS name FROM users
     WHERE LOWER(COALESCE(status::text, 'active')) = 'active'
       AND LOWER(TRIM(user_name)) = ANY($1)`,
    [unique.map((n) => n.toLowerCase())]
  );
  const valid = new Set(rows.map((r) => r.name));
  return unique.filter((n) => !valid.has(n.toLowerCase()));
};
