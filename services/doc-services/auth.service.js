import pool from "../../config/db.js";

export async function loginService(username, password) {
  // Query the main database users table
  const result = await pool.query(
    `SELECT user_name, password, email_id, role, subscription_access_system FROM users WHERE user_name = $1`,
    [username]
  );

  if (result.rows.length === 0) return null;

  const user = result.rows[0];

  // Compare password
  if (password !== user.password) return null;

  const systemAccess = user.subscription_access_system?.systems || [];
  const pageAccess = user.subscription_access_system?.pages || [];

  return {
    user: {
      username: user.user_name,
      name: user.user_name,
      role: user.role || "employee",
      email: user.email_id,
      systemAccess,
      pageAccess,
    },
  };
}

