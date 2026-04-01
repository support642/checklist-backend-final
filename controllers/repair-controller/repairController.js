import * as repairService from "../../services/repair-services/repairService.js";
import { uploadDocumentImage } from "../../middleware/s3Upload.js";

/**
 * Handle new repair request creation
 */
export async function createRepairRequest(req, res) {
  try {
    const isBatch = Array.isArray(req.body);
    const repairItems = isBatch ? req.body : [req.body];
    const results = [];

    for (const item of repairItems) {
      const repairData = { ...item };

      // Set default filled_by to the current user if not provided
      if (!repairData.filled_by && req.user) {
        repairData.filled_by = req.user.username;
      }

      // Handle Image Upload (work_photo_url)
      if (repairData.work_photo_url && repairData.work_photo_url.startsWith('data:')) {
        try {
          const s3Url = await uploadDocumentImage(repairData.work_photo_url, `repair_photo_${Date.now()}`);
          repairData.work_photo_url = s3Url;
        } catch (uploadErr) {
          console.error("Repair Photo S3 Upload Error:", uploadErr);
          repairData.work_photo_url = null;
        }
      }

      // Handle Bill Upload (bill_copy_url)
      if (repairData.bill_copy_url && repairData.bill_copy_url.startsWith('data:')) {
        try {
          const s3Url = await uploadDocumentImage(repairData.bill_copy_url, `repair_bill_${Date.now()}`);
          repairData.bill_copy_url = s3Url;
        } catch (uploadErr) {
          console.error("Repair Bill S3 Upload Error:", uploadErr);
          repairData.bill_copy_url = null;
        }
      }

      const repair = await repairService.createRepairRequest(repairData);
      results.push(repair);
    }

    res.status(201).json({ 
      success: true, 
      repair: isBatch ? results : results[0],
      count: results.length 
    });
  } catch (err) {
    console.error("Create Repair Request Error:", err);
    res.status(500).json({ error: "Failed to create repair request", details: err.message });
  }
}

/**
 * Get all repair requests with filtering support
 */
export async function getAllRepairRequests(req, res) {
  try {
    const filters = {
      status: req.query.status,
      status_exclude: req.query.status_exclude, // Handle status exclusion for Pending views
      assigned_person: req.query.assigned_person,
      machine_name: req.query.machine_name,
      filled_by: req.query.filled_by,
      machine_department: req.query.machine_department,
      machine_division: req.query.machine_division,
      currentUser: req.user // { username, role }
    };

    const repairs = await repairService.getAllRepairRequests(filters);
    res.json({ success: true, repairs });
  } catch (err) {
    console.error("Get All Repairs Error:", err);
    res.status(500).json({ error: "Failed to fetch repair requests" });
  }
}

/**
 * Get a single repair request by ID
 */
export async function getRepairRequestById(req, res) {
  try {
    const { id } = req.params;
    const repair = await repairService.getRepairRequestById(id, req.user);

    if (!repair) {
      return res.status(404).json({ error: "Repair request not found" });
    }

    res.json({ success: true, repair });
  } catch (err) {
    console.error("Get Repair Error:", err);
    res.status(500).json({ error: "Failed to fetch repair request" });
  }
}

/**
 * Update an existing repair request
 */
export async function updateRepairRequest(req, res) {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Again, handle potential base64 images if they're being updated
    if (updateData.work_photo_url && updateData.work_photo_url.startsWith('data:')) {
      updateData.work_photo_url = await uploadDocumentImage(updateData.work_photo_url, `repair_photo_update_${Date.now()}`);
    }
    if (updateData.bill_copy_url && updateData.bill_copy_url.startsWith('data:')) {
      updateData.bill_copy_url = await uploadDocumentImage(updateData.bill_copy_url, `repair_bill_update_${Date.now()}`);
    }

    const repair = await repairService.updateRepairRequest(id, updateData);

    if (!repair) {
      return res.status(404).json({ error: "Repair request not found" });
    }

    res.json({ success: true, repair });
  } catch (err) {
    console.error("Update Repair Error:", err);
    res.status(500).json({ error: "Failed to update repair request" });
  }
}

/**
 * Delete a repair request
 */
export async function deleteRepairRequest(req, res) {
  try {
    const { id } = req.params;
    const repair = await repairService.deleteRepairRequest(id);

    if (!repair) {
      return res.status(404).json({ error: "Repair request not found" });
    }

    res.json({ success: true, message: "Repair request deleted successfully" });
  } catch (err) {
    console.error("Delete Repair Error:", err);
    res.status(500).json({ error: "Failed to delete repair request" });
  }
}
