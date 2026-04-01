import pool from "../config/db.js";
import { uploadToS3 } from "../middleware/s3Upload.js";
import { sendWhatsAppMessage, sendDelegationStatusUpdateNotification } from "../services/whatsappService.js";


/* ------------------------------------------------------
   FETCH PENDING + EXTEND TASKS (delegation)
------------------------------------------------------ */
export const fetchDelegationDataSortByDate = async (req, res) => {
  const role = req.query.role;
  const username = req.query.username;

  try {
    let query = "";

    console.log("PARAMS →", req.query);

    // Normalize role comparison
    const upRole = (role || "").toUpperCase();
    const requesterUnit = req.query.unit || "";
    const requesterDivision = req.query.division || "";
    const requesterDepartment = req.query.department || "";
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    let dateFilter = "";
    if (startDate && endDate) {
      dateFilter = ` AND task_start_date >= '${startDate}' AND task_start_date <= '${endDate} 23:59:59' `;
    }

    if (upRole === "SUPER_ADMIN") {
      query = `SELECT * FROM delegation WHERE ((status IS NULL OR status = '' OR status = 'extend' OR status = 'pending') OR (planned_date IS NOT NULL AND submission_date IS NULL))${dateFilter} ORDER BY task_start_date ASC;`;
    } else if (upRole === "DIV_ADMIN") {
      query = `SELECT * FROM delegation WHERE LOWER(unit)=LOWER($1) AND LOWER(division)=LOWER($2) AND ((status IS NULL OR status = '' OR status = 'extend' OR status = 'pending') OR (planned_date IS NOT NULL AND submission_date IS NULL))${dateFilter} ORDER BY task_start_date ASC;`;
    } else if (upRole === "ADMIN") {
      query = `SELECT * FROM delegation WHERE LOWER(unit)=LOWER($1) AND LOWER(division)=LOWER($2) AND LOWER(department)=LOWER($3) AND ((status IS NULL OR status = '' OR status = 'extend' OR status = 'pending') OR (planned_date IS NOT NULL AND submission_date IS NULL))${dateFilter} ORDER BY task_start_date ASC;`;
    } else {
      query = `SELECT * FROM delegation WHERE name = $1 AND ((status IS NULL OR status = '' OR status = 'extend' OR status = 'pending') OR (planned_date IS NOT NULL AND submission_date IS NULL))${dateFilter} ORDER BY task_start_date ASC;`;
    }

    let params_val = [];
    if (upRole === "DIV_ADMIN") params_val = [requesterUnit, requesterDivision];
    else if (upRole === "ADMIN") params_val = [requesterUnit, requesterDivision, requesterDepartment];
    else if (upRole === "SUPER_ADMIN") params_val = [];
    else params_val = [username || ""];

    const { rows } = await pool.query(query, params_val);
    return res.json(rows);


  } catch (err) {
    console.log("Pending fetch error:", err);
    return res.status(400).json({ error: err.message });
  }
};


