import pool from "../../config/doc-db.js";

// Create a new payment FMS request
export const createPaymentFms = async (data) => {
    const query = `
    INSERT INTO payment_fms (
      unique_no, fms_name, pay_to, amount, remarks, attachment,
      planned1, actual1, status, stage_remarks,
      planned2, actual2, payment_type,
      planned3, actual3
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    RETURNING *;
  `;

    const values = [
        data.uniqueNo,
        data.fmsName,
        data.payTo,
        data.amount,
        data.remarks || null,
        data.attachment || null,
        data.planned1 || null,
        data.actual1 || null,
        data.status || 'Pending',
        data.stageRemarks || null,
        data.planned2 || null,
        data.actual2 || null,
        data.paymentType || null,
        data.planned3 || null,
        data.actual3 || null
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
};

// Get all payment FMS records
export const getAllPaymentFms = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms ORDER BY created_at DESC"
    );
    return result.rows;
};

// Get payment FMS by ID
export const getPaymentFmsById = async (id) => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE id = $1",
        [id]
    );
    return result.rows[0];
};

// ==================== STAGE 1: APPROVAL ====================
// Pending: planned1 IS NOT NULL AND actual1 IS NULL
export const getApprovalPending = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE planned1 IS NOT NULL AND actual1 IS NULL ORDER BY created_at DESC"
    );
    return result.rows;
};

// History: planned1 IS NOT NULL AND actual1 IS NOT NULL
export const getApprovalHistory = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE planned1 IS NOT NULL AND actual1 IS NOT NULL ORDER BY actual1 DESC"
    );
    return result.rows;
};

// Process Approval: Update status, stage_remarks, and actual1 = today
export const processApproval = async (id, status, stageRemarks) => {
    const query = `
    UPDATE payment_fms 
    SET status = $1, stage_remarks = $2, actual1 = CURRENT_DATE
    WHERE id = $3
    RETURNING *;
  `;
    const result = await pool.query(query, [status, stageRemarks, id]);
    return result.rows[0];
};

// ==================== STAGE 2: MAKE PAYMENT ====================
// Pending: planned2 IS NOT NULL AND actual2 IS NULL
export const getMakePaymentPending = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE planned2 IS NOT NULL AND actual2 IS NULL ORDER BY created_at DESC"
    );
    return result.rows;
};

// History: planned2 IS NOT NULL AND actual2 IS NOT NULL
export const getMakePaymentHistory = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE planned2 IS NOT NULL AND actual2 IS NOT NULL ORDER BY actual2 DESC"
    );
    return result.rows;
};

// Process Make Payment: Update payment_type and actual2 = today
export const processMakePayment = async (id, paymentType) => {
    const query = `
    UPDATE payment_fms 
    SET payment_type = $1, actual2 = CURRENT_DATE
    WHERE id = $2
    RETURNING *;
  `;
    const result = await pool.query(query, [paymentType, id]);
    return result.rows[0];
};

// ==================== STAGE 3: TALLY ENTRY ====================
// Pending: planned3 IS NOT NULL AND actual3 IS NULL
export const getTallyEntryPending = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE planned3 IS NOT NULL AND actual3 IS NULL ORDER BY created_at DESC"
    );
    return result.rows;
};

// History: planned3 IS NOT NULL AND actual3 IS NOT NULL
export const getTallyEntryHistory = async () => {
    const result = await pool.query(
        "SELECT * FROM payment_fms WHERE planned3 IS NOT NULL AND actual3 IS NOT NULL ORDER BY actual3 DESC"
    );
    return result.rows;
};

// Process Tally Entry: Update actual3 = today (bulk update for multiple IDs)
export const processTallyEntry = async (ids) => {
    const query = `
    UPDATE payment_fms 
    SET actual3 = CURRENT_DATE
    WHERE id = ANY($1::uuid[])
    RETURNING *;
  `;
    const result = await pool.query(query, [ids]);
    return result.rows;
};

// ==================== GENERAL FUNCTIONS ====================
// Update payment FMS record
export const updatePaymentFms = async (id, data) => {
    const query = `
    UPDATE payment_fms 
    SET 
      unique_no = COALESCE($1, unique_no),
      fms_name = COALESCE($2, fms_name),
      pay_to = COALESCE($3, pay_to),
      amount = COALESCE($4, amount),
      remarks = COALESCE($5, remarks),
      attachment = COALESCE($6, attachment),
      planned1 = COALESCE($7, planned1),
      actual1 = COALESCE($8, actual1),
      status = COALESCE($9, status),
      stage_remarks = COALESCE($10, stage_remarks),
      planned2 = COALESCE($11, planned2),
      actual2 = COALESCE($12, actual2),
      payment_type = COALESCE($13, payment_type),
      planned3 = COALESCE($14, planned3),
      actual3 = COALESCE($15, actual3)
    WHERE id = $16
    RETURNING *;
  `;

    const values = [
        data.uniqueNo,
        data.fmsName,
        data.payTo,
        data.amount,
        data.remarks,
        data.attachment,
        data.planned1,
        data.actual1,
        data.status,
        data.stageRemarks,
        data.planned2,
        data.actual2,
        data.paymentType,
        data.planned3,
        data.actual3,
        id
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
};

// Delete payment FMS record
export const deletePaymentFms = async (id) => {
    const result = await pool.query(
        "DELETE FROM payment_fms WHERE id = $1 RETURNING *",
        [id]
    );
    return result.rows[0];
};

// Get latest unique number for auto-generation
export const getLatestUniqueNo = async () => {
    const result = await pool.query(`
    SELECT unique_no 
    FROM payment_fms 
    ORDER BY created_at DESC 
    LIMIT 1
  `);
    return result.rows[0]?.unique_no || null;
};
