import pool from "../config/db.js";
import { uploadDocumentImage } from "../middleware/workingDateS3Upload.js";

/**
 * Submit Working Date Details
 * Handles bulk submission of work rows with optional images.
 */
export const submitWorkingDate = async (req, res) => {
  const client = await pool.connect();
  try {
    const { selectedDate, entries } = req.body;
    const { username } = req.user; // Attached by sessionMiddleware

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "No work entries provided" });
    }

    // 1. Fetch user metadata for audit snapshot
    const userQuery = `
      SELECT user_name, employee_id, unit, division, department 
      FROM users 
      WHERE user_name = $1 
      LIMIT 1
    `;
    const userRes = await client.query(userQuery, [username]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: "User profile not found" });
    }
    const user = userRes.rows[0];

    await client.query("BEGIN");

    const results = [];
    for (const entry of entries) {
      let imageUrl = null;

      // 2. Process Image if present (Base64 -> S3)
      if (entry.image_base64 && typeof entry.image_base64 === 'string' && entry.image_base64.length > 100) {
        try {
          console.log(`📸 Processing image for user ${user.user_name}, entry: ${entry.workDetail?.substring(0, 20)}...`);
          imageUrl = await uploadDocumentImage(entry.image_base64, `working_date_${user.employee_id || user.user_name}.png`);
          console.log("✅ Image successfully stored at:", imageUrl);
        } catch (imgErr) {
          console.error("❌ Image Upload Error for entry:", entry.workDetail?.substring(0, 20), "Error:", imgErr.message);
          // imageUrl remains null, but record is still saved
        }
      } else if (entry.image_base64) {
        console.warn("⚠️ Received image_base64 but it appeared invalid (too short or not a string)");
      }

      // 3. Insert Record
      const insertQuery = `
        INSERT INTO working_date_history 
        (work_datetime, user_name, employee_id, work_details, assign_by, image_url, unit, division, department)
        VALUES ($1::timestamp, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `;

      // Combine selectedDate with entry.time to create a full ISO timestamp
      // Ensuring the time is correctly appended for robust Postgres parsing
      const workTimestamp = `${selectedDate} ${entry.time || '00:00'}`;

      const insertValues = [
        workTimestamp,
        user.user_name,
        user.employee_id || 'NA', // Fallback to 'NA' if employee_id is missing in users table
        entry.workDetail,
        entry.assignBy || 'Self',
        imageUrl || entry.image_url || null, // Fallback to existing URL if any
        user.unit,
        user.division,
        user.department
      ];

      const { rows } = await client.query(insertQuery, insertValues);
      results.push(rows[0]);
    }

    await client.query("COMMIT");
    res.json({ message: "Work details submitted successfully", count: results.length });

  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("❌ Submit Working Date Error:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
      hint: "Check if all required fields are provided and database schema matches."
    });
  }
  finally {
    client.release();
  }
};

/**
 * Get Working Date History
 * Returns different views based on role.
 */