/* ------------------------------------------------------
   FETCH DONE TASKS (delegation_done)
------------------------------------------------------ */
export const fetchDelegation_DoneDataSortByDate = async (req, res) => {
  const role = req.query.role;
  const username = req.query.username;
  const userAccess = req.query.user_access;
  const search = req.query.search;

  try {
    let baseQuery = `
      SELECT 
        dd.id,
        dd.task_id,
        dd.status,
        to_char(dd.next_extend_date, 'YYYY-MM-DD HH24:MI:SS') as next_extend_date,
        dd.reason,
        dd.image_url,
        dd.name,
        dd.task_description,
        dd.given_by,
        to_char(dd.created_at, 'YYYY-MM-DD HH24:MI:SS') as created_at,
        dd.admin_done,
        dd.admin_done_remarks,
        to_char(d.planned_date, 'YYYY-MM-DD HH24:MI:SS') as planned_date,
        to_char(d.submission_date, 'YYYY-MM-DD HH24:MI:SS') as submission_date,
        d.adminremarks,
        d.department,
        d.unit,
        d.division,
        COUNT(*) OVER() AS total_count,
        SUM(CASE WHEN dd.admin_done = 'Done' THEN 1 ELSE 0 END) OVER() AS approved_count
      FROM delegation_done dd
      LEFT JOIN delegation d ON dd.task_id::BIGINT = d.task_id
    `;

    let whereConditions = [];
    const params = [];
    let paramIndex = 1;

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    const divisionFilter = req.query.divisionFilter;
    const departmentFilter = req.query.departmentFilter;
    const nameFilter = req.query.nameFilter;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      // No filter
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      whereConditions.push(`LOWER(d.unit) = LOWER($${paramIndex++})`);
      params.push(requesterUnit);
      whereConditions.push(`LOWER(d.division) = LOWER($${paramIndex++})`);
      params.push(requesterDivision);
    } else if (upRole === "ADMIN" || upRole === "admin") {
      whereConditions.push(`LOWER(d.unit) = LOWER($${paramIndex++})`);
      params.push(requesterUnit);
      whereConditions.push(`LOWER(d.division) = LOWER($${paramIndex++})`);
      params.push(requesterDivision);
      whereConditions.push(`LOWER(d.department) = LOWER($${paramIndex++})`);
      params.push(requesterDepartment || userAccess);
    } else {
      whereConditions.push(`dd.name = $${paramIndex++}`);
      params.push(username);
    }

    // Explicit UI Filters
    if (divisionFilter && divisionFilter !== 'all') {
      whereConditions.push(`LOWER(d.division) = LOWER($${paramIndex++})`);
      params.push(divisionFilter);
    }
    if (departmentFilter && departmentFilter !== 'all') {
      whereConditions.push(`LOWER(d.department) = LOWER($${paramIndex++})`);
      params.push(departmentFilter);
    }
    if (nameFilter && nameFilter !== 'all') {
      whereConditions.push(`LOWER(dd.name) = LOWER($${paramIndex++})`);
      params.push(nameFilter);
    }

    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    if (startDate && endDate) {
      whereConditions.push(`dd.created_at >= $${paramIndex++} AND dd.created_at <= $${paramIndex++}`);
      params.push(startDate, `${endDate} 23:59:59`);
    }

    if (search) {
      whereConditions.push(`(
        LOWER(dd.name) LIKE $${paramIndex} OR 
        LOWER(dd.task_description) LIKE $${paramIndex} OR 
        LOWER(d.department) LIKE $${paramIndex} OR 
        LOWER(dd.given_by) LIKE $${paramIndex} OR
        CAST(dd.task_id AS TEXT) LIKE $${paramIndex} OR
        LOWER(d.unit) LIKE $${paramIndex} OR
        LOWER(d.division) LIKE $${paramIndex}
      )`);
      params.push(`%${search.toLowerCase()}%`);
      paramIndex++;
    }

    let query = baseQuery;
    if (whereConditions.length > 0) {
      query += ` WHERE ` + whereConditions.join(" AND ");
    }
    query += ` ORDER BY dd.created_at DESC;`;

    const { rows } = await pool.query(query, params);
    
    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count) : 0;
    const approvedCount = rows.length > 0 ? parseInt(rows[0].approved_count) : 0;

    return res.json({
      data: rows,
      totalCount,
      approvedCount
    });
  } catch (err) {
    console.log("Done fetch error:", err);
    return res.status(400).json({ error: err.message });
  }
};

/* ------------------------------------------------------
  INSERT INTO delegation_done AND UPDATE delegation
------------------------------------------------------ */
// export const insertDelegationDoneAndUpdate = async (req, res) => {
//   try {
//     console.log("REQ BODY 👉", req.body);

//     const selectedDataArray = req.body.selectedData;

//     if (!selectedDataArray || !Array.isArray(selectedDataArray)) {
//       return res.status(400).json({ error: "selectedData missing or invalid" });
//     }

//     const client = await pool.connect();
//     const results = [];

//     for (const task of selectedDataArray) {

//       const statusForDone =
//         task.status === "done"
//           ? "completed"
//           : task.status === "extend"
//           ? "extend"
//           : "in_progress";

//       const statusForDelegation =
//         task.status === "done"
//           ? "done"
//           : task.status === "extend"
//           ? "extend"
//           : null;

//       /* INSERT INTO delegation_done WITHOUT department */
//       const insertQuery = `
//         INSERT INTO delegation_done
//         (task_id, status, next_extend_date, reason, image_url, name, task_description, given_by)
//         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
//         RETURNING *;
//       `;

//       const insertValues = [
//         task.task_id,
//         statusForDone,
//         task.next_extend_date || null,
//         task.reason || "",
//         task.image_url || null,
//         task.name,
//         task.task_description,
//         task.given_by
//       ];

//       const inserted = await client.query(insertQuery, insertValues);

