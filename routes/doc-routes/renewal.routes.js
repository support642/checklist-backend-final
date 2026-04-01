import { Router } from "express";
import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";
import {
    getPendingRenewals,
    getRenewalHistory,
    submitRenewal
} from "../../controllers/doc-controller/renewalController.js";

const router = Router();

/* RENEWAL */
router.get("/pending", authMiddleware, getPendingRenewals);
router.get("/history", authMiddleware, getRenewalHistory);
router.post("/submit", authMiddleware, submitRenewal);

export default router;
