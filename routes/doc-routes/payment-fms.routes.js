import express from "express";
import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";
import {
    create,
    getAll,
    getById,
    update,
    remove,
    generateUniqueNo,
    // Stage 1: Approval
    approvalPending,
    approvalHistory,
    approvalProcess,
    // Stage 2: Make Payment
    makePaymentPending,
    makePaymentHistory,
    makePaymentProcess,
    // Stage 3: Tally Entry
    tallyEntryPending,
    tallyEntryHistory,
    tallyEntryProcess
} from "../../controllers/doc-controller/payment-fms-controller.js";

const router = express.Router();

// General routes
router.post("/create", authMiddleware, create);
router.get("/all", authMiddleware, getAll);
router.get("/generate-unique-no", authMiddleware, generateUniqueNo);

// Stage 1: Approval routes
router.get("/approval/pending", authMiddleware, approvalPending);
router.get("/approval/history", authMiddleware, approvalHistory);
router.patch("/approval/:id/process", authMiddleware, approvalProcess);

// Stage 2: Make Payment routes
router.get("/make-payment/pending", authMiddleware, makePaymentPending);
router.get("/make-payment/history", authMiddleware, makePaymentHistory);
router.patch("/make-payment/:id/process", authMiddleware, makePaymentProcess);

// Stage 3: Tally Entry routes
router.get("/tally-entry/pending", authMiddleware, tallyEntryPending);
router.get("/tally-entry/history", authMiddleware, tallyEntryHistory);
router.post("/tally-entry/process", authMiddleware, tallyEntryProcess); // POST for bulk IDs

// General routes (by ID)
router.get("/:id", authMiddleware, getById);
router.put("/:id", authMiddleware, update);
router.delete("/:id", authMiddleware, remove);

export default router;
