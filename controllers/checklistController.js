import pool from "../config/db.js";
import upload, { uploadToS3 } from "../middleware/s3Upload.js";
import { sendUrgentTaskEmail } from "../services/emailService.js";
import whatsappService from "../services/whatsappService.js";
// -----------------------------------------
// 1️⃣ GET PENDING CHECKLIST
export const getPendingChecklist = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const username = req.query.username;
    const role = req.query.role;
    const department = req.query.department;
    const search = req.query.search || "";
    const status = req.query.status || "all";
    const frequency = req.query.frequency || "all";
    const nameFilter = req.query.name || "all";
    const divisionFilter = req.query.divisionFilter || "all";
    const departmentFilter = req.query.departmentFilter || "all";

    const limit = 50;
    const offset = (page - 1) * limit;
    const queryParams = [limit, offset];

    // Base filter for pending tasks
    let where = `submission_date IS NULL`;

    where += ` AND DATE(task_start_date) <= CASE 
      WHEN LOWER(frequency) = 'daily' THEN CURRENT_DATE + INTERVAL '1 day'
      WHEN LOWER(frequency) = 'tertiary' THEN CURRENT_DATE + INTERVAL '2 days'
      WHEN LOWER(frequency) = 'weekly' THEN CURRENT_DATE + INTERVAL '3 days'
      WHEN LOWER(frequency) = 'fortnightly' THEN CURRENT_DATE + INTERVAL '4 days'
      WHEN LOWER(frequency) = 'monthly' THEN CURRENT_DATE + INTERVAL '15 days'
      WHEN LOWER(frequency) IN ('quarterly', 'quaterly') THEN CURRENT_DATE + INTERVAL '1 month'
      WHEN LOWER(frequency) IN ('half-yearly', 'half yearly') THEN CURRENT_DATE + INTERVAL '3 months'
      WHEN LOWER(frequency) = 'yearly' THEN CURRENT_DATE + INTERVAL '10 months'
      WHEN LOWER(frequency) LIKE '%end-of%week%' THEN CURRENT_DATE + INTERVAL '7 days'
      ELSE CURRENT_DATE + INTERVAL '1 day'
    END `;

    // ⭐ Status Filter (Today, Overdue, Upcoming, Leave, Day off)
    if (status === "today") {
      where += ` AND DATE(task_start_date) = CURRENT_DATE AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive')) `;
    } else if (status === "overdue") {
      where += ` AND DATE(task_start_date) < CURRENT_DATE AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive')) `;
    } else if (status === "upcoming") {
      where += ` AND DATE(task_start_date) > CURRENT_DATE AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive')) `;
    } else if (status === "leave") {
      where += ` AND LOWER(status::text) = 'leave' `;
    } else if (status === "inactive") {
      where += ` AND LOWER(status::text) = 'inactive' `;
    } else if (status === "activation_pending") {
      where += ` AND LOWER(status::text) = 'activation_pending' `;
    } else {
      // Default 'all' view: exclude leave and inactive tasks
      where += ` AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive')) `;
    }

    // ⭐ Frequency Filter
    if (frequency !== "all") {
      where += ` AND LOWER(frequency) = LOWER($${queryParams.length + 1}) `;
      queryParams.push(frequency);
    }

    // ⭐ Name Filter
    if (nameFilter !== "all") {
      where += ` AND LOWER(name) = LOWER($${queryParams.length + 1}) `;
      queryParams.push(nameFilter);
    }

    // ⭐ Division Filter
    if (divisionFilter !== "all" && divisionFilter !== "undefined") {
      where += ` AND LOWER(division) = LOWER($${queryParams.length + 1}) `;
      queryParams.push(divisionFilter);
    }

    // ⭐ Department Filter
    if (departmentFilter !== "all" && departmentFilter !== "undefined") {
      where += ` AND LOWER(department) = LOWER($${queryParams.length + 1}) `;
      queryParams.push(departmentFilter);
    }

    // Role-based baseline filtering
    const upRole = (role || "").toUpperCase();
    const requesterUnit = req.query.unit || "";
    const requesterDivision = req.query.division || "";
    const requesterDepartment = (req.query.department || department || "").trim();

    if (upRole === "SUPER_ADMIN") {
      // All access
    } else if (upRole === "DIV_ADMIN") {
      if (requesterDivision) {
        where += ` AND LOWER(division) = LOWER('${requesterDivision.replace(/'/g, "''")}') `;
      }
    } else if (upRole === "ADMIN") {
      if (requesterDivision && requesterDepartment) {
        const deptEscaped = requesterDepartment.replace(/'/g, "''");
        where += ` AND LOWER(division) = LOWER('${requesterDivision.replace(/'/g, "''")}') AND LOWER(department) = LOWER('${deptEscaped}') `;
      } else if (requesterDepartment) {
        const deptEscaped = requesterDepartment.replace(/'/g, "''");
        where += ` AND LOWER(department) = LOWER('${deptEscaped}') `;
      }
    } else if (username) {
      // Normal users only see their own tasks
      where += ` AND LOWER(name) = LOWER($${queryParams.length + 1}) `;
      queryParams.push(username);

      if (requesterDivision) {
        where += ` AND LOWER(division) = LOWER($${queryParams.length + 1}) `;
        queryParams.push(requesterDivision);
      }
      if (requesterDepartment) {
        where += ` AND LOWER(department) = LOWER($${queryParams.length + 1}) `;
        queryParams.push(requesterDepartment);
      }
    }

    if (search.trim()) {
      const searchParamIndex = queryParams.length + 1;
      where += ` AND (
        LOWER(name) LIKE $${searchParamIndex} OR
        LOWER(task_description) LIKE $${searchParamIndex} OR
        LOWER(department) LIKE $${searchParamIndex} OR
        LOWER(given_by) LIKE $${searchParamIndex} OR
        LOWER(unit) LIKE $${searchParamIndex} OR
        LOWER(division) LIKE $${searchParamIndex} OR
        LOWER(frequency) LIKE $${searchParamIndex} OR
        LOWER(COALESCE(remark, '')) LIKE $${searchParamIndex} OR
        LOWER(COALESCE(admin_done_remarks, '')) LIKE $${searchParamIndex} OR
        LOWER(COALESCE(status::text, '')) LIKE $${searchParamIndex} OR
        CAST(task_id AS TEXT) LIKE $${searchParamIndex}
      ) `;
      queryParams.push(`%${search.toLowerCase()}%`);
    }

    const query = `
      SELECT 
        task_id,
        department,
        given_by,
        name,
        task_description,
        enable_reminder,
        require_attachment,
        frequency,
        remark,
        status,
        image,
        admin_done,
        delay,
        planned_date::text as planned_date,
        created_at::text as created_at,
        task_start_date::text as task_start_date,
        submission_date::text as submission_date,
        admin_done_remarks,
        unit,
        division,
        submitted_by,
        COUNT(*) OVER() AS total_count
      FROM checklist
      WHERE ${where}
      ORDER BY 
        CASE 
          WHEN DATE(task_start_date) < CURRENT_DATE THEN 0
          WHEN DATE(task_start_date) = CURRENT_DATE THEN 1
          ELSE 2 
        END,
        task_start_date ASC,
        task_id ASC
      LIMIT $1 OFFSET $2
    `;

    const { rows } = await pool.query(query, queryParams);


    const totalCount = rows.length > 0 ? rows[0].total_count : 0;

    res.json({
      data: rows,
      page,
      totalCount,
    });
  } catch (error) {
    console.error("❌ Error fetching pending checklist:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// -----------------------------------------
// 1.1️⃣ DELETE CHECKLIST RANGE (For Leave)
// -----------------------------------------
export const deleteChecklistInRange = async (req, res) => {
  const client = await pool.connect();
  try {
    const { username, startDate, endDate } = req.body;

    if (!username || !startDate || !endDate) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    await client.query("BEGIN");

    // Delete tasks for this user within the date range
    // We match by name (case insensitive) and check if task_start_date falls within range
    const deleteQuery = `
      DELETE FROM checklist
      WHERE LOWER(name) = LOWER($1)
      AND task_start_date >= $2
      AND task_start_date <= $3
      RETURNING *
    `;

    const { rows } = await client.query(deleteQuery, [
      username,
      startDate,
      endDate,
    ]);

    await client.query("COMMIT");

    res.json({
      message: `Deleted ${rows.length} tasks for ${username}`,
      deletedCount: rows.length,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error deleting checklist range:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
};

// -----------------------------------------
// 2️⃣ GET HISTORY CHECKLIST
// -----------------------------------------
export const getChecklistHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const username = req.query.username;
    const role = req.query.role;
    const department = req.query.department;
    const search = req.query.search;
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;
    const approvalStatus = req.query.approvalStatus || 'all'; // all, pending, approved

    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const divisionFilter = req.query.divisionFilter;
    const departmentFilter = req.query.departmentFilter;
    const nameFilter = req.query.nameFilter;

    // Build WHERE clause
    const whereConditions = [`submission_date IS NOT NULL`];
    const countWhereConditions = [`submission_date IS NOT NULL`];
    const params = [limit, offset];
    const countParams = [];
    let paramIndex = 3; // $1=limit, $2=offset
    let countParamIndex = 1;

    const addFilter = (condition, value) => {
      whereConditions.push(condition.replace(/\?/g, () => `$${paramIndex++}`));
      countWhereConditions.push(condition.replace(/\?/g, () => `$${countParamIndex++}`));
      params.push(value);
      countParams.push(value);
    };

    // Access Control Filters
    const upRole = role ? role.toUpperCase() : "USER";
    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      // No restricted filter
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      if (requesterDivision) {
        addFilter(`LOWER(division) = LOWER(?)`, requesterDivision);
      }
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDivision && (department || req.query.departmentFilter)) {
        addFilter(`LOWER(division) = LOWER(?)`, requesterDivision);
        addFilter(`LOWER(department) = LOWER(?)`, department || req.query.departmentFilter);
      } else if (department) {
        addFilter(`LOWER(department) = LOWER(?)`, department);
      }
    } else if (username) {
      addFilter(`LOWER(name) = LOWER(?)`, username);
      
      if (requesterDivision) {
        addFilter(`LOWER(division) = LOWER(?)`, requesterDivision);
      }
      if (department) {
        addFilter(`LOWER(department) = LOWER(?)`, department);
      }
    }

    // Explicit UI Filters
    if (divisionFilter && divisionFilter !== 'all') {
      addFilter(`LOWER(division) = LOWER(?)`, divisionFilter);
    }
    if (departmentFilter && departmentFilter !== 'all') {
      addFilter(`LOWER(department) = LOWER(?)`, departmentFilter);
    }
    if (nameFilter && nameFilter !== 'all') {
      addFilter(`LOWER(name) = LOWER(?)`, nameFilter);
    }

    // ⭐ Date Filters
    if (startDate && endDate) {
      addFilter(`submission_date >= ?`, startDate);
      addFilter(`submission_date <= ?`, `${endDate} 23:59:59`);
    }

    if (search) {
      const searchVal = `%${search.toLowerCase()}%`;
      const searchCondition = `(
        LOWER(name) LIKE ? OR 
        LOWER(task_description) LIKE ? OR 
        LOWER(department) LIKE ? OR 
        LOWER(given_by) LIKE ? OR
        LOWER(unit) LIKE ? OR
        LOWER(division) LIKE ? OR
        LOWER(frequency) LIKE ? OR
        LOWER(COALESCE(remark, '')) LIKE ? OR
        LOWER(COALESCE(admin_done_remarks, '')) LIKE ? OR
        LOWER(COALESCE(status::text, '')) LIKE ? OR
        CAST(task_id AS TEXT) LIKE ?
      )`;
      whereConditions.push(searchCondition.replace(/\?/g, () => `$${paramIndex++}`));
      countWhereConditions.push(searchCondition.replace(/\?/g, () => `$${countParamIndex++}`));
      // Push the same value for all 11 placeholders in the search condition
      for (let i = 0; i < 11; i++) {
        params.push(searchVal);
        countParams.push(searchVal);
      }
    }

    // Final main WHERE clause includes approvalStatus
    const mainWhereConditions = [...whereConditions];
    if (approvalStatus === 'pending') {
      mainWhereConditions.push(`(admin_done IS NULL OR admin_done != 'Done')`);
    } else if (approvalStatus === 'approved') {
      mainWhereConditions.push(`admin_done = 'Done'`);
    }

    const where = mainWhereConditions.join(" AND ");

    // --- COUNT QUERY ---
    const countQueryText = `
      SELECT 
        COUNT(*)::INT as total_count,
        SUM(CASE WHEN admin_done = 'Done' THEN 1 ELSE 0 END)::INT as approved_count
      FROM checklist
      WHERE ${countWhereConditions.join(" AND ")}
    `;
    const countRes = await pool.query(countQueryText, countParams);
    const totalCount = countRes.rows[0].total_count || 0;
    const approvedCount = countRes.rows[0].approved_count || 0;
    const pendingCount = totalCount - approvedCount;

    // --- DATA QUERY (Filtered for UI) ---
    const query = `
      SELECT 
        task_id,
        department,
        given_by,
        name,
        task_description,
        enable_reminder,
        require_attachment,
        frequency,
        remark,
        status,
        image,
        admin_done,
        delay,
        planned_date::text as planned_date,
        created_at::text as created_at,
        task_start_date::text as task_start_date,
        submission_date::text as submission_date,
        admin_done_remarks,
        unit,
        division,
        submitted_by,
        approved_by
      FROM checklist
      WHERE ${where}
      ORDER BY submission_date DESC
      LIMIT $1 OFFSET $2
    `;

    const { rows } = await pool.query(query, params);

    res.json({
      data: rows,
      page,
      totalCount,
      approvedCount,
      pendingCount,
      totalPages: Math.ceil(totalCount / limit)
    });
  } catch (error) {
    console.error("❌ Error fetching history:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// -----------------------------------------
// 3️⃣ UPDATE CHECKLIST (User Submit)
// -----------------------------------------
export const updateChecklist = async (req, res) => {
  try {
    const items = req.body;

    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: "Invalid data" });

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      for (const item of items) {
        // 🔥 Fix status
        const safeStatus =
          (item.status || "").toLowerCase() === "yes" ? "yes" : "no";

        // ---------------------------------
        // 🔥🔥 FIX: IMAGE HANDLING
        // ---------------------------------
        let finalImageUrls = [];

        // Handle array of images
        if (item.images && Array.isArray(item.images)) {
          for (const imageStr of item.images) {
            if (typeof imageStr === "string") {
              if (imageStr.startsWith("data:")) {
                const matches = imageStr.match(/^data:([a-zA-Z0-9-+\/.]+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                  const mimeType = matches[1];
                  const base64Data = matches[2];
                  const buffer = Buffer.from(base64Data, "base64");

                  let extension = mimeType.split('/')[1] || "bin";
                  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) extension = "jpg";
                  else if (mimeType.includes("pdf")) extension = "pdf";
                  else if (mimeType.includes("word") || mimeType.includes("document")) extension = "docx";
                  else if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) extension = "xlsx";
                  else if (mimeType.includes("csv")) extension = "csv";

                  const fakeFile = {
                    originalname: `task_${item.taskId}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`,
                    buffer,
                    mimetype: mimeType,
                  };

                  const s3Url = await uploadToS3(fakeFile);
                  if (s3Url) finalImageUrls.push(s3Url);
                } else {
                  finalImageUrls.push(imageStr);
                }
              } else {
                finalImageUrls.push(imageStr);
              }
            }
          }
        } else if (item.image && typeof item.image === "string") {
          // Legacy generic fallback if sending a single image string
          if (item.image.startsWith("data:")) {
            const matches = item.image.match(/^data:([a-zA-Z0-9-+\/.]+);base64,(.+)$/);
            if (matches && matches.length === 3) {
              const mimeType = matches[1];
              const base64Data = matches[2];
              const buffer = Buffer.from(base64Data, "base64");

              let extension = mimeType.split('/')[1] || "bin";
              if (mimeType.includes("jpeg") || mimeType.includes("jpg")) extension = "jpg";
              else if (mimeType.includes("pdf")) extension = "pdf";
              else if (mimeType.includes("word") || mimeType.includes("document")) extension = "docx";
              else if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) extension = "xlsx";
              else if (mimeType.includes("csv")) extension = "csv";

              const fakeFile = {
                originalname: `task_${item.taskId}_${Date.now()}.${extension}`,
                buffer,
                mimetype: mimeType,
              };

              const s3Url = await uploadToS3(fakeFile);
              if (s3Url) finalImageUrls.push(s3Url);
            } else {
              finalImageUrls.push(item.image);
            }
          } else {
            // Already S3 URL or old string
            finalImageUrls.push(item.image);
          }
        }

        const finalImageUrl = finalImageUrls.length > 0 ? finalImageUrls.join(',') : null;

        // ---------------------------------
        // 🔥 SAVE TO DATABASE
        // ---------------------------------
        const sql = `
          UPDATE checklist
          SET 
           status = $1,
            remark = $2,
            submission_date = date_trunc('second', NOW() AT TIME ZONE 'Asia/Kolkata'),
            image = $3,
            submitted_by = $5
          WHERE task_id = $4
        `;

        await client.query(sql, [
          safeStatus,
          item.remarks || "",
          finalImageUrl,
          item.taskId,
          item.submittedBy || null,
        ]);
      }

      await client.query("COMMIT");
      res.json({ message: "Checklist updated successfully" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error("❌ updateChecklist Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// -----------------------------------------
// 4️⃣ ADMIN DONE UPDATE
// -----------------------------------------
export const adminDoneChecklist = async (req, res) => {
  const client = await pool.connect();
  try {
    const items = req.body;

    if (!items || items.length === 0)
      return res.status(400).json({ error: "No items provided" });

    await client.query("BEGIN");

    const sql = `
      UPDATE checklist
      SET admin_done = 'Done',
          admin_done_remarks = $2,
          approved_by = $3
      WHERE task_id = $1
    `;

    for (const item of items) {
      // item must have task_id, optional remarks, optional approvedBy
      await client.query(sql, [
        item.task_id,
        item.remarks || null,
        item.approvedBy || null
      ]);
    }

    await client.query("COMMIT");

    res.json({ message: "Admin updated successfully" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ adminDoneChecklist Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// -----------------------------------------
// 5️⃣ SEND EMAIL NOTIFICATION (Admin Only)
// -----------------------------------------
export const sendEmailNotification = async (req, res) => {
  try {
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "No items provided" });
    }

    const results = [];

    for (const item of items) {
      const doerName = item.name;

      // Look up doer's email & phone from users table
      const userResult = await pool.query(
        "SELECT email_id, number FROM users WHERE user_name = $1",
        [doerName]
      );

      if (userResult.rows.length === 0 || (!userResult.rows[0].email_id && !userResult.rows[0].number)) {
        results.push({
          name: doerName,
          success: false,
          error: "Contact info not found",
        });
        continue;
      }

      const email = userResult.rows[0].email_id;
      const phone = userResult.rows[0].number;

      // Format date
      const formatDate = (dateStr) => {
        if (!dateStr) return "N/A";
        try {
          const date = new Date(dateStr);
          return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
        } catch (e) {
          return dateStr;
        }
      };

      // Send Email
      let emailResult = { success: true };
      if (email) {
        emailResult = await sendUrgentTaskEmail(email, {
          name: doerName,
          taskId: item.task_id || "N/A",
          description: item.task_description || "N/A",
          dueDate: formatDate(item.task_start_date),
          givenBy: item.given_by || "N/A"
        });
      }

      // Send WhatsApp
      let waSuccess = true;
      let waError = null;
      if (phone) {
        const waMessage = `🚨 *URGENT CHECKLIST ALERT* 🚨\n\nHello ${doerName},\n\nThe following checklist task requires your *immediate attention*:\n\n📌 Task ID: ${item.task_id || 'N/A'}\n📝 Task: ${item.task_description || 'N/A'}\n⏳ Planned Date: ${formatDate(item.task_start_date)}\n🧑‍💼 Given By: ${item.given_by || 'N/A'}\n\nClosure Link:\nhttps://checklist-frontend-nu.vercel.app\n\nPlease take immediate action.`;
        const waResult = await whatsappService.sendWhatsAppMessage(phone, waMessage);
        waSuccess = waResult.success;
        waError = waResult.error;
      }

      results.push({
        name: doerName,
        success: emailResult.success || waSuccess,
        error: emailResult.error || waError || null,
      });
    }

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    res.json({
      message: `Notifications sent: ${successCount} success, ${failCount} failed`,
      results,
    });
  } catch (err) {
    console.error("❌ sendEmailNotification Error:", err);
    res.status(500).json({ error: err.message });
  }
};
// -----------------------------------------
// 6️⃣ GET CHECKLIST & MAINTENANCE METADATA
// -----------------------------------------
export const getChecklistMetadata = async (req, res) => {
  try {
    const divisionQuery = `
      SELECT DISTINCT division 
      FROM (
        SELECT division FROM checklist WHERE division IS NOT NULL AND division != ''
        UNION
        SELECT division FROM maintenance_tasks WHERE division IS NOT NULL AND division != ''
      ) AS combined 
      ORDER BY division ASC
    `;

    const departmentQuery = `
      SELECT DISTINCT department 
      FROM (
        SELECT department FROM checklist WHERE department IS NOT NULL AND department != ''
        UNION
        SELECT department FROM maintenance_tasks WHERE department IS NOT NULL AND department != ''
      ) AS combined 
      ORDER BY department ASC
    `;

    const [divisions, departments] = await Promise.all([
      pool.query(divisionQuery),
      pool.query(departmentQuery)
    ]);

    res.json({
      divisions: divisions.rows.map(r => r.division),
      departments: departments.rows.map(r => r.department)
    });
  } catch (error) {
    console.error("❌ Error fetching checklist metadata:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
// -----------------------------------------
// 7️⃣ BULK TOGGLE DAY OFF (INACTIVE) CHECKLIST
// -----------------------------------------
export const bulkDeleteChecklist = async (req, res) => {
  const client = await pool.connect();
  try {
    const { taskIds, role } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: "No task IDs provided" });
    }

    const upRole = (role || "").toUpperCase();
    const isAdmin = ["SUPER_ADMIN", "ADMIN", "DIV_ADMIN"].includes(upRole);

    await client.query("BEGIN");

    // Toggle status logic:
    // 1. If currently 'Inactive' or 'Activation_Pending':
    //    - If Admin: Set to NULL (Approved/Active)
    //    - If User: Set to 'Activation_Pending' (Requesting Day On)
    // 2. If currently NULL (or anything else):
    //    - Set to 'Inactive' (Day Off)

    const query = `
      UPDATE checklist 
      SET status = CASE 
        WHEN status = 'Inactive' OR status = 'Activation_Pending' THEN 
          CASE WHEN $2 = true THEN NULL ELSE 'Activation_Pending'::enable_reminder END
        ELSE 'Inactive'::enable_reminder 
      END
      WHERE task_id = ANY($1)
    `;
    const { rowCount } = await client.query(query, [taskIds, isAdmin]);
    await client.query("COMMIT");

    const message = isAdmin
      ? `Successfully updated ${rowCount} tasks.`
      : `Requested activation for tasks. Status set to Pending Activation.`;

    res.json({ message, updatedCount: rowCount });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error in bulkDeleteChecklist:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
};

// -----------------------------------------
// 7.1️⃣ APPROVE ACTIVATION CHECKLIST (Admin Only)
// -----------------------------------------
export const approveActivationChecklist = async (req, res) => {
  const client = await pool.connect();
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: "No task IDs provided" });
    }

    await client.query("BEGIN");
    const query = `
      UPDATE checklist 
      SET status = NULL
      WHERE task_id = ANY($1) AND status = 'Activation_Pending'
    `;
    const { rowCount } = await client.query(query, [taskIds]);
    await client.query("COMMIT");

    res.json({ message: `Successfully approved activation for ${rowCount} tasks`, updatedCount: rowCount });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error in approveActivationChecklist:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
};

// -----------------------------------------
// 8️⃣ BULK LEAVE CHECKLIST
// -----------------------------------------
export const bulkLeaveChecklist = async (req, res) => {
  const client = await pool.connect();
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: "No task IDs provided" });
    }

    await client.query("BEGIN");
    const query = `
      UPDATE checklist 
      SET status = 'Leave'::enable_reminder
      WHERE task_id = ANY($1)
    `;
    const { rowCount } = await client.query(query, [taskIds]);
    await client.query("COMMIT");

    res.json({ message: `Successfully marked ${rowCount} tasks as Leave`, updatedCount: rowCount });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Error in bulkLeaveChecklist:", error);
    res.status(500).json({ error: "Internal Server Error" });
  } finally {
    client.release();
  }
};
