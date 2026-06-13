import pool from "../config/db.js";
import { uploadToS3 } from "../middleware/s3Upload.js";
import { sendUrgentTaskEmail } from "../services/emailService.js";
import whatsappService from "../services/whatsappService.js";

// -----------------------------------------
// 1️⃣ GET PENDING MAINTENANCE TASKS
// -----------------------------------------
export const getPendingMaintenanceTasks = async (req, res) => {
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
        const unitFilter = req.query.unitFilter || "all";
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;

        const limit = 50;
        const offset = (page - 1) * limit;
        const queryParams = [limit, offset];

        // Base filter for pending tasks
        let where = `t.submission_date IS NULL AND DATE(t.task_start_date) <= CASE 
            WHEN LOWER(t.frequency) = 'daily' THEN CURRENT_DATE + INTERVAL '1 day'
            WHEN LOWER(t.frequency) = 'tertiary' THEN CURRENT_DATE + INTERVAL '2 days'
            WHEN LOWER(t.frequency) = 'weekly' THEN CURRENT_DATE + INTERVAL '3 days'
            WHEN LOWER(t.frequency) = 'fortnightly' THEN CURRENT_DATE + INTERVAL '4 days'
            WHEN LOWER(t.frequency) = 'monthly' THEN CURRENT_DATE + INTERVAL '15 days'
            WHEN LOWER(t.frequency) IN ('quarterly', 'quaterly') THEN CURRENT_DATE + INTERVAL '1 month'
            WHEN LOWER(t.frequency) IN ('half-yearly', 'half yearly') THEN CURRENT_DATE + INTERVAL '3 months'
            WHEN LOWER(t.frequency) = 'yearly' THEN CURRENT_DATE + INTERVAL '10 months'
            WHEN LOWER(t.frequency) LIKE '%end-of%week%' THEN CURRENT_DATE + INTERVAL '7 days'
            ELSE CURRENT_DATE + INTERVAL '1 day'
        END`;



        // ⭐ Status Filter (Today, Overdue, Upcoming, Leave, Day off)
        if (status === "today") {
            where += ` AND DATE(t.task_start_date) = CURRENT_DATE AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive')) `;
        } else if (status === "overdue") {
            where += ` AND DATE(t.task_start_date) < CURRENT_DATE AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive')) `;
        } else if (status === "upcoming") {
            where += ` AND DATE(t.task_start_date) > CURRENT_DATE AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive')) `;
        } else if (status === "leave") {
            where += ` AND LOWER(t.status::text) = 'leave' `;
        } else if (status === "inactive") {
            where += ` AND LOWER(t.status::text) = 'inactive' `;
        } else if (status === "activation_pending") {
            where += ` AND LOWER(t.status::text) = 'activation_pending' `;
        } else {
            // Default 'all' view: exclude leave and inactive tasks
            where += ` AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive')) `;
        }

        // ⭐ Frequency Filter
        if (frequency !== "all") {
            where += ` AND LOWER(t.frequency) = LOWER($${queryParams.length + 1}) `;
            queryParams.push(frequency);
        }

        // ⭐ Name Filter
        if (nameFilter !== "all") {
            where += ` AND LOWER(t.name) = LOWER($${queryParams.length + 1}) `;
            queryParams.push(nameFilter);
        }

        // ⭐ Division Filter
        if (divisionFilter !== "all" && divisionFilter !== "undefined") {
            where += ` AND LOWER(t.division) = LOWER($${queryParams.length + 1}) `;
            queryParams.push(divisionFilter);
        }

        // ⭐ Department Filter
        if (departmentFilter !== "all" && departmentFilter !== "undefined") {
            where += ` AND LOWER(t.department) = LOWER($${queryParams.length + 1}) `;
            queryParams.push(departmentFilter);
        }

        // ⭐ Unit Filter
        if (unitFilter !== "all" && unitFilter !== "undefined") {
            where += ` AND LOWER(t.unit) = LOWER($${queryParams.length + 1}) `;
            queryParams.push(unitFilter);
        }

        // ⭐ Date Range Filters
        if (startDate) {
            where += ` AND DATE(t.task_start_date) >= $${queryParams.length + 1} `;
            queryParams.push(startDate);
        }
        if (endDate) {
            where += ` AND DATE(t.task_start_date) <= $${queryParams.length + 1} `;
            queryParams.push(endDate);
        }

        const requesterUnit = req.query.unit;
        const requesterDivision = req.query.division;
        const upRole = (role || "").toUpperCase();

        if (upRole === "SUPER_ADMIN") {
            // No additional filter
        }
        else if (upRole === "DIV_ADMIN") {
            if (requesterDivision) {
                where += ` AND LOWER(t.division) = LOWER('${requesterDivision.replace(/'/g, "''")}') `;
            }
        }
        else if (upRole === "ADMIN") {
            if (requesterDivision && department) {
                const deptEscaped = department.replace(/'/g, "''");
                where += ` AND LOWER(t.division) = LOWER('${requesterDivision.replace(/'/g, "''")}') AND LOWER(t.department) = LOWER('${deptEscaped}') `;
            } else if (department) {
                const deptEscaped = department.replace(/'/g, "''");
                where += ` AND LOWER(t.department) = LOWER('${deptEscaped}') `;
            }
        }
        else if (username) {
            where += ` AND LOWER(t.name) = LOWER($${queryParams.length + 1}) `;
            queryParams.push(username);

            if (requesterDivision) {
                where += ` AND LOWER(t.division) = LOWER($${queryParams.length + 1}) `;
                queryParams.push(requesterDivision);
            }
            if (department) {
                where += ` AND LOWER(t.department) = LOWER($${queryParams.length + 1}) `;
                queryParams.push(department);
            }
        }

        if (search.trim()) {
            const searchParamIndex = queryParams.length + 1;
            where += ` AND (
                LOWER(t.name) LIKE $${searchParamIndex} OR
                LOWER(t.task_description) LIKE $${searchParamIndex} OR
                LOWER(t.department) LIKE $${searchParamIndex} OR
                LOWER(t.given_by) LIKE $${searchParamIndex} OR
                LOWER(t.unit) LIKE $${searchParamIndex} OR
                LOWER(t.division) LIKE $${searchParamIndex} OR
                LOWER(t.frequency) LIKE $${searchParamIndex} OR
                LOWER(COALESCE(t.remarks, '')) LIKE $${searchParamIndex} OR
                LOWER(COALESCE(t.admin_remark, '')) LIKE $${searchParamIndex} OR
                LOWER(COALESCE(t.status::text, '')) LIKE $${searchParamIndex} OR
                LOWER(COALESCE(mp.machine_name, t.machine_name)) LIKE $${searchParamIndex} OR
                LOWER(COALESCE(array_to_string(t.part_name, ', '), array_to_string(mp.part_name, ', '))) LIKE $${searchParamIndex} OR
                LOWER(COALESCE(mp.machine_area, t.part_area)) LIKE $${searchParamIndex} OR
                CAST(t.id AS TEXT) LIKE $${searchParamIndex}
            ) `;
            queryParams.push(`%${search.toLowerCase()}%`);
        }

        const query = `
      SELECT 
        t.id as task_id,
        t.department,
        t.unit,
        t.division,
        t.given_by,
        t.name,
        t.task_description,
        TO_CHAR(t.task_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') as task_start_date,
        t.frequency,
        t.enable_reminders,
        t.require_attachment,
        t.submission_date::text as submission_date,
        t.delay,
        t.status,
        TO_CHAR(t.planned_date, 'HH24:MI') as time,
        t.remarks as remark,
        t.uploaded_image_url as image,
        t.admin_done,
        t.admin_remark,
        COALESCE(mp.machine_name, t.machine_name) as machine_name,
        COALESCE(array_to_string(t.part_name, ', '), array_to_string(mp.part_name, ', ')) as part_name,
        COALESCE(mp.machine_area, t.part_area) as part_area,
        t.duration,
        t.planned_date::text as planned_date,
        t.created_at::text as created_at,
        t.machine_part_id,
        t.machine_department,
        t.machine_division,
        t.submitted_by,
        COUNT(*) OVER() AS total_count
      FROM maintenance_tasks t
      LEFT JOIN machine_parts mp ON t.machine_part_id = mp.id
      WHERE ${where}
      ORDER BY 
        CASE 
          WHEN DATE(t.task_start_date) < CURRENT_DATE THEN 0
          WHEN DATE(t.task_start_date) = CURRENT_DATE THEN 1
          ELSE 2 
        END,
        t.task_start_date ASC,
        t.id ASC
      LIMIT $1 OFFSET $2
    `;

        const { rows } = await pool.query(query, queryParams);

        const totalCount = rows.length > 0 ? rows[0].total_count : 0;

        // Global stats calculation for Pending (today) and Overdue (past)
        const statsQuery = `
            SELECT 
                COUNT(CASE WHEN DATE(t.task_start_date) = CURRENT_DATE THEN 1 END)::int AS today_count,
                COUNT(CASE WHEN DATE(t.task_start_date) < CURRENT_DATE THEN 1 END)::int AS overdue_count
            FROM maintenance_tasks t
            LEFT JOIN machine_parts mp ON t.machine_part_id = mp.id
            WHERE ($1::int IS NOT NULL OR $2::int IS NOT NULL OR 1=1) AND ${where}
        `;
        const statsRes = await pool.query(statsQuery, queryParams);
        const todayCount = statsRes.rows[0]?.today_count || 0;
        const overdueCount = statsRes.rows[0]?.overdue_count || 0;

        res.json({
            data: rows,
            page,
            totalCount,
            todayCount,
            overdueCount
        });
    } catch (error) {
        console.error("❌ Error fetching pending maintenance tasks:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// -----------------------------------------
// 2️⃣ GET HISTORY MAINTENANCE TASKS
// -----------------------------------------
export const getMaintenanceHistory = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const username = req.query.username;
        const role = req.query.role;
        const department = req.query.department;
        const search = req.query.search;
        const startDate = req.query.startDate;
        const endDate = req.query.endDate;
        const approvalStatus = req.query.approvalStatus || 'all';

        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;
        const requesterUnit = req.query.unit;
        const requesterDivision = req.query.division;
        const divisionFilter = req.query.divisionFilter;
        const departmentFilter = req.query.departmentFilter;
        const nameFilter = req.query.nameFilter;
        const unitFilter = req.query.unitFilter;

        const whereConditions = [`t.submission_date IS NOT NULL`];
        const countWhereConditions = [`t.submission_date IS NOT NULL`];
        const params = [limit, offset];
        const countParams = [];
        let paramIndex = 3;
        let countParamIndex = 1;

        const addFilter = (condition, value) => {
            whereConditions.push(condition.replace(/\?/g, () => `$${paramIndex++}`));
            countWhereConditions.push(condition.replace(/\?/g, () => `$${countParamIndex++}`));
            params.push(value);
            countParams.push(value);
        };

        if (startDate) {
            addFilter(`t.submission_date >= ?`, startDate);
        }
        if (endDate) {
            addFilter(`t.submission_date <= ?`, `${endDate} 23:59:59`);
        }

        const upRole = (role || "").toUpperCase();
        if (upRole === "SUPER_ADMIN") {
            // No additional filter
        } else if (upRole === "DIV_ADMIN") {
            if (requesterDivision) {
                addFilter(`LOWER(t.division) = LOWER(?)`, requesterDivision);
            }
        } else if (upRole === "ADMIN") {
            if (requesterDivision && (department || req.query.departmentFilter)) {
                addFilter(`LOWER(t.division) = LOWER(?)`, requesterDivision);
                addFilter(`LOWER(t.department) = LOWER(?)`, department || req.query.departmentFilter);
            } else if (department) {
                addFilter(`LOWER(t.department) = LOWER(?)`, department);
            }
        } else if (username) {
            addFilter(`LOWER(t.name) = LOWER(?)`, username);

            if (requesterDivision) {
                addFilter(`LOWER(t.division) = LOWER(?)`, requesterDivision);
            }
            if (department) {
                addFilter(`LOWER(t.department) = LOWER(?)`, department);
            }
        }

        // ⭐ UI Filters
        if (divisionFilter && divisionFilter !== 'all') {
            addFilter(`LOWER(t.division) = LOWER(?)`, divisionFilter);
        }
        if (departmentFilter && departmentFilter !== 'all') {
            addFilter(`LOWER(t.department) = LOWER(?)`, departmentFilter);
        }
        if (nameFilter && nameFilter !== 'all') {
            addFilter(`LOWER(t.name) = LOWER(?)`, nameFilter);
        }

        if (unitFilter && unitFilter !== 'all') {
            addFilter(`LOWER(t.unit) = LOWER(?)`, unitFilter);
        }

        if (search) {
            const searchVal = `%${search.toLowerCase()}%`;
            const searchCondition = `(
                LOWER(t.name) LIKE ? OR 
                LOWER(t.task_description) LIKE ? OR 
                LOWER(t.department) LIKE ? OR 
                LOWER(t.given_by) LIKE ? OR
                LOWER(t.unit) LIKE ? OR 
                LOWER(t.division) LIKE ? OR
                LOWER(t.frequency) LIKE ? OR
                LOWER(COALESCE(t.remarks, '')) LIKE ? OR
                LOWER(COALESCE(t.admin_remark, '')) LIKE ? OR
                LOWER(COALESCE(t.status::text, '')) LIKE ? OR
                LOWER(COALESCE(mp.machine_name, t.machine_name)) LIKE ? OR
                LOWER(COALESCE(array_to_string(t.part_name, ', '), array_to_string(mp.part_name, ', '))) LIKE ? OR
                LOWER(COALESCE(mp.machine_area, t.part_area)) LIKE ? OR
                CAST(t.id AS TEXT) LIKE ?
            )`;
            whereConditions.push(searchCondition.replace(/\?/g, () => `$${paramIndex++}`));
            countWhereConditions.push(searchCondition.replace(/\?/g, () => `$${countParamIndex++}`));
            // Push the same value for all 14 placeholders in the search condition
            for (let i = 0; i < 14; i++) {
                params.push(searchVal);
                countParams.push(searchVal);
            }
        }

        const whereClause = whereConditions.join(" AND ");

        // --- COUNT QUERY ---
        const countQueryText = `
            SELECT 
                COUNT(*)::INT as total_count,
                SUM(CASE WHEN t.admin_done = 'true' OR t.admin_done = 'Done' THEN 1 ELSE 0 END)::INT as approved_count
            FROM maintenance_tasks t
            LEFT JOIN machine_parts mp ON t.machine_part_id = mp.id
            WHERE ${countWhereConditions.join(" AND ")}
        `;
        const countRes = await pool.query(countQueryText, countParams);
        const totalCount = countRes.rows[0].total_count || 0;
        const approvedCount = countRes.rows[0].approved_count || 0;
        const pendingCount = totalCount - approvedCount;

        // --- DATA QUERY (Filtered for UI) ---
        let query = `
            SELECT 
                t.id as task_id, t.department, t.unit, t.division, t.given_by, t.name, t.task_description,
                TO_CHAR(t.task_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') as task_start_date,
                t.frequency, t.enable_reminders, t.require_attachment,
                t.submission_date::text as submission_date, t.delay, t.status,
                TO_CHAR(t.planned_date, 'HH24:MI') as time,
                t.remarks as remark, t.uploaded_image_url as image,
                t.admin_done, t.admin_remark,
                COALESCE(mp.machine_name, t.machine_name) as machine_name,
                COALESCE(array_to_string(t.part_name, ', '), array_to_string(mp.part_name, ', ')) as part_name,
                COALESCE(mp.machine_area, t.part_area) as part_area,
                t.duration, t.planned_date::text as planned_date, t.created_at::text as created_at,
                t.machine_part_id, t.machine_department, t.machine_division, t.submitted_by,
                t.approved_by,
                t.submission_date as raw_submission_date
            FROM maintenance_tasks t
            LEFT JOIN machine_parts mp ON t.machine_part_id = mp.id
            WHERE ${whereClause}
        `;

        if (approvalStatus === 'pending') {
            query += ` AND (t.admin_done IS NULL OR (t.admin_done != 'true' AND t.admin_done != 'Done')) `;
        } else if (approvalStatus === 'approved') {
            query += ` AND (t.admin_done = 'true' OR t.admin_done = 'Done') `;
        }

        query += ` ORDER BY t.submission_date DESC LIMIT $1 OFFSET $2 `;

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
        console.error("❌ Error fetching history:", error.message);
        res.status(500).json({ error: error.message });
    }
};

// -----------------------------------------
// 3️⃣ UPDATE MAINTENANCE TASKS (User Submit)
// -----------------------------------------
export const updateMaintenanceTasks = async (req, res) => {
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
                // 🔥🔥 IMAGE HANDLING
                // ---------------------------------
                let finalImageUrls = [];

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
                                        originalname: `maint_task_${item.taskId}_${Date.now()}_${Math.floor(Math.random() * 1000)}.${extension}`,
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
                                originalname: `maint_task_${item.taskId}_${Date.now()}.${extension}`,
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
          UPDATE maintenance_tasks
          SET 
            status = $1,
            remarks = $2,
            submission_date = date_trunc('second', NOW() AT TIME ZONE 'Asia/Kolkata'),
            uploaded_image_url = $3,
            submitted_by = $5
          WHERE id = $4
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
            res.json({ message: "Maintenance tasks updated successfully" });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ updateMaintenanceTasks Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// -----------------------------------------
// 4️⃣ ADMIN DONE UPDATE
// -----------------------------------------
export const adminDoneMaintenance = async (req, res) => {
    const client = await pool.connect();
    try {
        const items = req.body;

        if (!items || items.length === 0)
            return res.status(400).json({ error: "No items provided" });

        await client.query("BEGIN");

        const sql = `
      UPDATE maintenance_tasks
      SET admin_done = 'true',
          admin_remark = $2,
          approved_by = $3
      WHERE id = $1
    `;

        for (const item of items) {
            // item must have task_id, optional remarks, optional approvedBy
            await client.query(sql, [
                item.task_id,
                item.remarks || "",
                item.approvedBy || null
            ]);
        }

        await client.query("COMMIT");

        res.json({ message: "Admin updated successfully" });
    } catch (err) {
        await client.query("ROLLBACK");
        console.error("❌ adminDoneMaintenance Error:", err);
        res.status(500).json({ error: err.message });
    } finally {
        client.release();
    }
};

// -----------------------------------------
// 5️⃣ GET DISTINCT DROPDOWN OPTIONS
// -----------------------------------------
export const getMaintenanceDropdownOptions = async (req, res) => {
    try {
        const machineNamesQuery = `SELECT DISTINCT machine_name FROM maintenance_tasks WHERE machine_name IS NOT NULL AND machine_name != '' ORDER BY machine_name`;
        const partNamesQuery = `SELECT DISTINCT unnest_part FROM (SELECT UNNEST(part_name) as unnest_part FROM maintenance_tasks WHERE part_name IS NOT NULL) sub WHERE unnest_part IS NOT NULL AND unnest_part != '' ORDER BY unnest_part`;
        const partAreasQuery = `SELECT DISTINCT part_area FROM maintenance_tasks WHERE part_area IS NOT NULL AND part_area != '' ORDER BY part_area`;

        const [machineNames, partNames, partAreas] = await Promise.all([
            pool.query(machineNamesQuery),
            pool.query(partNamesQuery),
            pool.query(partAreasQuery),
        ]);

        res.json({
            machineNames: machineNames.rows.map(r => r.machine_name),
            partNames: partNames.rows.map(r => r.unnest_part),
            partAreas: partAreas.rows.map(r => r.part_area),
        });
    } catch (error) {
        console.error("❌ Error fetching dropdown options:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// -----------------------------------------
// 6️⃣ GET UNIQUE MAINTENANCE TASKS
// -----------------------------------------
export const getUniqueMaintenanceTasks = async (req, res) => {
    try {
        const page = parseInt(req.body.page) || 0;
        const pageSize = parseInt(req.body.pageSize) || 50;
        const nameFilter = req.body.nameFilter || "";
        const freqFilter = req.body.freqFilter || "";
        const userRole = req.body.userRole || "";
        const userDept = req.body.userDept || "";
        const userDiv = req.body.userDiv || "";
        const userName = req.body.userName || "";
        const search = req.body.search || "";

        const offset = page * pageSize;
        const params = [];
        let paramIndex = 1;

        let whereClause = "t.submission_date IS NULL AND DATE(t.task_start_date) <= CURRENT_DATE + INTERVAL '365 days'";

        if (nameFilter) {
            whereClause += ` AND LOWER(t.name) = LOWER($${paramIndex++})`;
            params.push(nameFilter);
        }

        if (freqFilter) {
            whereClause += ` AND t.frequency = $${paramIndex++}`;
            params.push(freqFilter);
        }

        // Role-based filtering
        const upRole = (userRole || "").toUpperCase();
        if (upRole === "ADMIN" && userDept && userDiv) {
            whereClause += ` AND LOWER(t.division) = LOWER($${paramIndex++}) AND LOWER(t.department) = LOWER($${paramIndex++})`;
            params.push(userDiv, userDept);
        } else if (upRole === "DIV_ADMIN" && userDiv) {
            whereClause += ` AND LOWER(t.division) = LOWER($${paramIndex++})`;
            params.push(userDiv);
        } else if (upRole === "USER" && userName) {
            whereClause += ` AND LOWER(t.name) = LOWER($${paramIndex++})`;
            params.push(userName);

            if (userDiv) {
                whereClause += ` AND LOWER(t.division) = LOWER($${paramIndex++})`;
                params.push(userDiv);
            }
            if (userDept) {
                whereClause += ` AND LOWER(t.department) = LOWER($${paramIndex++})`;
                params.push(userDept);
            }
        }

        // ⭐ Database-level search filter
        if (search && search.trim()) {
            const searchVal = `%${search.toLowerCase()}%`;
            whereClause += ` AND (
                LOWER(t.name) LIKE $${paramIndex} OR
                LOWER(t.task_description) LIKE $${paramIndex} OR
                LOWER(t.department) LIKE $${paramIndex} OR
                LOWER(t.given_by) LIKE $${paramIndex} OR
                LOWER(t.unit) LIKE $${paramIndex} OR
                LOWER(t.division) LIKE $${paramIndex} OR
                LOWER(t.frequency) LIKE $${paramIndex} OR
                LOWER(COALESCE(mp.machine_name, t.machine_name)) LIKE $${paramIndex} OR
                LOWER(COALESCE(array_to_string(t.part_name, ', '), array_to_string(mp.part_name, ', '))) LIKE $${paramIndex} OR
                LOWER(COALESCE(mp.machine_area, t.part_area)) LIKE $${paramIndex} OR
                CAST(t.id AS TEXT) LIKE $${paramIndex}
            )`;
            params.push(searchVal);
            paramIndex++;
        }

        const dataQuery = `
          SELECT DISTINCT ON (LOWER(t.name), LOWER(t.task_description))
            t.id as task_id,
            t.department,
            t.unit,
            t.division,
            t.given_by,
            t.name,
            t.task_description,
            TO_CHAR(t.task_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') as task_start_date,
            t.frequency,
            t.enable_reminders as enable_reminder,
            t.require_attachment,
            t.submission_date::text as submission_date,
            t.delay,
            t.status,
            TO_CHAR(t.planned_date, 'HH24:MI') as time,
            t.remarks as remark,
            t.uploaded_image_url as image,
            t.admin_done,
            COALESCE(mp.machine_name, t.machine_name) as machine_name,
            COALESCE(array_to_string(t.part_name, ', '), array_to_string(mp.part_name, ', ')) as part_name,
            COALESCE(mp.machine_area, t.part_area) as part_area,
            t.duration,
            TO_CHAR(t.planned_date, 'YYYY-MM-DD"T"HH24:MI:SS') as planned_date,
            t.created_at::text as created_at,
            t.machine_part_id,
            t.machine_department,
            t.machine_division
          FROM maintenance_tasks t
          LEFT JOIN machine_parts mp ON t.machine_part_id = mp.id
          WHERE ${whereClause}
          ORDER BY LOWER(t.name), LOWER(t.task_description), t.task_start_date ASC
          LIMIT $${paramIndex++}
          OFFSET $${paramIndex}
        `;

        const dataParams = [...params, pageSize, offset];

        const countQuery = `
          SELECT COUNT(*) FROM (
            SELECT DISTINCT ON (LOWER(t.name), LOWER(t.task_description))
              t.name, t.task_description
            FROM maintenance_tasks t
            LEFT JOIN machine_parts mp ON t.machine_part_id = mp.id
            WHERE ${whereClause}
          ) AS unique_tasks
        `;

        const [dataRes, countRes] = await Promise.all([
            pool.query(dataQuery, dataParams),
            pool.query(countQuery, params),
        ]);

        const total = parseInt(countRes.rows[0]?.count ?? 0, 10);
        res.json({ data: dataRes.rows, total });

    } catch (err) {
        console.error("❌ Error fetching unique maintenance tasks:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// -----------------------------------------
// 7️⃣ DELETE UNIQUE MAINTENANCE TASKS
// -----------------------------------------
export const deleteUniqueMaintenanceTasks = async (req, res) => {
    try {
        const { tasks } = req.body;
        if (!Array.isArray(tasks) || tasks.length === 0) {
            return res.status(400).json({ error: "No tasks provided" });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            for (const t of tasks) {
                await client.query(
                    `
                    DELETE FROM maintenance_tasks
                    WHERE name = $1
                    AND task_description = $2
                    AND submission_date IS NULL
                    `,
                    [t.name, t.task_description]
                );
            }
            await client.query("COMMIT");
            res.json({ message: "Tasks deleted successfully" });
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("❌ deleteUniqueMaintenanceTasks Error:", err);
        res.status(500).json({ error: err.message });
    }
};

// -----------------------------------------
// 8️⃣ UPDATE UNIQUE MAINTENANCE TASKS
// -----------------------------------------
export const updateUniqueMaintenanceTask = async (req, res) => {
    try {
        const { updatedTask, originalTask } = req.body;

        if (!updatedTask || !originalTask) {
            return res.status(400).json({ error: "Missing task data" });
        }

        // Convert part_name to array if it's a comma-separated string (column is TEXT[])
        const partNameArray = typeof updatedTask.part_name === 'string'
            ? updatedTask.part_name.split(',').map(p => p.trim()).filter(Boolean)
            : (Array.isArray(updatedTask.part_name) ? updatedTask.part_name : []);


        const query = `
          UPDATE maintenance_tasks
          SET
            name = $1,
            department = $2,
            unit = $3,
            division = $4,
            given_by = $5,
            task_description = $6,
            enable_reminders = $7,
            require_attachment = $8,
            machine_name = $9,
            part_name = $10,
            part_area = $11,
            duration = $12,
            status = $13,
            machine_department = $14,
            machine_division = $15
          WHERE name = $16
          AND task_description = $17
          AND submission_date IS NULL
          RETURNING *
        `;

        // Update all tasks matching the original name and description
        const values = [
            updatedTask.name,
            updatedTask.department,
            updatedTask.unit,
            updatedTask.division,
            updatedTask.given_by,
            updatedTask.task_description,
            updatedTask.enable_reminder,  // The frontend passes enable_reminder
            updatedTask.require_attachment,
            updatedTask.machine_name,     // specific to maintenance task edits
            partNameArray,
            updatedTask.part_area,
            updatedTask.duration,
            updatedTask.status || originalTask.status, // Fallback if status is empty string from "Select Status" option
            updatedTask.machine_department,
            updatedTask.machine_division,
            originalTask.name,
            originalTask.task_description
        ];

        const { rows } = await pool.query(query, values);

        if (rows.length === 0) {
            return res.status(404).json({ error: "No tasks found to update" });
        }

        // Return the first updated row to represent the unique group on the frontend
        res.json({
            ...rows[0],
            task_id: rows[0].id,
            enable_reminder: rows[0].enable_reminders
        });

    } catch (error) {
        console.error("❌ Error updating unique maintenance tasks:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};
// -----------------------------------------
// 12️⃣ GET UNIQUE MAINTENANCE TASK COUNT
// -----------------------------------------
export const getMaintenanceUniqueCount = async (req, res) => {
    try {
        const { userRole, userDept, userDiv, userName } = req.body;
        const upRole = (userRole || "").toUpperCase();

        const params = [];
        let paramIndex = 1;
        let whereClause = "submission_date IS NULL AND DATE(task_start_date) <= CURRENT_DATE + INTERVAL '365 days'";

        if (upRole === "ADMIN" && userDept && userDiv) {
            whereClause += ` AND LOWER(division) = LOWER($${paramIndex++}) AND LOWER(department) = LOWER($${paramIndex++})`;
            params.push(userDiv, userDept);
        } else if (upRole === "DIV_ADMIN" && userDiv) {
            whereClause += ` AND LOWER(division) = LOWER($${paramIndex++})`;
            params.push(userDiv);
        } else if (upRole === "USER" && userName) {
            whereClause += ` AND LOWER(name) = LOWER($${paramIndex++})`;
            params.push(userName);
        }

        const countQuery = `
          SELECT COUNT(*) FROM (
            SELECT DISTINCT ON (LOWER(name), LOWER(task_description))
              name, task_description
            FROM maintenance_tasks
            WHERE ${whereClause}
          ) AS unique_tasks
        `;

        const countRes = await pool.query(countQuery, params);
        const total = parseInt(countRes.rows[0]?.count ?? 0, 10);

        res.json({ total });

    } catch (error) {
        console.error("❌ Error fetching unique maintenance task count:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

// -----------------------------------------
// 13️⃣ SEND MAINTENANCE NOTIFICATION (Admin Only)
// -----------------------------------------
export const sendMaintenanceNotification = async (req, res) => {
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
                const waMessage = `🚨 *URGENT MAINTENANCE ALERT* 🚨\n\nHello ${doerName},\n\nThe following maintenance task requires your *immediate attention*:\n\n📌 Task ID: ${item.task_id || 'N/A'}\n📝 Task: ${item.task_description || 'N/A'}\n⏳ Planned Date: ${formatDate(item.task_start_date)}\n🧑‍💼 Given By: ${item.given_by || 'N/A'}\n\nClosure Link:\nhttps://checklist-frontend-nu.vercel.app\n\nPlease take immediate action.`;
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
        console.error("❌ sendMaintenanceNotification Error:", err);
        res.status(500).json({ error: err.message });
    }
};
// -----------------------------------------
// 14️⃣ BULK TOGGLE DAY OFF (INACTIVE) MAINTENANCE
// -----------------------------------------
export const bulkDeleteMaintenance = async (req, res) => {
    const client = await pool.connect();
    try {
        const { taskIds, role } = req.body;
        if (!Array.isArray(taskIds) || taskIds.length === 0) {
            return res.status(400).json({ error: "No task IDs provided" });
        }

        await client.query("BEGIN");
        // Logic: 
        // 1. If currently Inactive or Activation_Pending, move to Pending (active) if Admin, else move to Activation_Pending
        // 2. If currently anything else, move to Inactive
        const query = `
            UPDATE maintenance_tasks 
            SET status = CASE 
                WHEN status IN ('Inactive', 'Activation_Pending') THEN 
                    CASE WHEN $2 = ANY(ARRAY['SUPER_ADMIN', 'ADMIN', 'DIV_ADMIN']) THEN 'Pending' ELSE 'Activation_Pending' END
                ELSE 'Inactive' 
            END
            WHERE id = ANY($1)
        `;
        const { rowCount } = await client.query(query, [taskIds, (role || "").toUpperCase()]);
        await client.query("COMMIT");

        res.json({ message: `Successfully toggled ${rowCount} tasks for Day Off`, updatedCount: rowCount });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error in bulkDeleteMaintenance:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
};

export const approveActivationMaintenance = async (req, res) => {
    const { taskIds } = req.body;
    try {
        await pool.query("UPDATE maintenance_tasks SET status = 'Pending' WHERE id = ANY($1)", [taskIds]);
        res.json({ message: "Maintenance tasks activated successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// -----------------------------------------
// 15️⃣ BULK LEAVE MAINTENANCE
// -----------------------------------------
export const bulkLeaveMaintenance = async (req, res) => {
    const client = await pool.connect();
    try {
        const { taskIds } = req.body;
        if (!Array.isArray(taskIds) || taskIds.length === 0) {
            return res.status(400).json({ error: "No task IDs provided" });
        }

        await client.query("BEGIN");
        const query = `
            UPDATE maintenance_tasks 
            SET status = 'Leave'
            WHERE id = ANY($1)
        `;
        const { rowCount } = await client.query(query, [taskIds]);
        await client.query("COMMIT");

        res.json({ message: `Successfully marked ${rowCount} tasks as Leave`, updatedCount: rowCount });
    } catch (error) {
        await client.query("ROLLBACK");
        console.error("❌ Error in bulkLeaveMaintenance:", error);
        res.status(500).json({ error: "Internal Server Error" });
    } finally {
        client.release();
    }
};
