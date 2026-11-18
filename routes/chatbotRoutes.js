import express from "express";

import {
    handleChatMessage,
    confirmWorkReport,
    exportChatData
} from "../controllers/chatbotAIController.js";

import {
    getMyTasks,
    getMyWorkHistory,
    getAdminWorkReportsController,
    getAdminDashboardSummaryController,
    getDepartmentWiseAnalyticsController,
    getEmployeeWiseTaskAnalyticsController,
    getAdminTaskAnalyticsController,
    getAdminWorkReportsByDateRangeController
} from "../controllers/chatbotController.js";

import chatbotAdminMiddleware from "../middleware/chatbotAdminMiddleware.js";

const router = express.Router();

// The AI chatbot is only for administrators (super_admin, div_admin, admin).
// Role is read from the database, so normal users are blocked on EVERY route.
router.use(chatbotAdminMiddleware);


// ==========================================
// Employee APIs
// ==========================================

router.get("/my-tasks", getMyTasks);

router.get("/my-work-history", getMyWorkHistory);


// ==========================================
// AI Chat APIs
// ==========================================

router.post("/chat", handleChatMessage);

router.post("/confirm-work-report", confirmWorkReport);

// Full data behind a chat answer, for PDF / Excel download (admin, read-only)
router.post("/admin/export", chatbotAdminMiddleware, exportChatData);


// ==========================================
// Administrator APIs
// ==========================================

// Retrieve employee work reports
router.get(
    "/admin/work-reports",
    chatbotAdminMiddleware,
    getAdminWorkReportsController
);

// Dashboard summary
router.get(
    "/admin/dashboard-summary",
    chatbotAdminMiddleware,
    getAdminDashboardSummaryController
);

// Department-wise analytics
router.get(
    "/admin/department-analytics",
    chatbotAdminMiddleware,
    getDepartmentWiseAnalyticsController
);

// Employee-wise task analytics
router.get(
    "/admin/employee-analytics",
    chatbotAdminMiddleware,
    getEmployeeWiseTaskAnalyticsController
);

// Consolidated task analytics
router.get(
    "/admin/task-analytics",
    chatbotAdminMiddleware,
    getAdminTaskAnalyticsController
);

// Date-range work reports with pagination
router.get(
    "/admin/work-reports/date-range",
    chatbotAdminMiddleware,
    getAdminWorkReportsByDateRangeController
);


export default router;