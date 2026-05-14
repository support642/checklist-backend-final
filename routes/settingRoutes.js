// routes/settingRoutes.js
import express from "express";
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getDepartments,
  getDepartmentsOnly,
  getGivenByData,
  createDepartment,
  updateDepartment,
  getMachines,
  createMachine,
  updateMachine,
  deleteMachine,
  uploadPartImage,
  getSystemSettings,
  updateSystemSetting,
  triggerOverdueReminders
} from "../controllers/settingController.js";
import upload from "../middleware/s3Upload.js";

const router = express.Router();

// USERS
router.get("/users", getUsers);
router.post("/users", createUser);
router.put("/users/:id", updateUser);
router.delete("/users/:id", deleteUser);

// DEPARTMENTS
router.get("/departments", getDepartments); // Gets all departments with given_by
router.get("/departments-only", getDepartmentsOnly); // Gets only unique department names
router.get("/given-by", getGivenByData); // Gets only unique given_by values
router.post("/departments", createDepartment);
router.put("/departments/:id", updateDepartment);

// MACHINES
router.get("/machines", getMachines);
router.post("/machines", createMachine);
router.put("/machines/:id", updateMachine);
router.delete("/machines/:id", deleteMachine);
router.post("/upload-part-image", upload.single("image"), uploadPartImage);

// SYSTEM SETTINGS & WHATSAPP
router.get("/system", getSystemSettings);
router.post("/system", updateSystemSetting);
router.post("/whatsapp/trigger-overdue", triggerOverdueReminders);

export default router;