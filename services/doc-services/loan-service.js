import pool from "../../config/doc-db.js";

// ==================== ALL LOANS ====================

// Create a new loan
export async function createLoan(loanData) {
    const {
        loan_name,
        bank_name,
        amount,
        emi,
        loan_start_date,
        loan_end_date,
        provided_document_name,
        upload_document,
        remarks
    } = loanData;

    const result = await pool.query(
        `INSERT INTO all_loans (
            loan_name,
            bank_name,
            amount,
            emi,
            loan_start_date,
            loan_end_date,
            provided_document_name,
            upload_document,
            remarks
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
            loan_name,
            bank_name,
            amount,
            emi,
            loan_start_date,
            loan_end_date,
            provided_document_name || null,
            upload_document || null,
            remarks || null
        ]
    );

    return result.rows[0];
}

// Get all loans
export async function getAllLoans() {
    const result = await pool.query(
        `SELECT * FROM all_loans ORDER BY created_at DESC`
    );
    return result.rows;
}

// Get loan by ID
export async function getLoanById(loanId) {
    const result = await pool.query(
        `SELECT * FROM all_loans WHERE id = $1`,
        [loanId]
    );
    return result.rows[0];
}

// Get loans with end date matching today (for foreclosure)
export async function getLoansForForeclosure() {
    const result = await pool.query(
        `SELECT * FROM all_loans 
         WHERE loan_end_date <= CURRENT_DATE
         AND id NOT IN (SELECT DISTINCT l.id FROM all_loans l 
                        INNER JOIN request_forclosure rf ON 
                        l.loan_name = rf.loan_name AND l.bank_name = rf.bank_name)
         ORDER BY loan_end_date ASC`
    );
    return result.rows;
}

// Update loan
export async function updateLoan(loanId, loanData) {
    const {
        loan_name,
        bank_name,
        amount,
        emi,
        loan_start_date,
        loan_end_date,
        provided_document_name,
        upload_document,
        remarks
    } = loanData;

    const result = await pool.query(
        `UPDATE all_loans SET
            loan_name = COALESCE($1, loan_name),
            bank_name = COALESCE($2, bank_name),
            amount = COALESCE($3, amount),
            emi = COALESCE($4, emi),
            loan_start_date = COALESCE($5, loan_start_date),
            loan_end_date = COALESCE($6, loan_end_date),
            provided_document_name = COALESCE($7, provided_document_name),
            upload_document = COALESCE($8, upload_document),
            remarks = COALESCE($9, remarks)
        WHERE id = $10
        RETURNING *`,
        [
            loan_name,
            bank_name,
            amount,
            emi,
            loan_start_date,
            loan_end_date,
            provided_document_name,
            upload_document,
            remarks,
            loanId
        ]
    );

    return result.rows[0];
}

// Delete loan
export async function deleteLoan(loanId) {
    const result = await pool.query(
        `DELETE FROM all_loans WHERE id = $1 RETURNING *`,
        [loanId]
    );
    return result.rows[0];
}

// ==================== REQUEST FORECLOSURE ====================

// Create foreclosure request
export async function createForeclosureRequest(requestData) {
    const {
        serial_no,
        loan_name,
        bank_name,
        amount,
        emi,
        loan_start_date,
        loan_end_date,
        request_date,
        requester_name
    } = requestData;

    const result = await pool.query(
        `INSERT INTO request_forclosure (
            serial_no,
            loan_name,
            bank_name,
            amount,
            emi,
            loan_start_date,
            loan_end_date,
            request_date,
            requester_name
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
            serial_no,
            loan_name,
            bank_name,
            amount,
            emi,
            loan_start_date,
            loan_end_date,
            request_date || new Date().toISOString().split('T')[0],
            requester_name
        ]
    );

    return result.rows[0];
}

// Get all foreclosure requests (history)
export async function getForeclosureHistory() {
    const result = await pool.query(
        `SELECT * FROM request_forclosure ORDER BY created_at DESC`
    );
    return result.rows;
}

// Get foreclosure requests pending NOC (not yet in collect_noc table)
export async function getForeclosuresPendingNOC() {
    const result = await pool.query(
        `SELECT rf.* FROM request_forclosure rf
         WHERE NOT EXISTS (
             SELECT 1 FROM collect_noc cn 
             WHERE cn.serial_no = rf.serial_no AND cn.collect_noc = true
         )
         ORDER BY rf.created_at DESC`
    );
    return result.rows;
}

// ==================== COLLECT NOC ====================

// Create/Update NOC collection
export async function createOrUpdateNOC(nocData) {
    const {
        serial_no,
        loan_name,
        bank_name,
        loan_start_date,
        loan_end_date,
        closure_request_date,
        collect_noc
    } = nocData;

    // Check if already exists
    const existing = await pool.query(
        `SELECT * FROM collect_noc WHERE serial_no = $1`,
        [serial_no]
    );

    if (existing.rows.length > 0) {
        // Update existing
        const result = await pool.query(
            `UPDATE collect_noc SET
                collect_noc = $1
            WHERE serial_no = $2
            RETURNING *`,
            [collect_noc, serial_no]
        );
        return result.rows[0];
    } else {
        // Insert new
        const result = await pool.query(
            `INSERT INTO collect_noc (
                serial_no,
                loan_name,
                bank_name,
                loan_start_date,
                loan_end_date,
                closure_request_date,
                collect_noc
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *`,
            [
                serial_no,
                loan_name,
                bank_name,
                loan_start_date,
                loan_end_date,
                closure_request_date,
                collect_noc || false
            ]
        );
        return result.rows[0];
    }
}

// Get pending NOC collections (collect_noc = false)
export async function getPendingNOCCollections() {
    const result = await pool.query(
        `SELECT * FROM collect_noc WHERE collect_noc = false ORDER BY created_at DESC`
    );
    return result.rows;
}

// Get NOC history (collect_noc = true)
export async function getNOCHistory() {
    const result = await pool.query(
        `SELECT * FROM collect_noc WHERE collect_noc = true ORDER BY created_at DESC`
    );
    return result.rows;
}

// Get all NOC records
export async function getAllNOCRecords() {
    const result = await pool.query(
        `SELECT * FROM collect_noc ORDER BY created_at DESC`
    );
    return result.rows;
}
