import express from "express";
import {
    getPendingMaintenanceTasks,
    getMaintenanceHistory,
    updateMaintenanceTasks,
    adminDoneMaintenance,
    getMaintenanceDropdownOptions,
    getUniqueMaintenanceTasks,
    updateUniqueMaintenanceTask,
    deleteUniqueMaintenanceTasks,
    getMaintenanceUniqueCount,
    sendMaintenanceNotification
} from "../controllers/maintenanceController.js";
const router = express.Router();

// GET all pending maintenance tasks
router.get("/", getPendingMaintenanceTasks);

// GET historical maintenance tasks
router.get("/history", getMaintenanceHistory);

// PUT/POST update maintenance tasks (user submission)
router.post("/update", updateMaintenanceTasks);

// PUT/POST admin approval for maintenance tasks
router.post("/admin-done", adminDoneMaintenance);

// GET distinct dropdown options for machine_name, part_name, part_area
router.get("/dropdown-options", getMaintenanceDropdownOptions);

// POST unique maintenance tasks (QuickTask View)
router.post("/unique", getUniqueMaintenanceTasks);

// POST update unique maintenance tasks (QuickTask View)
router.post("/update-unique", updateUniqueMaintenanceTask);

// POST delete unique maintenance tasks (QuickTask View)
router.post("/delete-unique", deleteUniqueMaintenanceTasks);

// POST get unique maintenance task count
router.post("/unique-count", getMaintenanceUniqueCount);

// POST send maintenance notification
router.post("/send-notification", sendMaintenanceNotification);

export default router;
