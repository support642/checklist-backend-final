import express from "express";
import {
  getEquipmentMaster,
  createEquipmentMaster,
  updateEquipmentMaster,
  deleteEquipmentMaster,
  getEquipmentHistory
} from "../controllers/equipmentController.js";

const router = express.Router();

// Master Endpoints
router.get("/master", getEquipmentMaster);
router.post("/master", createEquipmentMaster);
router.put("/master/:id", updateEquipmentMaster);
router.delete("/master/:id", deleteEquipmentMaster);

// History Register Endpoint
router.get("/history", getEquipmentHistory);

export default router;