export const getWorkingDateHistoryList = async (req, res) => {
  try {
    const { username } = req.user;

    // Fetch full user profile for role/dept filtering
    const userRes = await pool.query("SELECT role, unit, division, department FROM users WHERE user_name = $1", [username]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const { role, unit, division, department } = userRes.rows[0];
    const upperRole = (role || "").toUpperCase();

    const { search, page = 1, limit = 10 } = req.query;
    const paginationPage = parseInt(page);
    const paginationLimit = parseInt(limit);
    const offset = (paginationPage - 1) * paginationLimit;

    let query = "";
    let params = [];
    let searchFilter = "";

    if (search) {
      params.push(`%${search}%`);
      const searchIdx = params.length;
      searchFilter = ` AND (user_name ILIKE $${searchIdx} OR employee_id ILIKE $${searchIdx})`;
    }

    if (upperRole === "SUPER_ADMIN") {
      // Super Admin: Get distinct list of employees who have submitted work
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      params.push(paginationLimit, offset);

      query = `
        SELECT 
          user_name as name, 
          user_name as "userName",
          employee_id as "empId", 
          MAX(work_datetime) as "lastActive"
        FROM working_date_history
        WHERE 1=1 ${searchFilter}
        GROUP BY user_name, employee_id
        ORDER BY "lastActive" DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
    }
    else if (upperRole === "ADMIN" || upperRole === "DIV_ADMIN") {
      // Admin Jurisdiction Check
      // DIV_ADMIN: same division
      // ADMIN: same division AND department

      const divVal = division;
      const deptVal = department;

      params.push(divVal);
      const divIdx = params.length;
      let deptIdx = null;

      if (upperRole === "ADMIN") {
        params.push(deptVal);
        deptIdx = params.length;
      }

      // Rebuild search filter with correct indices
      let dynamicSearchFilter = "";
      if (search) {
        params.push(`%${search}%`);
        const sIdx = params.length;
        dynamicSearchFilter = ` AND (user_name ILIKE $${sIdx} OR employee_id ILIKE $${sIdx})`;
      }

      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      params.push(paginationLimit, offset);

      query = `
        SELECT 
          user_name as name, 
          user_name as "userName",
          employee_id as "empId", 
          MAX(work_datetime) as "lastActive"
        FROM working_date_history
        WHERE LOWER(division) = LOWER($${divIdx})
          ${upperRole === "ADMIN" ? ` AND LOWER(department) = LOWER($${deptIdx})` : ""}
        ${dynamicSearchFilter}
        GROUP BY user_name, employee_id
        ORDER BY "lastActive" DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
    }
    else {
      // Regular User: Get their own detailed history
      params = [username];
      let userSearchFilter = "";
      if (search) {
        params.push(`%${search}%`);
        userSearchFilter = ` AND (work_details ILIKE $2 OR assign_by ILIKE $2)`;
      }

      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      params.push(paginationLimit, offset);

      query = `
        SELECT 
          id, 
          to_char(work_datetime, 'DD/MM/YYYY') as date,
          to_char(work_datetime, 'HH24:MI') as time,
          work_details as "workDetail",
          assign_by as "assignBy",
          image_url as "image"
        FROM working_date_history
        WHERE user_name = $1 ${userSearchFilter}
        ORDER BY work_datetime DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;
    }

    const { rows } = await pool.query(query, params);

    // Check if there are more results
    const hasMore = rows.length === paginationLimit;

    res.json({
      data: rows,
      hasMore,
      page: paginationPage,
      limit: paginationLimit
    });

  } catch (err) {
    console.error("Get History Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Get Detailed History for a Specific Employee
 * Used by Super Admin / Admin modals.
 */
export const getEmployeeHistoryDetail = async (req, res) => {
  try {
    const { targetUsername } = req.params;
    const { username } = req.user;

    // 1. Get Logged-in Editor details
    const editorRes = await pool.query(
      "SELECT role, unit, division, department FROM users WHERE user_name = $1",
      [username]
    );

    if (editorRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const { role, unit, division, department } = editorRes.rows[0];
    const upperRole = (role || "").toUpperCase();

    // 2. Security Check: Determine if this editor can view this employee
    if (upperRole !== "SUPER_ADMIN") {
      // Fetch target employee jurisdiction
      const targetRes = await pool.query(
        "SELECT unit, division, department FROM users WHERE user_name = $1",
        [targetUsername]
      );

      if (targetRes.rows.length === 0) {
        // If employee not in users table, fallback to history snapshot
        const historyJurisdictionRes = await pool.query(
          "SELECT unit, division, department FROM working_date_history WHERE user_name = $1 LIMIT 1",
          [targetUsername]
        );
        if (historyJurisdictionRes.rows.length === 0) return res.json([]); 
        targetRes.rows[0] = historyJurisdictionRes.rows[0];
      }

      const target = targetRes.rows[0];

      // Jurisdiction Enforcement
      const isSameUnit = target.unit?.toLowerCase() === unit?.toLowerCase();
      const isSameDivision = target.division?.toLowerCase() === division?.toLowerCase();
      const isSameDepartment = target.department?.toLowerCase() === department?.toLowerCase();

      if (upperRole === "DIV_ADMIN") {
        if (!isSameUnit || !isSameDivision) return res.status(403).json({ error: "Access Denied: Outsive Division" });
      } else if (upperRole === "ADMIN") {
        if (!isSameUnit || !isSameDivision || !isSameDepartment) return res.status(403).json({ error: "Access Denied: Outside Department" });
      } else {
        // Regular users can't use this endpoint at all
        return res.status(403).json({ error: "Unauthorized" });
      }
    }

    // 3. Authorization Passed -> Fetch Data
    const query = `
      SELECT 
        id, 
        to_char(work_datetime, 'DD/MM/YYYY') as date,
        to_char(work_datetime, 'HH24:MI') as time,
        work_details as "workDetail",
        assign_by as "assignBy",
        image_url as "image"
      FROM working_date_history
      WHERE user_name = $1
      ORDER BY work_datetime DESC
    `;
    const { rows } = await pool.query(query, [targetUsername]);
    res.json(rows);

  } catch (err) {
    console.error("Get Detail Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
