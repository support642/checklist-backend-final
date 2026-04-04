import express from "express";
import {
  fetchDelegationDataSortByDate,
  fetchDelegation_DoneDataSortByDate,
  insertDelegationDoneAndUpdate,
  adminDoneDelegation,
  updateAdminRemarks,
  updateUserRemarks,
  revertDelegationTask,
  sendDelegationEmailNotification
} from "../controllers/delegationController.js";

const router = express.Router();

router.get("/delegation", fetchDelegationDataSortByDate);
router.get("/delegation-done", fetchDelegation_DoneDataSortByDate);
router.post("/delegation/submit", insertDelegationDoneAndUpdate);
router.post("/delegation/admin-done", adminDoneDelegation);
router.patch("/delegation/:task_id/admin-remarks", updateAdminRemarks);
router.patch("/delegation/:task_id/user-remarks", updateUserRemarks);
router.post("/delegation/revert", revertDelegationTask);
router.post("/delegation/send-email", sendDelegationEmailNotification);

export default router;
