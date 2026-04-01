import express from "express";
import {
  getAllSubscriptions,
  getMySubscriptions,
  getDashboardStats
} from "../../controllers/doc-controller/dashboardController.js";
import { authMiddleware, checkPermission } from "../../middleware/doc-middleware/authMiddleware.js";

const router = express.Router();

// ADMIN
router.get("/all", authMiddleware, checkPermission('documentation', 'Dashboard', 'modify'), getAllSubscriptions);

// USER + ADMIN
router.get("/mine", authMiddleware, getMySubscriptions);

// DASHBOARD DATA
router.get("/dashboard", authMiddleware, checkPermission('documentation', 'Dashboard', 'view'), getDashboardStats);

router.get("/dashboards", getDashboardStats);
router.get("/dashboard-all", getAllSubscriptions);

export default router;
