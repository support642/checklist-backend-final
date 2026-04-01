import pool from "../../config/doc-db.js";

export async function getAllSubscriptionsService(subscriberName, role) {
  let query = `
      SELECT 
        subscription_no,
        company_name,
        subscriber_name,
        subscription_name,
        price,
        start_date,
        end_date
      FROM subscription
      ORDER BY id DESC
  `;

  let values = [];

  // If user is NOT admin → show only their subscriptions
  if (role !== "admin") {
    query = `
      SELECT 
        subscription_no,
        company_name,
        subscriber_name,
        subscription_name,
        price,
        start_date,
        end_date
      FROM subscription
      WHERE subscriber_name = $1
      ORDER BY id DESC
    `;
    values = [subscriberName];
  }

  const result = await pool.query(query, values);
  return result.rows;
}
