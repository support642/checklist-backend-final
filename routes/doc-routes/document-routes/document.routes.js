import express from "express";
import { authMiddleware } from "../../../middleware/doc-middleware/authMiddleware.js";
import * as documentController from "../../../controllers/doc-controller/document-controller/documentController.js";

const router = express.Router();

// Create document
router.post("/create", authMiddleware, documentController.createDocument);

// Create multiple documents
router.post("/create-multiple", authMiddleware, documentController.createMultipleDocuments);

// Get all documents
router.get("/", authMiddleware, documentController.getAllDocuments);

// Get document stats
router.get("/stats", authMiddleware, documentController.getDocumentStats);

// Get documents needing renewal
router.get("/renewal", authMiddleware, documentController.getDocumentsNeedingRenewal);

// Get documents by category
router.get("/category/:category", authMiddleware, documentController.getDocumentsByCategory);

// Get document by ID
router.get("/:id", authMiddleware, documentController.getDocumentById);

// Update document
router.put("/:id", authMiddleware, documentController.updateDocument);

// Delete document (soft delete)-- "OBSOLETE"
// router.delete("/:id", authMiddleware, documentController.deleteDocument);

export default router;

