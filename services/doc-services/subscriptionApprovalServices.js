import pool from "../../config/doc-db.js";

// --------------------------------------------------
// FETCH Pending Approvals
// --------------------------------------------------
export const getPendingApprovals = async () => {
  const query = `
    SELECT *
    FROM subscription
    WHERE actual_2 IS NULL
      AND planned_2 IS NOT NULL
    ORDER BY id DESC;
  `;
  const res = await pool.query(query);
  return res.rows;
};

// --------------------------------------------------
// FETCH Approval History
// --------------------------------------------------
export const getApprovalHistory = async () => {
  const query = `
    SELECT 
      ah.id,
      ah.approval_no,
      ah.subscription_no,
      ah.approval_status AS approval,
      ah.note,
      ah.approved_by,
      ah.requested_on,
      s.subscriber_name
    FROM approval_history ah
    LEFT JOIN subscription s ON ah.subscription_no = s.subscription_no
    ORDER BY ah.id DESC;
  `;
  const res = await pool.query(query);
  return res.rows;
};

// --------------------------------------------------
// UPDATE Subscription Approval Status
// --------------------------------------------------
export const updateApprovalStatus = async ({
  subscriptionNo,
  approval,
  companyName,
  subscriberName,
  subscriptionName,
  price,
  frequency,
  purpose
}) => {
  let updateFields = [
    "actual_2 = NOW()",
    "approval_status = $1",
    "actual_3 = NULL",
    "updated_at = NOW()"
  ];
  let values = [approval, subscriptionNo];
  let paramIndex = 3;

  if (companyName !== undefined) {
    updateFields.push(`company_name = $${paramIndex++}`);
    values.push(companyName);
  }
  if (subscriberName !== undefined) {
    updateFields.push(`subscriber_name = $${paramIndex++}`);
    values.push(subscriberName);
  }
  if (subscriptionName !== undefined) {
    updateFields.push(`subscription_name = $${paramIndex++}`);
    values.push(subscriptionName);
  }
  if (price !== undefined) {
    updateFields.push(`price = $${paramIndex++}`);
    values.push(price);
  }
  if (frequency !== undefined) {
    updateFields.push(`frequency = $${paramIndex++}`);
    values.push(frequency);
  }
  if (purpose !== undefined) {
    updateFields.push(`purpose = $${paramIndex++}`);
    values.push(purpose);
  }

  const query = `
    UPDATE subscription
    SET ${updateFields.join(", ")}
    WHERE subscription_no = $2
    RETURNING *;
  `;
  
  const res = await pool.query(query, values);
  return res.rows[0];
};

// --------------------------------------------------
// INSERT Into APPROVAL HISTORY
// --------------------------------------------------
export const insertApprovalHistory = async ({
  subscriptionNo,
  approval,
  note,
  approvedBy,
  requestedOn,
}) => {

  const countRes = await pool.query(`
    SELECT COUNT(*) FROM approval_history
  `);
  const next = Number(countRes.rows[0].count) + 1;
  const approvalNo = `APG-${String(next).padStart(4, "0")}`;

  const query = `
    INSERT INTO approval_history (
      approval_no, subscription_no, approval_status, note,
      approved_by, requested_on
    )
    VALUES ($1,$2,$3,$4,$5,$6)
    RETURNING *;
  `;
  const values = [
    approvalNo,
    subscriptionNo,
    approval,
    note,
    approvedBy,
    requestedOn
  ];

  const res = await pool.query(query, values);
  return res.rows[0];
};
