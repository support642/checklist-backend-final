import express from "express";
import {
  fetchPendingApprovals,
  fetchApprovalHistory,
  submitApproval
} from "../../controllers/doc-controller/subscriptionApprovalController.js";

const router = express.Router();

router.get("/pending", fetchPendingApprovals);
router.get("/history", fetchApprovalHistory);
router.post("/submit", submitApproval);

export default router;
