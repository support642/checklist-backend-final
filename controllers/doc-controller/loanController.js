import * as loanService from "../../services/doc-services/loan-service.js";
import { uploadDocumentImage } from "../../middleware/s3Upload.js";

// ==================== ALL LOANS ====================

// Create loan
export async function createLoan(req, res) {
    try {
        const loanData = { ...req.body };

        // If upload_document is base64, upload to S3
        if (loanData.upload_document && loanData.upload_document.startsWith('data:')) {
            try {
                const s3Url = await uploadDocumentImage(loanData.upload_document, loanData.loan_name);
                loanData.upload_document = s3Url;
            } catch (uploadErr) {
                console.error("S3 Upload Error:", uploadErr);
                loanData.upload_document = null;
            }
        }

        const loan = await loanService.createLoan(loanData);
        res.status(201).json({ success: true, loan });
    } catch (err) {
        console.error("Create Loan Error:", err);
        res.status(500).json({ error: "Failed to create loan", details: err.message });
    }
}

// Get all loans
export async function getAllLoans(req, res) {
    try {
        const loans = await loanService.getAllLoans();
        res.json({ success: true, loans });
    } catch (err) {
        console.error("Get Loans Error:", err);
        res.status(500).json({ error: "Failed to fetch loans" });
    }
}

// Get loan by ID
export async function getLoanById(req, res) {
    try {
        const { id } = req.params;
        const loan = await loanService.getLoanById(id);

        if (!loan) {
            return res.status(404).json({ error: "Loan not found" });
        }

        res.json({ success: true, loan });
    } catch (err) {
        console.error("Get Loan Error:", err);
        res.status(500).json({ error: "Failed to fetch loan" });
    }
}

// Get loans for foreclosure (end date <= today)
export async function getLoansForForeclosure(req, res) {
    try {
        const loans = await loanService.getLoansForForeclosure();
        res.json({ success: true, loans });
    } catch (err) {
        console.error("Get Foreclosure Loans Error:", err);
        res.status(500).json({ error: "Failed to fetch foreclosure loans" });
    }
}

// Update loan
export async function updateLoan(req, res) {
    try {
        const { id } = req.params;
        const loan = await loanService.updateLoan(id, req.body);

        if (!loan) {
            return res.status(404).json({ error: "Loan not found" });
        }

        res.json({ success: true, loan });
    } catch (err) {
        console.error("Update Loan Error:", err);
        res.status(500).json({ error: "Failed to update loan" });
    }
}

// Delete loan
export async function deleteLoan(req, res) {
    try {
        const { id } = req.params;
        const loan = await loanService.deleteLoan(id);

        if (!loan) {
            return res.status(404).json({ error: "Loan not found" });
        }

        res.json({ success: true, message: "Loan deleted successfully" });
    } catch (err) {
        console.error("Delete Loan Error:", err);
        res.status(500).json({ error: "Failed to delete loan" });
    }
}

// ==================== REQUEST FORECLOSURE ====================

// Create foreclosure request
export async function createForeclosureRequest(req, res) {
    try {
        const request = await loanService.createForeclosureRequest(req.body);
        res.status(201).json({ success: true, request });
    } catch (err) {
        console.error("Create Foreclosure Request Error:", err);
        res.status(500).json({ error: "Failed to create foreclosure request", details: err.message });
    }
}

// Get foreclosure history
export async function getForeclosureHistory(req, res) {
    try {
        const history = await loanService.getForeclosureHistory();
        res.json({ success: true, history });
    } catch (err) {
        console.error("Get Foreclosure History Error:", err);
        res.status(500).json({ error: "Failed to fetch foreclosure history" });
    }
}

// Get foreclosure requests pending NOC
export async function getForeclosuresPendingNOC(req, res) {
    try {
        const requests = await loanService.getForeclosuresPendingNOC();
        res.json({ success: true, requests });
    } catch (err) {
        console.error("Get Pending NOC Error:", err);
        res.status(500).json({ error: "Failed to fetch pending NOC requests" });
    }
}

// ==================== COLLECT NOC ====================

// Create or update NOC
export async function createOrUpdateNOC(req, res) {
    try {
        const noc = await loanService.createOrUpdateNOC(req.body);
        res.status(201).json({ success: true, noc });
    } catch (err) {
        console.error("Create/Update NOC Error:", err);
        res.status(500).json({ error: "Failed to process NOC", details: err.message });
    }
}

// Get pending NOC collections
export async function getPendingNOCCollections(req, res) {
    try {
        const pending = await loanService.getPendingNOCCollections();
        res.json({ success: true, pending });
    } catch (err) {
        console.error("Get Pending NOC Error:", err);
        res.status(500).json({ error: "Failed to fetch pending NOC collections" });
    }
}

// Get NOC history
export async function getNOCHistory(req, res) {
    try {
        const history = await loanService.getNOCHistory();
        res.json({ success: true, history });
    } catch (err) {
        console.error("Get NOC History Error:", err);
        res.status(500).json({ error: "Failed to fetch NOC history" });
    }
}

// Get all NOC records
export async function getAllNOCRecords(req, res) {
    try {
        const records = await loanService.getAllNOCRecords();
        res.json({ success: true, records });
    } catch (err) {
        console.error("Get All NOC Error:", err);
        res.status(500).json({ error: "Failed to fetch NOC records" });
    }
}
