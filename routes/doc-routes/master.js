import express from "express";
import pool from "../../config/doc-db.js";

const router = express.Router();

// Get all master data
router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT company_name, document_type, category, renewal_filter 
             FROM subscription_master
             ORDER BY company_name`
        );
        // Add a generated id for frontend use
        const dataWithIds = result.rows.map((row, index) => ({
            id: index + 1,
            ...row
        }));
        res.json({ success: true, data: dataWithIds });
    } catch (err) {
        console.error("Get Master Error:", err);
        res.status(500).json({ error: "Failed to load master data", details: err.message });
    }
});

// Get company names only (for dropdowns)
router.get("/company-names", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT company_name FROM subscription_master ORDER BY company_name`
        );
        const names = result.rows.map(r => r.company_name);
        res.json({ companyName: names });
    } catch (err) {
        res.status(500).json({ error: "Failed to load company names" });
    }
});

// Get document types only (for dropdowns)
router.get("/document-types", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT document_type FROM subscription_master ORDER BY document_type`
        );
        const types = result.rows.map(r => r.document_type);
        res.json({ documentTypes: types });
    } catch (err) {
        res.status(500).json({ error: "Failed to load document types" });
    }
});

// Get categories only (for dropdowns)
router.get("/categories", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT DISTINCT category FROM subscription_master ORDER BY category`
        );
        const categories = result.rows.map(r => r.category);
        res.json({ categories: categories });
    } catch (err) {
        res.status(500).json({ error: "Failed to load categories" });
    }
});

// Create master record
router.post("/", async (req, res) => {
    try {
        const { company_name, document_type, category, renewal_filter } = req.body;

        // At least one field should be provided
        if (!company_name && !document_type && !category) {
            return res.status(400).json({ error: "At least one of company_name, document_type, or category is required" });
        }

        const result = await pool.query(
            `INSERT INTO subscription_master (company_name, document_type, category, renewal_filter)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [company_name || '', document_type || '', category || '', renewal_filter || false]
        );

        res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
        console.error("Create Master Error:", err);
        res.status(500).json({ error: "Failed to create master record", details: err.message });
    }
});

// Delete master record by compound key
router.delete("/", async (req, res) => {
    try {
        const { company_name, document_type, category } = req.body;

        if (!company_name || !document_type || !category) {
            return res.status(400).json({ error: "company_name, document_type, and category are required" });
        }

        const result = await pool.query(
            `DELETE FROM subscription_master 
             WHERE company_name = $1 AND document_type = $2 AND category = $3
             RETURNING *`,
            [company_name, document_type, category]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Master record not found" });
        }

        res.json({ success: true, message: "Master record deleted" });
    } catch (err) {
        console.error("Delete Master Error:", err);
        res.status(500).json({ error: "Failed to delete master record" });
    }
});

export default router;


