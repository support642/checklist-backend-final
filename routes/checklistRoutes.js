import express from "express";
import {
  getPendingChecklist,
  getChecklistHistory,
  updateChecklist,
  adminDoneChecklist,
  deleteChecklistInRange,
  sendEmailNotification,
  getChecklistMetadata
} from "../controllers/checklistController.js";

const router = express.Router();

router.get("/pending", getPendingChecklist);
router.get("/history", getChecklistHistory);
router.get("/metadata", getChecklistMetadata);
router.post("/update", updateChecklist);
router.post("/delete-range", deleteChecklistInRange);
router.post("/admin-done", adminDoneChecklist);
router.post("/send-email", sendEmailNotification);

export default router;
