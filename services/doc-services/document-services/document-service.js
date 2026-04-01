import pool from "../../../config/doc-db.js";

// Create a new document
export async function createDocument(documentData) {
    const {
        document_name,
        document_type,
        category,
        company_department,
        tags,
        person_name,
        need_renewal,
        renewal_date,
        image,
        email,
        mobile
    } = documentData;

    const result = await pool.query(
        `INSERT INTO documents (
            document_name,
            document_type,
            category,
            company_department,
            tags,
            person_name,
            need_renewal,
            renewal_date,
            image,
            email,
            mobile
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *`,
        [
            document_name,
            document_type || null,
            category || null,
            company_department || null,
            tags || null,
            person_name || null,
            need_renewal || 'no',
            renewal_date || null,
            image || null,
            email || null,
            mobile || null
        ]
    );

    return result.rows[0];
}

// Get all documents (not deleted)
export async function getAllDocuments() {
    const result = await pool.query(
        `SELECT * FROM documents WHERE is_deleted = FALSE ORDER BY created_at DESC`
    );
    return result.rows;
}

// Get document by ID
export async function getDocumentById(documentId) {
    const result = await pool.query(
        `SELECT * FROM documents WHERE document_id = $1 AND is_deleted = FALSE`,
        [documentId]
    );
    return result.rows[0];
}

// Update document
export async function updateDocument(documentId, documentData) {
    const {
        document_name,
        document_type,
        category,
        company_department,
        tags,
        person_name,
        need_renewal,
        renewal_date,
        image,
        email,
        mobile
    } = documentData;

    const result = await pool.query(
        `UPDATE documents SET
            document_name = COALESCE($1, document_name),
            document_type = COALESCE($2, document_type),
            category = COALESCE($3, category),
            company_department = COALESCE($4, company_department),
            tags = COALESCE($5, tags),
            person_name = COALESCE($6, person_name),
            need_renewal = COALESCE($7, need_renewal),
            renewal_date = COALESCE($8, renewal_date),
            image = COALESCE($9, image),
            email = COALESCE($10, email),
            mobile = COALESCE($11, mobile)
        WHERE document_id = $12 AND is_deleted = FALSE
        RETURNING *`,
        [
            document_name,
            document_type,
            category,
            company_department,
            tags,
            person_name,
            need_renewal,
            renewal_date,
            image,
            email,
            mobile,
            documentId
        ]
    );

    return result.rows[0];
}

// Soft delete document
export async function deleteDocument(documentId) {
    const result = await pool.query(
        `UPDATE documents SET is_deleted = TRUE WHERE document_id = $1 RETURNING *`,
        [documentId]
    );
    return result.rows[0];
}

// Get documents by category
export async function getDocumentsByCategory(category) {
    const result = await pool.query(
        `SELECT * FROM documents WHERE category = $1 AND is_deleted = FALSE ORDER BY created_at DESC`,
        [category]
    );
    return result.rows;
}

// Get documents needing renewal
export async function getDocumentsNeedingRenewal() {
    const result = await pool.query(
        `SELECT * FROM documents 
         WHERE need_renewal = 'yes' AND is_deleted = FALSE 
         ORDER BY renewal_date ASC`
    );

    return result.rows;
}

// Get document stats
export async function getDocumentStats() {
    const result = await pool.query(`
        SELECT 
            COUNT(*) as total,
            COUNT(CASE WHEN category = 'Personal' THEN 1 END) as personal,
            COUNT(CASE WHEN category = 'Company' THEN 1 END) as company,
            COUNT(CASE WHEN category = 'Director' THEN 1 END) as director,
            COUNT(CASE WHEN need_renewal = 'yes' THEN 1 END) as needs_renewal,
            COUNT(CASE WHEN created_at > NOW() - INTERVAL '7 days' THEN 1 END) as recent
        FROM documents WHERE is_deleted = FALSE
    `);
    return result.rows[0];
}