//       /* UPDATE delegation */
//       const updateQuery = `
//         UPDATE delegation
//         SET status = $1,
//             submission_date = NOW(),
//             updated_at = NOW(),
//             remarks = $2,
//             planned_date = $3
//         WHERE task_id = $4
//         RETURNING *;
//       `;

//       const updateValues = [
//         statusForDelegation,
//         task.reason || "",
//         task.next_extend_date || task.planned_date,
//         task.task_id
//       ];

//       const updated = await client.query(updateQuery, updateValues);

//       results.push({
//         done: inserted.rows[0],
//         updated: updated.rows[0]
//       });
//     }

//     return res.json(results);

//   } catch (err) {
//     console.error("Insert error:", err);
//     return res.status(500).json({ error: err.message });
//   }
// };


export const insertDelegationDoneAndUpdate = async (req, res) => {
  const client = await pool.connect();

  try {
    console.log("🔄 Incoming Delegation Submit Body:");
    console.log(JSON.stringify(req.body, null, 2));

    const selectedDataArray = req.body.selectedData;

    if (!selectedDataArray || !Array.isArray(selectedDataArray)) {
      return res.status(400).json({ error: "selectedData missing or invalid" });
    }

    await client.query("BEGIN");
    const results = [];

    for (const task of selectedDataArray) {
      console.log("\n==============================================");
      console.log(`🔍 Processing Task ID: ${task.task_id}`);

      /* -----------------------------------------
         1️⃣ Decide Final Status for Tables
      ------------------------------------------ */
      const statusForDone =
        task.status === "done"
          ? "completed"
          : task.status === "partial_done"
            ? "completed"
            : task.status === "extend"
              ? "extend"
              : "in_progress";

      const statusForDelegation =
        task.status === "done"
          ? "done"
          : task.status === "partial_done"
            ? "partial_done"
            : task.status === "extend"
              ? "extend"
              : null;

      /* -----------------------------------------
         2️⃣ Handle Image Uploads
      ------------------------------------------ */

      let finalImageUrl = null;

      if (task.image_base64 && typeof task.image_base64 === "string") {
        try {
          // CASE 1: NEW UPLOAD (BASE64)
          if (task.image_base64.startsWith("data:image")) {
            console.log("📸 Base64 image detected → Uploading to S3...");

            const base64Data = task.image_base64.split(";base64,").pop();
            const buffer = Buffer.from(base64Data, "base64");

            const fakeFile = {
              originalname: `delegation_${task.task_id}_${Date.now()}.jpg`,
              buffer,
              mimetype: "image/jpeg",
            };

            finalImageUrl = await uploadToS3(fakeFile);
            console.log("✅ Uploaded to S3:", finalImageUrl);
          }

          // CASE 2: ALREADY S3 URL
          else if (task.image_base64.startsWith("http")) {
            console.log("ℹ Existing S3 image detected → Keeping original URL");
            finalImageUrl = task.image_base64;
          }

          // CASE 3: Invalid image string
          else {
            console.log("⚠ Invalid image string → Skipping image");
            finalImageUrl = null;
          }

        } catch (imageError) {
          console.error("❌ Image processing error:", imageError);
          finalImageUrl = null; // continue without breaking
        }

      } else {
        console.log("❌ No image_base64 sent");
      }

      console.log(`📝 Final Image URL: ${finalImageUrl}`);


      /* -----------------------------------------
         3️⃣ INSERT into delegation_done
      ------------------------------------------ */

      const insertQuery = `
        INSERT INTO delegation_done
        (task_id, status, next_extend_date, reason, image_url, name, task_description, given_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *;
      `;

      const insertValues = [
        task.task_id,
        statusForDone,
        task.next_extend_date || null,
        task.reason || "",
        finalImageUrl,
        task.name,
        task.task_description,
        task.given_by
      ];

      console.log("💾 INSERT delegation_done:", insertValues);

      const inserted = await client.query(insertQuery, insertValues);


      /* -----------------------------------------
         4️⃣ UPDATE delegation (main table)
      ------------------------------------------ */

      const updateQuery = `
        UPDATE delegation
        SET status = $1,
            submission_date = date_trunc('second', NOW() AT TIME ZONE 'Asia/Kolkata'),
            updated_at = NOW() AT TIME ZONE 'Asia/Kolkata',
            remarks = $2,
            planned_date = $3,
            image = $4
        WHERE task_id = $5
        RETURNING *;
      `;

      const updateValues = [
        statusForDelegation,
        task.reason || "",
        task.next_extend_date || task.planned_date,
        finalImageUrl,
        task.task_id
      ];

      console.log("💾 UPDATE delegation:", updateValues);

      const updated = await client.query(updateQuery, updateValues);

      results.push({
        saved_to_done_table: inserted.rows[0],
        updated_in_main_table: updated.rows[0],
      });

      // 📲 WhatsApp Notification for Admin (9637655555) for Done, Partial Done, and Extend
      const lowerStatus = (task.status || "").toString().toLowerCase().trim();
      console.log(`🔍 Checking notification for Task ID ${task.task_id}: Detected status "${lowerStatus}"`);

      if (lowerStatus === "done" || lowerStatus === "partial_done" || lowerStatus === "extend") {
        try {
          console.log(`📲 Sending WhatsApp status notification (${lowerStatus}) to Admin for Task ID: ${task.task_id}`);
          await sendDelegationStatusUpdateNotification(task, lowerStatus);
        } catch (notifErr) {
          console.error("❌ Notification error:", notifErr);
          // Don't fail the whole transaction if notification fails
        }
      } else {
        console.log(`ℹ️ No notification triggered for status: "${lowerStatus}"`);
      }
    }

    /* -----------------------------------------
       5️⃣ COMMIT TRANSACTION
    ------------------------------------------ */
    await client.query("COMMIT");
    console.log("✅ ALL TASKS SAVED SUCCESSFULLY");

    return res.json({ success: true, results });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Transaction Failed:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};


/* ------------------------------------------------------
   ADMIN DONE - Mark delegation as admin approved
------------------------------------------------------ */
export const adminDoneDelegation = async (req, res) => {
  const client = await pool.connect();
  try {
    const items = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ error: "No items provided" });

    await client.query("BEGIN");

    const sql = `
      UPDATE delegation_done
      SET admin_done = 'Done',
          admin_done_remarks = $2
      WHERE id = $1
    `;

    for (const item of items) {
      // item must have id, optional remarks
      await client.query(sql, [item.id, item.remarks || null]);
    }

    await client.query("COMMIT");

    res.json({ message: "Delegation admin approval updated successfully" });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ adminDoneDelegation Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};


