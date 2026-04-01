import pool from "../../config/doc-db.js";
import { toCamel } from "../../utils/caseConverter.js";

// Get all subscriptions (admin)
export async function getAllSubscriptionsService() {
  const result = await pool.query(`SELECT * FROM subscription ORDER BY id DESC`);
  return toCamel(result.rows);
}

// Get subscriptions for logged in user only
export async function getMySubscriptionsService(subscriberName) {
  const result = await pool.query(
    `SELECT * FROM subscription WHERE subscriber_name = $1 ORDER BY id DESC`,
    [subscriberName]
  );
  return toCamel(result.rows);
}

// Dashboard aggregated data
export async function getDashboardStatsService(subscriberName, role) {

  let query = `
    SELECT *
    FROM subscription
    ORDER BY id DESC
  `;
  let values = [];

  // If user is not admin → filter by their subscriber_name
  if (role !== "admin") {
    query = `
      SELECT *
      FROM subscription
      WHERE subscriber_name = $1
      ORDER BY id DESC
    `;
    values = [subscriberName];
  }

  const result = await pool.query(query, values);
  const subscriptionSheet = toCamel(result.rows);

  const totalValue = subscriptionSheet.reduce(
    (sum, row) => sum + (parseFloat(row.price) || 0),
    0,
  );

  return {
    subscriptionSheet,
    stats: {
      totalValue: Number(totalValue.toFixed(2)),
      totalSubscriptions: subscriptionSheet.length,
    },
  };
}


export async function getDashboardNamesService() {
  const result = await pool.query(
    `SELECT DISTINCT subscriber_name AS subscriber_name
     FROM subscription
     WHERE subscriber_name IS NOT NULL AND subscriber_name <> ''
     ORDER BY subscriber_name ASC`
  );
  return toCamel(result.rows);
}
