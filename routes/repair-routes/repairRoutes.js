import express from "express";
import * as repairController from "../../controllers/repair-controller/repairController.js";
import { repairAuthMiddleware, checkRepairPermission } from "../../middleware/repair-middleware/repairAuth.js";

import { hasPermission } from "../../utils/permissionAdapter.js";

const router = express.Router();

/**
 * All Repair Module routes are protected by repairAuthMiddleware
 */
router.use(repairAuthMiddleware);

/**
 * @route   POST /api/repair
 * @desc    Create a new repair request
 * @access  Protected (repair_request_form modify access)
 */
router.post("/", 
  checkRepairPermission("repair_request_form", "modify"),
  repairController.createRepairRequest
);

/**
 * @route   GET /api/repair
 * @desc    Get all repair requests with filters
 * @access  Protected (repair_dashboard view access)
 */
router.get("/", 
  checkRepairPermission("repair_dashboard", "view"),
  repairController.getAllRepairRequests
);

/**
 * @route   GET /api/repair/:id
 * @desc    Get a specific repair request by ID
 * @access  Protected (repair_dashboard view access)
 */
router.get("/:id", 
  checkRepairPermission("repair_dashboard", "view"),
  repairController.getRepairRequestById
);

/**
 * @route   PUT /api/repair/:id
 * @desc    Update a repair request (e.g. status change, work details)
 * @access  Protected (Can be repair_pending_request or repair_request_approval modify)
 */
router.put("/:id", 
  (req, res, next) => {
    if (!req.permissions) {
      return res.status(403).json({ error: "No permissions loaded for user." });
    }
    
    const hasPendingMod = hasPermission(req.permissions, 'repair', "repair_pending_request", "modify");
    const hasApprovalMod = hasPermission(req.permissions, 'repair', "repair_request_approval", "modify");
    
    if (hasPendingMod || hasApprovalMod) {
      return next();
    }
    
    // If neither permission exists, reject
    res.status(403).json({ 
      error: `Insufficient permissions. Access to repair module update (pending/approval.modify) denied.` 
    });
  },
  repairController.updateRepairRequest
);

/**
 * @route   DELETE /api/repair/:id
 * @desc    Delete a repair request
 * @access  Protected (repair_setting modify access)
 */
router.delete("/:id", 
  checkRepairPermission("repair_setting", "modify"),
  repairController.deleteRepairRequest
);

export default router;
