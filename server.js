import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import assignTaskRoutes from "./routes/assignTaskRoutes.js";
import checklistRoutes from "./routes/checklistRoutes.js";
import delegationRoutes from "./routes/delegationRoutes.js";
import settingRoutes from "./routes/settingRoutes.js";
import staffTasksRoutes from "./routes/staffTasksRoutes.js";
import quickTaskRoutes from "./routes/quickTaskRoutes.js";
import loginRoutes from "./routes/loginRoutes.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import calendarRoutes from "./routes/calendarRoutes.js";
import holidayRoutes from "./routes/holidayRoutes.js";
import workingDayRoutes from "./routes/workingDayRoutes.js";
import importRoutes from "./routes/importRoutes.js";
import leaveRoutes from "./routes/leaveRoutes.js";
import maintenanceRoutes from "./routes/maintenanceRoutes.js";
// Documentation Module Routes
import docDashboardRoutes from "./routes/doc-routes/docDashboardRoutes.js";
import loanRoutes from "./routes/doc-routes/loan.routes.js";
import masterRoutes from "./routes/doc-routes/master.js";
import mySubscriptionRoutes from "./routes/doc-routes/mySubscription.routes.js";
import paymentFmsRoutes from "./routes/doc-routes/payment-fms.routes.js";
import renewalRoutes from "./routes/doc-routes/renewal.routes.js";
import docSettingsRoutes from "./routes/doc-routes/settings.routes.js";
import subscriptionPaymentRoutes from "./routes/doc-routes/subscription-pyament.routes.js";
import subscriptionRoutes from "./routes/doc-routes/subscriptionRoutes.js";
import subscriptionApprovalRoutes from "./routes/doc-routes/susbcriptionApprovalRoutes.js";
import documentRoutes from "./routes/doc-routes/document-routes/document.routes.js";
import userRoutes from "./routes/doc-routes/userRoutes.js";


// Asset Module Routes
import assetProductRoutes from "./routes/asset-routes/productRoutes.js";
import assetRepairRoutes from "./routes/asset-routes/repairRoutes.js";
import assetSpecRoutes from "./routes/asset-routes/specRoutes.js";
import assetUploadRoutes from "./routes/asset-routes/uploadRoutes.js";
import assetUserRoutes from "./routes/asset-routes/userRoutes.js";

// Repair Module Routes
import repairRoutes from "./routes/repair-routes/repairRoutes.js";
import workingDateHistoryRoutes from "./routes/workingDateHistoryRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";

import pool from "./config/db.js";
import { sessionMiddleware } from "./middleware/sessionMiddleware.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Global Session Middleware
app.use(sessionMiddleware);

// ROUTES
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/assign-task", assignTaskRoutes);
app.use("/api/checklist", checklistRoutes);
app.use("/api", delegationRoutes);
app.use("/api/settings", settingRoutes);
app.use("/api/staff-tasks", staffTasksRoutes);
app.use("/api/tasks", quickTaskRoutes);
app.use("/api/login", loginRoutes);
app.use("/api/logs", deviceRoutes);
app.use("/api/calendar", calendarRoutes);
app.use("/api/holidays", holidayRoutes);
app.use("/api/working-days", workingDayRoutes);
app.use("/api/import", importRoutes);
app.use("/api/leave", leaveRoutes);
app.use("/api/maintenance", maintenanceRoutes);

// DOCUMENTATION MODULE ROUTES
app.use("/api/doc-dashboard", docDashboardRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/master", masterRoutes);
app.use("/api/my-subscriptions", mySubscriptionRoutes);
app.use("/api/payment-fms", paymentFmsRoutes);
app.use("/api/subscription-renewal", renewalRoutes);
app.use("/api/settings/doc", docSettingsRoutes);
app.use("/api/subscription-payment", subscriptionPaymentRoutes);
app.use("/api/subscription", subscriptionRoutes);
app.use("/api/subscription-approval", subscriptionApprovalRoutes);
app.use("/api/documents", documentRoutes);

app.use("/api/users", userRoutes);

// ASSET MODULE ROUTES
app.use("/api/asset/products", assetProductRoutes);
app.use("/api/asset/repairs", assetRepairRoutes);
app.use("/api/asset/specs", assetSpecRoutes);
app.use("/api/asset/upload", assetUploadRoutes);
app.use("/api/asset/users", assetUserRoutes);

// REPAIR MODULE ROUTES
app.use("/api/repair", repairRoutes);

// WORKING DATE HISTORY ROUTES
app.use("/api/working-date-history", workingDateHistoryRoutes);

// WHATSAPP WEBHOOK ROUTES
app.use("/api/v1/whatsapp", whatsappRoutes);


// SERVER RUN
const PORT = process.env.PORT || 5050;

process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('🔥 UNHANDLED REJECTION at:', promise, 'reason:', reason);
  process.exit(1);
});

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  try {
    // Invalidate all sessions on startup (Redeploy Logout)
    await pool.query("UPDATE sessions SET is_active = false");
    console.log("✅ All previous sessions invalidated on startup.");
  } catch (err) {
    console.error("❌ Error invalidating sessions on startup:", err);
  }
});
