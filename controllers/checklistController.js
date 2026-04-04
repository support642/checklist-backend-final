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

    where += ` AND DATE(task_start_date) <= CURRENT_DATE + INTERVAL '1 day' `;

    // ⭐ Status Filter (Today, Overdue, Upcoming)
    if (status === "today") {
      where += ` AND DATE(task_start_date) = CURRENT_DATE `;
    } else if (status === "overdue") {
      where += ` AND DATE(task_start_date) < CURRENT_DATE `;
    } else if (status === "upcoming") {
      where += ` AND DATE(task_start_date) > CURRENT_DATE `;
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
      if (requesterUnit && requesterDivision) {
        where += ` AND LOWER(unit) = LOWER('${requesterUnit.replace(/'/g, "''")}') AND LOWER(division) = LOWER('${requesterDivision.replace(/'/g, "''")}') `;
      }
    } else if (upRole === "ADMIN") {
      if (requesterUnit && requesterDivision && requesterDepartment) {
        const deptEscaped = requesterDepartment.replace(/'/g, "''");
        where += ` AND LOWER(unit) = LOWER('${requesterUnit.replace(/'/g, "''")}') AND LOWER(division) = LOWER('${requesterDivision.replace(/'/g, "''")}') AND LOWER(department) = LOWER('${deptEscaped}') `;
      } else if (requesterDepartment) {
        const deptEscaped = requesterDepartment.replace(/'/g, "''");
        where += ` AND LOWER(department) = LOWER('${deptEscaped}') `;
      }
    } else if (username) {
      // Normal users only see their own tasks
      where += ` AND LOWER(name) = LOWER($${queryParams.length + 1}) `;
      queryParams.push(username);
    }

    // ⭐ Search filter
    if (search.trim()) {
      const searchParamIndex = queryParams.length + 1;
      where += ` AND (
        LOWER(name) LIKE $${searchParamIndex} OR
        LOWER(task_description) LIKE $${searchParamIndex} OR
        LOWER(department) LIKE $${searchParamIndex} OR
        LOWER(given_by) LIKE $${searchParamIndex} OR
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
        COUNT(*) OVER() AS total_count
      FROM checklist
      WHERE ${where}
      ORDER BY 
        CASE 
          WHEN DATE(task_start_date) < CURRENT_DATE THEN 0
          WHEN DATE(task_start_date) = CURRENT_DATE THEN 1
          ELSE 2 
        END,
        task_start_date ASC
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

    const limit = 50;
    const offset = (page - 1) * limit;
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const divisionFilter = req.query.divisionFilter;
    const departmentFilter = req.query.departmentFilter;
    const nameFilter = req.query.nameFilter;

    // Build WHERE clause
    const whereConditions = [`submission_date IS NOT NULL`];
    const params = [limit, offset];
    let paramIndex = 3; // $1=limit, $2=offset

    // Access Control Filters
    const upRole = role ? role.toUpperCase() : "USER";
    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      // No restricted filter
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      if (requesterUnit && requesterDivision) {
        whereConditions.push(`LOWER(unit) = LOWER($${paramIndex++})`);
        params.push(requesterUnit);
        whereConditions.push(`LOWER(division) = LOWER($${paramIndex++})`);
        params.push(requesterDivision);
      }
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterUnit && requesterDivision && department) {
        whereConditions.push(`LOWER(unit) = LOWER($${paramIndex++})`);
        params.push(requesterUnit);
        whereConditions.push(`LOWER(division) = LOWER($${paramIndex++})`);
        params.push(requesterDivision);
        whereConditions.push(`LOWER(department) = LOWER($${paramIndex++})`);
        params.push(department);
      } else if (department) {
        whereConditions.push(`LOWER(department) = LOWER($${paramIndex++})`);
        params.push(department);
      }
    } else if (username) {
      whereConditions.push(`LOWER(name) = LOWER($${paramIndex++})`);
      params.push(username);
    }

    // Explicit UI Filters
    if (divisionFilter && divisionFilter !== 'all') {
      whereConditions.push(`LOWER(division) = LOWER($${paramIndex++})`);
      params.push(divisionFilter);
    }
    if (departmentFilter && departmentFilter !== 'all') {
      whereConditions.push(`LOWER(department) = LOWER($${paramIndex++})`);
      params.push(departmentFilter);
    }
    if (nameFilter && nameFilter !== 'all') {
      whereConditions.push(`LOWER(name) = LOWER($${paramIndex++})`);
      params.push(nameFilter);
    }

    if (search) {
      const searchPlaceholder = `$${paramIndex++}`;
      whereConditions.push(`(
        LOWER(name) LIKE ${searchPlaceholder} OR 
        LOWER(task_description) LIKE ${searchPlaceholder} OR 
        LOWER(department) LIKE ${searchPlaceholder} OR 
        LOWER(given_by) LIKE ${searchPlaceholder} OR
        CAST(task_id AS TEXT) LIKE ${searchPlaceholder} OR
        LOWER(unit) LIKE ${searchPlaceholder} OR
        LOWER(division) LIKE ${searchPlaceholder}
      )`);
      params.push(`%${search.toLowerCase()}%`);
    }

    const where = whereConditions.join(" AND ");

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
        COUNT(*) OVER() AS total_count,
        SUM(CASE WHEN admin_done = 'Done' THEN 1 ELSE 0 END) OVER() AS approved_count
      FROM checklist
      WHERE ${where}
      ORDER BY submission_date DESC
      LIMIT $1 OFFSET $2
    `;

    const { rows } = await pool.query(query, params);

    const totalCount = rows.length > 0 ? parseInt(rows[0].total_count) : 0;
    const approvedCount = rows.length > 0 ? parseInt(rows[0].approved_count) : 0;

    res.json({
      data: rows,
      page,
      totalCount,
      approvedCount,
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
            image = $3
          WHERE task_id = $4
        `;

        await client.query(sql, [
          safeStatus,
          item.remarks || "",
          finalImageUrl,
          item.taskId,
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
          admin_done_remarks = $2
      WHERE task_id = $1
    `;

    for (const item of items) {
      // item must have task_id, optional remarks
      await client.query(sql, [item.task_id, item.remarks || null]);
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
