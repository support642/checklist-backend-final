import express from "express";
import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";
import * as loanController from "../../controllers/doc-controller/loanController.js";

const router = express.Router();

// ==================== ALL LOANS ====================
// Create loan
router.post("/", authMiddleware, loanController.createLoan);

// Get all loans
router.get("/", authMiddleware, loanController.getAllLoans);

// Get loans for foreclosure (end date <= today)
router.get("/foreclosure-eligible", authMiddleware, loanController.getLoansForForeclosure);

// Get loan by ID
router.get("/:id", authMiddleware, loanController.getLoanById);

// Update loan
router.put("/:id", authMiddleware, loanController.updateLoan);

// Delete loan
router.delete("/:id", authMiddleware, loanController.deleteLoan);

// ==================== REQUEST FORECLOSURE ====================
// Create foreclosure request
router.post("/foreclosure/request", authMiddleware, loanController.createForeclosureRequest);

// Get foreclosure history
router.get("/foreclosure/history", authMiddleware, loanController.getForeclosureHistory);

// Get foreclosure requests pending NOC
router.get("/foreclosure/pending-noc", authMiddleware, loanController.getForeclosuresPendingNOC);

// ==================== COLLECT NOC ====================
// Create or update NOC
router.post("/noc", authMiddleware, loanController.createOrUpdateNOC);

// Get pending NOC collections
router.get("/noc/pending", authMiddleware, loanController.getPendingNOCCollections);

// Get NOC history
router.get("/noc/history", authMiddleware, loanController.getNOCHistory);

// Get all NOC records
router.get("/noc/all", authMiddleware, loanController.getAllNOCRecords);

export default router;