/* ------------------------------------------------------
   SEND WHATSAPP NOTIFICATION FOR DELEGATION (Admin)
------------------------------------------------------ */
export const sendDelegationWhatsAppNotification = async (req, res) => {
  try {
    const { items } = req.body; // Array of selected delegation items

    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    console.log(`📱 Processing ${items.length} delegation WhatsApp notifications...`);

    const results = [];

    for (const item of items) {
      const doerName = item.name;

      // Look up phone number from users table
      const userResult = await pool.query(
        'SELECT number FROM users WHERE user_name = $1',
        [doerName]
      );

      if (userResult.rows.length === 0 || !userResult.rows[0].number) {
        console.log(`⚠️ No phone number found for: ${doerName}`);
        results.push({
          name: doerName,
          success: false,
          error: 'Phone number not found'
        });
        continue;
      }

      const phoneNumber = userResult.rows[0].number;

      // Format date for message
      const formatDate = (dateStr) => {
        if (!dateStr) return 'N/A';
        try {
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) return dateStr;
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          const hours = String(date.getHours()).padStart(2, '0');
          const minutes = String(date.getMinutes()).padStart(2, '0');
          const seconds = String(date.getSeconds()).padStart(2, '0');
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        } catch (e) {
          return dateStr;
        }
      };

      // App link
      const appLink = 'https://checklist-frontend-eight.vercel.app';

      // Create urgent task alert message
      const message = `🚨 URGENT TASK ALERT 🚨

Name: ${doerName}
Task ID: ${item.task_id || 'N/A'}
Task: ${item.task_description || 'N/A'}
Planned Date: ${formatDate(item.planned_date || item.task_start_date)}
Given By: ${item.given_by || 'N/A'}

📌 Please take immediate action and update once completed.

🔗 *App Link:*
${appLink}`;

      // Send WhatsApp message
      const result = await sendWhatsAppMessage(phoneNumber, message);

      results.push({
        name: doerName,
        success: result.success,
        error: result.error || null
      });
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    res.json({
      message: `WhatsApp sent: ${successCount} success, ${failCount} failed`,
      results
    });

  } catch (err) {
    console.error("❌ sendDelegationWhatsAppNotification Error:", err);
    res.status(500).json({ error: err.message });
  }
};


