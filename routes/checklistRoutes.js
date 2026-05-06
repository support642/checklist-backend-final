import express from "express";
import {
  getPendingChecklist,
  getChecklistHistory,
  updateChecklist,
  adminDoneChecklist,
  deleteChecklistInRange,
  sendEmailNotification,
  getChecklistMetadata,
  bulkDeleteChecklist,
  bulkLeaveChecklist,
  approveActivationChecklist
} from "../controllers/checklistController.js";

const router = express.Router();

router.get("/pending", getPendingChecklist);
router.get("/history", getChecklistHistory);
router.get("/metadata", getChecklistMetadata);
router.post("/update", updateChecklist);
router.post("/delete-range", deleteChecklistInRange);
router.post("/admin-done", adminDoneChecklist);
router.post("/send-email", sendEmailNotification);
router.post("/bulk-delete", bulkDeleteChecklist);
router.post("/bulk-leave", bulkLeaveChecklist);
router.post("/approve-activation", approveActivationChecklist);

export default router;
