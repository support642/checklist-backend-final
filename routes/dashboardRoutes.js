import express from "express";
import {
  getDashboardData,
  getTotalTask,
  getCompletedTask,
  getPendingTask,
  getOverdueTask,
  getUniqueDepartments,
  getStaffByDepartment,
  getChecklistByDateRange,
  getChecklistStatsByDate,
  getNotDoneTask,
  getDashboardDataCount,
  getChecklistDateRangeCount,
  getStaffTaskSummary,
  getDashboardSummaryCounts
} from "../controllers/dashboardController.js";

const router = express.Router();

// MAIN FETCH
router.get("/", getDashboardData);
router.get("/summary-counts", getDashboardSummaryCounts);

// COUNT APIs
router.get("/total", getTotalTask);
router.get("/completed", getCompletedTask);
router.get("/pending", getPendingTask);
router.get("/overdue", getOverdueTask);
router.get("/not-done", getNotDoneTask);

// FILTER LISTS
router.get("/departments", getUniqueDepartments);
router.get("/staff", getStaffByDepartment);
router.get("/staff-summary", getStaffTaskSummary);

// DATE RANGE
router.get("/checklist/date-range", getChecklistByDateRange);
router.get("/checklist/date-range/stats", getChecklistStatsByDate);
router.get("/checklist/date-range/count", getChecklistDateRangeCount);
router.get("/count", getDashboardDataCount);

export default router;