/* ------------------------------------------------------
   UPDATE ADMIN REMARKS - For super admin to reply to tasks
------------------------------------------------------ */
export const updateAdminRemarks = async (req, res) => {
  try {
    const { task_id } = req.params;
    const { adminremarks } = req.body;

    if (!task_id) {
      return res.status(400).json({ error: "task_id is required" });
    }

    const updateQuery = `
      UPDATE delegation
      SET adminremarks = $1,
          updated_at = NOW() AT TIME ZONE 'Asia/Kolkata'
      WHERE task_id = $2
      RETURNING task_id, adminremarks, to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') as updated_at;
    `;

    const result = await pool.query(updateQuery, [adminremarks || null, task_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({
      message: "Admin remarks updated successfully",
      data: result.rows[0]
    });

  } catch (err) {
    console.error("❌ updateAdminRemarks Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/* ------------------------------------------------------
   UPDATE USER REMARKS - For user to update their own remarks
------------------------------------------------------ */
export const updateUserRemarks = async (req, res) => {
  try {
    const { task_id } = req.params;
    const { remarks } = req.body;

    if (!task_id) {
      return res.status(400).json({ error: "task_id is required" });
    }

    const updateQuery = `
      UPDATE delegation
      SET remarks = $1,
          updated_at = NOW() AT TIME ZONE 'Asia/Kolkata'
      WHERE task_id = $2
      RETURNING task_id, remarks, to_char(updated_at, 'YYYY-MM-DD HH24:MI:SS') as updated_at;
    `;

    const result = await pool.query(updateQuery, [remarks || null, task_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Task not found" });
    }

    res.json({
      message: "User remarks updated successfully",
      data: result.rows[0]
    });

  } catch (err) {
    console.error("❌ updateUserRemarks Error:", err);
    res.status(500).json({ error: err.message });
  }
};


/* ------------------------------------------------------
   REVERT TO PENDING - Delete from delegation_done & reset delegation
------------------------------------------------------ */
export const revertDelegationTask = async (req, res) => {
  const client = await pool.connect();
  try {
    const { items } = req.body; // Array of { id, task_id }

    console.log("🔄 Revert Request Body:", JSON.stringify(req.body, null, 2));

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided for revert" });
    }

    console.log(`🔄 Reverting ${items.length} tasks to pending...`);

    await client.query("BEGIN");

    for (const item of items) {
      const { id, task_id } = item;

      if (!task_id) {
        console.warn(`⚠️ Skipping item with missing task_id:`, item);
        continue;
      }

      // 1. DELETE from delegation_done using specific ID (if provided) or task_id (fallback to latest?)
      // We should really depend on 'id' from delegation_done if possible.
      // If id is provided, delete that specific entry.
      // If only task_id provided, we might delete all done entries? prefer id.

      if (id) {
        await client.query("DELETE FROM delegation_done WHERE id = $1", [id]);
        console.log(`🗑️ Deleted delegation_done row id: ${id}`);
      } else {
        // Fallback: Delete all done entries for this task? Or just the latest?
        // Let's assume for now we always have ID from frontend selection.
        console.warn(`⚠️ No done_id provided for task ${task_id}, skipping deletion of done record to avoid data loss default behavior.`);
      }

      // 2. UPDATE delegation table
      // Reset status to 'pending' (or whatever default is), clear submission_date
      // Using 'pending' as default per requirement.
      const updateQuery = `
        UPDATE delegation
        SET status = 'pending',
            submission_date = NULL,
            updated_at = NOW() AT TIME ZONE 'Asia/Kolkata',
            adminremarks = NULL
        WHERE task_id = $1
      `;
      // Note: admin_done isn't in delegation table based on previous schema checks, it was in delegation_done? 
      // Wait, let's double check schema. 
      // fetchDelegation_DoneDataSortByDate query: 
      // SELECT ... dd.admin_done, dd.admin_done_remarks ... FROM delegation_done dd ...
      // So admin_done is in delegation_done. We just deleted the row, so that's fine.
      // But we need to update delegation status.

      await client.query(updateQuery, [task_id]);
      console.log(`🔄 Updated delegation status for task_id: ${task_id}`);
    }

    await client.query("COMMIT");
    console.log("✅ Revert successful");

    res.json({ message: "Tasks reverted to pending successfully" });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ revertDelegationTask Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};
