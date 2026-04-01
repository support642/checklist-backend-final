import pool from "../../config/doc-db.js";

/* ---------------- FETCH PENDING RENEWAL ---------------- */
export async function fetchPendingRenewals() {
    const query = `
        SELECT 
            id,
            subscription_no,
            company_name,
            subscriber_name,
            subscription_name,
            price,
            frequency,
            end_date,
            reason_for_renewal,
            planned_1
        FROM subscription
        WHERE planned_1 IS NOT NULL
          AND actual_1 IS NULL
    `;
    const result = await pool.query(query);
    return result.rows;
}

/* ---------------- FETCH RENEWAL HISTORY ---------------- */
export async function fetchRenewalHistory() {
    const query = `
        SELECT sr.*, s.subscriber_name
        FROM subscription_renewals sr
        LEFT JOIN subscription s ON sr.subscription_no = s.subscription_no
        ORDER BY sr.timestamp DESC
    `;
    const result = await pool.query(query);
    return result.rows;
}

/* ---------------- INSERT RENEWAL ---------------- */
export async function insertRenewal(data) {
    const query = `
        INSERT INTO subscription_renewals
            (renewal_no, subscription_no, renewal_status, approved_by, price)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *
    `;
    const values = [
        data.renewal_no,
        data.subscription_no,
        data.renewal_status,
        data.approved_by,
        data.price
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
}

/* ---------------- UPDATE SUBSCRIPTION ---------------- */
export async function updateSubscriptionForRenewal(data) {
    let updateFields = [
        "actual_1 = $1",
        "actual_2 = NULL",
        "renewal_count = renewal_count + 1",
        "renewal_status = $2",
        "price = $4"
    ];
    let values = [data.actual_1, data.renewal_status, data.subscription_no, data.price];
    let paramIndex = 5;

    if (data.company_name !== undefined) {
        updateFields.push(`company_name = $${paramIndex++}`);
        values.push(data.company_name);
    }
    if (data.subscriber_name !== undefined) {
        updateFields.push(`subscriber_name = $${paramIndex++}`);
        values.push(data.subscriber_name);
    }
    if (data.subscription_name !== undefined) {
        updateFields.push(`subscription_name = $${paramIndex++}`);
        values.push(data.subscription_name);
    }
    if (data.frequency !== undefined) {
        updateFields.push(`frequency = $${paramIndex++}`);
        values.push(data.frequency);
    }
    if (data.end_date !== undefined) {
        updateFields.push(`end_date = $${paramIndex++}`);
        values.push(data.end_date);
    }

    const query = `
        UPDATE subscription
        SET ${updateFields.join(", ")}
        WHERE subscription_no = $3
    `;

    await pool.query(query, values);
}
