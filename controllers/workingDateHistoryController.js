import pool from "../config/db.js";
import { uploadDocumentImage } from "../middleware/workingDateS3Upload.js";

/**
 * Submit Working Date Details
 * Handles bulk submission of work rows with optional images, status, and duration.
 */
export const submitWorkingDate = async (req, res) => {
  const client = await pool.connect();
  try {
    const { selectedDate, entries } = req.body;
    const { username } = req.user; // Attached by sessionMiddleware

    if (!entries || !Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: "No work entries provided" });
    }

    await client.query("BEGIN");

    const results = [];
    for (const entry of entries) {
      let imageUrl = null;

      // 1. Determine target worker username (allow admins to submit on behalf of others)
      const targetUser = entry.userName || username;

      // 2. Fetch target user profile metadata for audit snapshot
      const userQuery = `
        SELECT user_name, employee_id, unit, division, department 
        FROM users 
        WHERE user_name = $1 
        LIMIT 1
      `;
      const userRes = await client.query(userQuery, [targetUser]);
      
      const targetUserMeta = userRes.rows.length > 0 ? userRes.rows[0] : {
        user_name: targetUser,
        employee_id: 'NA',
        unit: 'N/A',
        division: 'N/A',
        department: 'N/A'
      };

      // 3. Process Image if present (Base64 -> S3)
      if (entry.image_base64 && typeof entry.image_base64 === 'string' && entry.image_base64.length > 100) {
        try {
          console.log(`📸 Processing image for user ${targetUserMeta.user_name}, entry: ${entry.workDetail?.substring(0, 20)}...`);
          imageUrl = await uploadDocumentImage(entry.image_base64, `working_date_${targetUserMeta.employee_id || targetUserMeta.user_name}.png`);
          console.log("✅ Image successfully stored at:", imageUrl);
        } catch (imgErr) {
          console.error("❌ Image Upload Error for entry:", entry.workDetail?.substring(0, 20), "Error:", imgErr.message);
        }
      }

      // 4. Insert Record
      const insertQuery = `
        INSERT INTO working_date_history 
        (work_datetime, user_name, employee_id, work_details, assign_by, image_url, unit, division, department, status, duration)
        VALUES ($1::timestamp, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      // Combine selectedDate with entry.time to create a full ISO timestamp
      const workTimestamp = `${selectedDate} ${entry.time || '00:00'}`;

      const insertValues = [
        workTimestamp,
        targetUserMeta.user_name,
        targetUserMeta.employee_id || 'NA',
        entry.workDetail,
        entry.assignBy || 'Self',
        imageUrl || entry.image_url || null,
        targetUserMeta.unit,
        targetUserMeta.division,
        targetUserMeta.department,
        entry.status || null,
        entry.duration || null
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
      details: err.message
    });
  }
  finally {
    client.release();
  }
};

/**
 * Get Working Date History
 * Returns detailed entries list chronologically, respecting roles and search parameters.
 */
export const getWorkingDateHistoryList = async (req, res) => {
  try {
    const { username } = req.user;

    // Fetch full user profile for role/dept filtering
    const userRes = await pool.query("SELECT role, unit, division, department FROM users WHERE user_name = $1", [username]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const { role, unit, division, department } = userRes.rows[0];
    const upperRole = (role || "").toUpperCase();

    const { search, page = 1, limit = 10, export: exportAll, startDate, endDate, filterUser } = req.query;
    const paginationPage = parseInt(page);
    const paginationLimit = parseInt(limit);
    const offset = (paginationPage - 1) * paginationLimit;

    let query = "";
    let params = [];
    let whereClauses = [];

    // 1. Role-based base query filters
    if (upperRole === "SUPER_ADMIN") {
      // Super admin has no base filters
    } else if (upperRole === "ADMIN" || upperRole === "DIV_ADMIN") {
      params.push(division);
      whereClauses.push(`LOWER(division) = LOWER($${params.length})`);
      if (upperRole === "ADMIN") {
        params.push(department);
        whereClauses.push(`LOWER(department) = LOWER($${params.length})`);
      }
    } else {
      // Regular User: restrict to their own records
      params.push(username);
      whereClauses.push(`user_name = $${params.length}`);
    }

    // 2. Add search filters
    if (search) {
      params.push(`%${search}%`);
      const searchIdx = params.length;
      if (upperRole !== "SUPER_ADMIN" && upperRole !== "ADMIN" && upperRole !== "DIV_ADMIN") {
        // Regular user search
        whereClauses.push(`(work_details ILIKE $${searchIdx} OR assign_by ILIKE $${searchIdx} OR status ILIKE $${searchIdx})`);
      } else {
        // Admin/Super Admin search
        whereClauses.push(`(user_name ILIKE $${searchIdx} OR work_details ILIKE $${searchIdx} OR employee_id ILIKE $${searchIdx})`);
      }
    }

    // 3. Add employee name filter (for Super Admin / Admin / Div Admin)
    if (filterUser && (upperRole === "SUPER_ADMIN" || upperRole === "ADMIN" || upperRole === "DIV_ADMIN")) {
      params.push(filterUser);
      whereClauses.push(`user_name = $${params.length}`);
    }

    // 4. Add date range filters
    if (startDate) {
      params.push(startDate);
      whereClauses.push(`work_datetime::date >= $${params.length}`);
    }
    if (endDate) {
      params.push(endDate);
      whereClauses.push(`work_datetime::date <= $${params.length}`);
    }

    // Combine WHERE clause
    const whereClauseStr = whereClauses.length > 0 ? "WHERE " + whereClauses.join(" AND ") : "";

    // Count query to get total records matching filters
    const countQuery = `SELECT COUNT(*) as count FROM working_date_history ${whereClauseStr}`;
    const countRes = await pool.query(countQuery, params);
    const totalCount = parseInt(countRes.rows[0]?.count || 0);

    // Build main SQL query
    let baseQuery = `
      SELECT 
        id, 
        to_char(work_datetime, 'DD/MM/YYYY') as date,
        to_char(work_datetime, 'HH24:MI') as time,
        user_name as "userName",
        employee_id as "empId",
        work_details as "workDetail",
        assign_by as "assignBy",
        image_url as "image",
        status,
        duration
      FROM working_date_history
      ${whereClauseStr}
      ORDER BY work_datetime DESC
    `;

    if (exportAll === "true") {
      query = baseQuery;
    } else {
      params.push(paginationLimit, offset);
      query = `${baseQuery} LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }

    const { rows } = await pool.query(query, params);
    const hasMore = exportAll === "true" ? false : rows.length === paginationLimit;

    res.json({
      data: rows,
      hasMore,
      page: exportAll === "true" ? 1 : paginationPage,
      limit: exportAll === "true" ? rows.length : paginationLimit,
      totalCount
    });

  } catch (err) {
    console.error("Get History Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Get Detailed History for a Specific Employee
 * Used by Super Admin / Admin modals if needed.
 */
export const getEmployeeHistoryDetail = async (req, res) => {
  try {
    const { targetUsername } = req.params;
    const { username } = req.user;

    const editorRes = await pool.query(
      "SELECT role, unit, division, department FROM users WHERE user_name = $1",
      [username]
    );

    if (editorRes.rows.length === 0) return res.status(404).json({ error: "User not found" });

    const { role, unit, division, department } = editorRes.rows[0];
    const upperRole = (role || "").toUpperCase();

    if (upperRole !== "SUPER_ADMIN") {
      const targetRes = await pool.query(
        "SELECT unit, division, department FROM users WHERE user_name = $1",
        [targetUsername]
      );

      if (targetRes.rows.length === 0) {
        const historyJurisdictionRes = await pool.query(
          "SELECT unit, division, department FROM working_date_history WHERE user_name = $1 LIMIT 1",
          [targetUsername]
        );
        if (historyJurisdictionRes.rows.length === 0) return res.json([]); 
        targetRes.rows[0] = historyJurisdictionRes.rows[0];
      }

      const target = targetRes.rows[0];

      const isSameUnit = target.unit?.toLowerCase() === unit?.toLowerCase();
      const isSameDivision = target.division?.toLowerCase() === division?.toLowerCase();
      const isSameDepartment = target.department?.toLowerCase() === department?.toLowerCase();

      if (upperRole === "DIV_ADMIN") {
        if (!isSameUnit || !isSameDivision) return res.status(403).json({ error: "Access Denied: Outside Division" });
      } else if (upperRole === "ADMIN") {
        if (!isSameUnit || !isSameDivision || !isSameDepartment) return res.status(403).json({ error: "Access Denied: Outside Department" });
      } else {
        return res.status(403).json({ error: "Unauthorized" });
      }
    }

    const { page = 1, limit = 10 } = req.query;
    const paginationPage = parseInt(page);
    const paginationLimit = parseInt(limit);
    const offset = (paginationPage - 1) * paginationLimit;

    const query = `
      SELECT 
        id, 
        to_char(work_datetime, 'DD/MM/YYYY') as date,
        to_char(work_datetime, 'HH24:MI') as time,
        user_name as "userName",
        employee_id as "empId",
        work_details as "workDetail",
        assign_by as "assignBy",
        image_url as "image",
        status,
        duration
      FROM working_date_history
      WHERE user_name = $1
      ORDER BY work_datetime DESC
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pool.query(query, [targetUsername, paginationLimit, offset]);
    
    const hasMore = rows.length === paginationLimit;

    res.json({
      data: rows,
      hasMore,
      page: paginationPage,
      limit: paginationLimit
    });

  } catch (err) {
    console.error("Get Detail Error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Update working date entry
 */
export const updateWorkingDate = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { selectedDate, time, workDetail, assignBy, image_base64, image_url, status, duration, userName } = req.body;
    const { username } = req.user; // Logged-in user

    // 1. Fetch the existing entry
    const checkQuery = `SELECT * FROM working_date_history WHERE id = $1`;
    const checkRes = await client.query(checkQuery, [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: "Entry not found" });
    }
    const existingEntry = checkRes.rows[0];

    // 2. Fetch logged-in user role & jurisdiction
    const userProfileQuery = `SELECT role, unit, division, department FROM users WHERE user_name = $1`;
    const userProfileRes = await client.query(userProfileQuery, [username]);
    if (userProfileRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const loggedInUser = userProfileRes.rows[0];
    const upperRole = (loggedInUser.role || "").toUpperCase();

    // 3. Permission Check
    let isAllowed = false;
    if (upperRole === "SUPER_ADMIN") {
      isAllowed = true;
    } else if (existingEntry.user_name.toLowerCase() === username.toLowerCase()) {
      isAllowed = true;
    } else if (upperRole === "ADMIN" || upperRole === "DIV_ADMIN") {
      const isSameUnit = existingEntry.unit?.toLowerCase() === loggedInUser.unit?.toLowerCase();
      const isSameDivision = existingEntry.division?.toLowerCase() === loggedInUser.division?.toLowerCase();
      const isSameDepartment = existingEntry.department?.toLowerCase() === loggedInUser.department?.toLowerCase();

      if (upperRole === "DIV_ADMIN") {
        isAllowed = isSameDivision;
      } else if (upperRole === "ADMIN") {
        isAllowed = isSameDivision && isSameDepartment;
      }
    }

    if (!isAllowed) {
      return res.status(403).json({ error: "Access Denied: You do not have permission to update this entry." });
    }

    // 4. Process image if base64 string is provided
    let finalImageUrl = image_url || existingEntry.image_url || null;
    if (image_base64 && typeof image_base64 === 'string' && image_base64.length > 100) {
      try {
        const targetUser = userName || existingEntry.user_name;
        const empQuery = `SELECT employee_id FROM users WHERE user_name = $1 LIMIT 1`;
        const empRes = await client.query(empQuery, [targetUser]);
        const targetEmpId = empRes.rows[0]?.employee_id || targetUser;

        finalImageUrl = await uploadDocumentImage(image_base64, `working_date_${targetEmpId}.png`);
      } catch (imgErr) {
        console.error("❌ Image Update Error during edit:", imgErr.message);
      }
    }

    // 5. Update Record
    // Reconstruct timestamp
    const targetDate = selectedDate || existingEntry.work_datetime.toISOString().split('T')[0];
    const targetTime = time || existingEntry.work_datetime.toTimeString().split(' ')[0].substring(0, 5);
    const workTimestamp = `${targetDate} ${targetTime}`;

    let targetWorkerName = existingEntry.user_name;
    let empId = existingEntry.employee_id;
    let unit = existingEntry.unit;
    let division = existingEntry.division;
    let department = existingEntry.department;

    if (userName && userName !== existingEntry.user_name) {
      targetWorkerName = userName;
      const targetUserQuery = `SELECT employee_id, unit, division, department FROM users WHERE user_name = $1 LIMIT 1`;
      const targetUserRes = await client.query(targetUserQuery, [userName]);
      if (targetUserRes.rows.length > 0) {
        const targetUserObj = targetUserRes.rows[0];
        empId = targetUserObj.employee_id || 'NA';
        unit = targetUserObj.unit;
        division = targetUserObj.division;
        department = targetUserObj.department;
      } else {
        empId = 'NA';
        unit = 'N/A';
        division = 'N/A';
        department = 'N/A';
      }
    }

    const updateQuery = `
      UPDATE working_date_history 
      SET work_datetime = $1::timestamp,
          user_name = $2,
          employee_id = $3,
          work_details = $4,
          assign_by = $5,
          image_url = $6,
          unit = $7,
          division = $8,
          department = $9,
          status = $10,
          duration = $11
      WHERE id = $12
      RETURNING *
    `;

    const updateValues = [
      workTimestamp,
      targetWorkerName,
      empId,
      workDetail || existingEntry.work_details,
      assignBy || existingEntry.assign_by,
      finalImageUrl,
      unit,
      division,
      department,
      status !== undefined ? status : existingEntry.status,
      duration !== undefined ? duration : existingEntry.duration,
      id
    ];

    const { rows } = await client.query(updateQuery, updateValues);
    res.json({ message: "Work details updated successfully", data: rows[0] });

  } catch (err) {
    console.error("❌ Update Working Date Error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  } finally {
    client.release();
  }
};

/**
 * Delete working date entry
 */
export const deleteWorkingDate = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { username } = req.user; // Logged-in user

    // 1. Fetch existing entry
    const checkQuery = `SELECT * FROM working_date_history WHERE id = $1`;
    const checkRes = await client.query(checkQuery, [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: "Entry not found" });
    }
    const existingEntry = checkRes.rows[0];

    // 2. Fetch logged-in user role & jurisdiction
    const userProfileQuery = `SELECT role, unit, division, department FROM users WHERE user_name = $1`;
    const userProfileRes = await client.query(userProfileQuery, [username]);
    if (userProfileRes.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const loggedInUser = userProfileRes.rows[0];
    const upperRole = (loggedInUser.role || "").toUpperCase();

    // 3. Permission Check
    let isAllowed = false;
    if (upperRole === "SUPER_ADMIN") {
      isAllowed = true;
    } else if (existingEntry.user_name.toLowerCase() === username.toLowerCase()) {
      isAllowed = true;
    } else if (upperRole === "ADMIN" || upperRole === "DIV_ADMIN") {
      const isSameUnit = existingEntry.unit?.toLowerCase() === loggedInUser.unit?.toLowerCase();
      const isSameDivision = existingEntry.division?.toLowerCase() === loggedInUser.division?.toLowerCase();
      const isSameDepartment = existingEntry.department?.toLowerCase() === loggedInUser.department?.toLowerCase();

      if (upperRole === "DIV_ADMIN") {
        isAllowed = isSameDivision;
      } else if (upperRole === "ADMIN") {
        isAllowed = isSameDivision && isSameDepartment;
      }
    }

    if (!isAllowed) {
      return res.status(403).json({ error: "Access Denied: You do not have permission to delete this entry." });
    }

    // 4. Delete Record
    const deleteQuery = `DELETE FROM working_date_history WHERE id = $1 RETURNING *`;
    const { rows } = await client.query(deleteQuery, [id]);
    res.json({ message: "Work entry deleted successfully", data: rows[0] });

  } catch (err) {
    console.error("❌ Delete Working Date Error:", err);
    res.status(500).json({ error: "Internal Server Error", details: err.message });
  } finally {
    client.release();
  }
};
