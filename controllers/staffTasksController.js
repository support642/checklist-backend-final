import pool from "../config/db.js";

const formatLocalYMD = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getStaffTasks = async (req, res) => {
  try {
    const {
      dashboardType = "checklist",
      staffFilter = "all",
      page = 1,
      limit = 50,
      monthYear = "",
      tillDate = "",
      role = "",
      username = "",
      unit = "",
      division = "",
      department = "",
      startDate: queryStartDate = "",
      endDate: queryEndDate = "",
      search = "",
      selectedDepartment = "",
      selectedDivision = "",
      selectedUnit = ""
    } = req.query;

    const table = dashboardType;
    const offset = (Number(page) - 1) * Number(limit);

    let completedCondition = "";

    if (table === "checklist") {
      completedCondition = "status = 'yes'";
    } else {
      completedCondition = "LOWER(status) = 'yes'";
    }

    const dateCol = table === "checklist" ? "task_start_date" : "planned_date";

    const params = [];
    let paramCount = 1;

    let staffQuery = "";
    const userRole = (role || "").toUpperCase();

    if (userRole === "SUPER_ADMIN" || !userRole) {
      staffQuery = `
        SELECT DISTINCT t.name, u.department, u.division, u.employee_id, u.designation
        FROM ${table} t
        LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name))
        WHERE t.name IS NOT NULL
        AND t.name != ''
        AND t.${dateCol} IS NOT NULL
        AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
        AND t.${dateCol} <= NOW()
      `;
    } else {
      staffQuery = `
        SELECT DISTINCT t.name, u.department, u.division, u.employee_id, u.designation
        FROM ${table} t
        JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name))
        WHERE t.name IS NOT NULL
        AND t.name != ''
        AND t.${dateCol} IS NOT NULL
        AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
        AND t.${dateCol} <= NOW()
      `;

      if (userRole === "DIV_ADMIN" && unit && division) {
        staffQuery += ` AND LOWER(u.unit) = LOWER($${paramCount}) AND LOWER(u.division) = LOWER($${paramCount + 1})`;
        params.push(unit, division);
        paramCount += 2;
      } else if (userRole === "ADMIN" && unit && division && department) {
        staffQuery += ` AND LOWER(u.unit) = LOWER($${paramCount}) AND LOWER(u.division) = LOWER($${paramCount + 1}) AND LOWER(u.department) = LOWER($${paramCount + 2})`;
        params.push(unit, division, department);
        paramCount += 3;
      } else if (userRole === "USER" && username) {
        staffQuery += ` AND LOWER(t.name) = LOWER($${paramCount})`;
        params.push(username);
        paramCount++;
      }
    }

    // Add search filter if provided
    if (search) {
      staffQuery += ` AND t.name ILIKE $${paramCount}`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Apply user-selected dropdown filters (division, department, unit)
    if (selectedDivision && selectedDivision !== 'all') {
      staffQuery += ` AND LOWER(u.division) = LOWER($${paramCount})`;
      params.push(selectedDivision);
      paramCount++;
    }
    if (selectedDepartment && selectedDepartment !== 'all') {
      staffQuery += ` AND LOWER(u.department) = LOWER($${paramCount})`;
      params.push(selectedDepartment);
      paramCount++;
    }
    if (selectedUnit && selectedUnit !== 'all') {
      staffQuery += ` AND LOWER(u.unit) = LOWER($${paramCount})`;
      params.push(selectedUnit);
      paramCount++;
    }

    // Add date filter - Hierarchy:
    // 1. Explicit queryStartDate & queryEndDate (from Export Modal/Header)
    // 2. Or monthYear (from Month Dropdown)
    // 3. Optional tillDate cap (independent or fallback)

    if (queryStartDate && queryEndDate) {
      staffQuery += ` AND t.${dateCol} >= $${paramCount} AND t.${dateCol} <= $${paramCount + 1}`;
      params.push(queryStartDate, `${queryEndDate} 23:59:59`);
      paramCount += 2;
    } else if (monthYear) {
      const [year, month] = monthYear.split('-').map(Number);
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);

      const startDate = formatLocalYMD(startOfMonth);
      let calculatedEndDate = formatLocalYMD(endOfMonth);

      // CAP by tillDate if provided and within/before the month
      if (tillDate) {
        const tillDateObj = new Date(tillDate);
        if (tillDateObj < endOfMonth) {
          calculatedEndDate = tillDate;
        }
      }

      staffQuery += ` AND t.${dateCol} >= $${paramCount} AND t.${dateCol} <= $${paramCount + 1}`;
      params.push(startDate, `${calculatedEndDate} 23:59:59`);
      paramCount += 2;
    } else if (tillDate) {
      staffQuery += ` AND t.${dateCol} <= $${paramCount}`;
      params.push(`${tillDate} 23:59:59`);
      paramCount++;
    } else {
      staffQuery += ` AND t.${dateCol} <= NOW()`;
    }

    if (staffFilter !== "all") {
      staffQuery += ` AND LOWER(t.name) = LOWER($${paramCount})`;
      params.push(staffFilter);
      paramCount++;
    }

    if (userRole === "SUPER_ADMIN") {
      staffQuery += ` ORDER BY u.division ASC, u.department ASC, t.name ASC`;
    } else {
      staffQuery += ` ORDER BY t.name ASC`;
    }

    // Server-side Pagination
    staffQuery += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(Number(limit), offset);
    paramCount += 2;

    const staffResult = await pool.query(staffQuery, params);
    const paginatedStaff = staffResult.rows.map(r => ({
      name: r.name || r.t_name,
      department: r.department || "N/A",
      division: r.division || "N/A",
      employee_id: r.employee_id || "—",
      designation: r.designation || "—"
    }));

    if (paginatedStaff.length === 0) {
      return res.json([]);
    }

    const finalData = [];

    for (let staffObj of paginatedStaff) {
      const staffName = staffObj.name;
      // Get task data with timing calculation
      let taskQuery = `
        SELECT 
          COUNT(*) AS total,
          SUM(
             CASE 
               WHEN submission_date IS NOT NULL 
                 OR (${completedCondition})
               THEN 1 
               ELSE 0 
             END
          ) AS completed,
          SUM(
             CASE 
               WHEN submission_date IS NULL AND COALESCE(${completedCondition}, false) = false AND ${dateCol}::date < CURRENT_DATE
               THEN 1 
               ELSE 0 
             END
          ) AS overdue,
          SUM(
            CASE 
               WHEN submission_date IS NOT NULL AND submission_date <= ${dateCol}
               THEN 1 
               WHEN submission_date IS NULL AND ${completedCondition} AND ${dateCol} <= NOW()
               THEN 1
               ELSE 0 
            END
          ) AS done_on_time,
          AVG(
            CASE 
               WHEN submission_date IS NOT NULL AND submission_date > ${dateCol}
               THEN EXTRACT(EPOCH FROM (submission_date - ${dateCol})) / 86400.0 -- Delay in days
               ELSE 0
            END
          ) AS avg_delay_days
        FROM ${table}
      `;
      const tp = [];
      let tc = 1;

      taskQuery += ` WHERE LOWER(name)=LOWER($${tc}) AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive'))`;
      tp.push(staffName);
      tc++;

      // Task data filter hierarchy
      if (queryStartDate && queryEndDate) {
        taskQuery += ` AND ${dateCol} >= $${tc} AND ${dateCol} <= $${tc + 1}`;
        tp.push(queryStartDate, `${queryEndDate} 23:59:59`);
        tc += 2;
      } else if (monthYear) {
        const [year, month] = monthYear.split('-').map(Number);
        const startOfMonth = new Date(year, month - 1, 1);
        const endOfMonth = new Date(year, month, 0);

        const startDate = formatLocalYMD(startOfMonth);
        let calculatedEndDate = formatLocalYMD(endOfMonth);

        // CAP by tillDate if provided
        if (tillDate) {
          const tillDateObj = new Date(tillDate);
          if (tillDateObj < endOfMonth) {
            calculatedEndDate = tillDate;
          }
        }

        taskQuery += ` AND ${dateCol} >= $${tc} AND ${dateCol} <= $${tc + 1}`;
        tp.push(startDate, `${calculatedEndDate} 23:59:59`);
        tc += 2;
      } else if (tillDate) {
        taskQuery += ` AND ${dateCol} <= $${tc}`;
        tp.push(`${tillDate} 23:59:59`);
        tc++;
      } else {
        taskQuery += ` AND ${dateCol} <= NOW()`;
      }

      taskQuery += ` AND ${dateCol} IS NOT NULL`;

      const taskResult = await pool.query(taskQuery, tp);

      const total = Number(taskResult.rows[0].total);
      const completed = Number(taskResult.rows[0].completed);
      const overdue = Number(taskResult.rows[0].overdue) || 0;
      const doneOnTime = Number(taskResult.rows[0].done_on_time) || 0;
      const avgDelayDays = Number(taskResult.rows[0].avg_delay_days) || 0;
      const pending = total - completed - overdue;

      // Calculate on-time score as negative percentage
      let onTimeScore = 0;
      if (avgDelayDays > 0) {
        onTimeScore = -Math.min(100, Math.round(avgDelayDays * 100));
      } else if (completed > 0 && doneOnTime === completed) {
        onTimeScore = 100;
      }

      finalData.push({
        id: staffName.toLowerCase().replace(/\s+/g, "-"),
        name: staffName,
        department: staffObj.department,
        division: staffObj.division,
        employee_id: staffObj.employee_id,
        designation: staffObj.designation,
        email: `${staffName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        totalTasks: total,
        completedTasks: completed,
        pendingTasks: pending,
        overdueTasks: overdue,
        doneOnTime: doneOnTime,
        onTimeScore: onTimeScore
      });
    }

    return res.json(finalData);

  } catch (err) {
    console.error("🔥 REAL ERROR →", err);
    res.status(500).json({ error: err.message });
  }
};

export const getStaffDetails = async (req, res) => {
  try {
    const {
      dashboardType = "checklist",
      staffName,
      monthYear = "",
      tillDate = "",
      role = "",
      username = "",
      unit = "",
      division = "",
      department = "",
      startDate: queryStartDate = "",
      endDate: queryEndDate = ""
    } = req.query;

    if (!staffName) {
      return res.status(400).json({ error: "staffName is required" });
    }

    const table = dashboardType === 'maintenance' ? 'maintenance_tasks' : dashboardType;
    const dateCol = (table === "checklist" || table === "maintenance_tasks") ? "task_start_date" : "planned_date";
    const userRole = (role || "").toUpperCase();

    let completionClause = "(LOWER(t.status) = 'yes' OR t.submission_date IS NOT NULL)";
    let onTimeClause = "false";

    if (table === 'maintenance_tasks') {
      completionClause = "(t.status = 'Done')";
      onTimeClause = "(t.status = 'Done')";
    } else if (table === 'checklist') {
      completionClause = "(t.status = 'yes')";
      onTimeClause = "(t.submission_date IS NOT NULL AND t.delay <= interval '0')";
    } else if (table === 'delegation') {
      onTimeClause = "(t.color_code_for = '1' OR t.color_code_for = 1)";
    }

    let query = `
      SELECT 
        t.status,
        t.given_by,
        t.task_description,
        u.division,
        u.department,
        t.name,
        ${(table === 'checklist' || table === 'maintenance_tasks') ? 't.frequency' : 'NULL as frequency'},
        ${completionClause} as is_completed,
        ${onTimeClause} as is_on_time,
        CASE WHEN t.${dateCol} IS NOT NULL THEN to_char(t.${dateCol}::timestamp, 'YYYY-MM-DD') ELSE '—' END as start_date,
        CASE WHEN t.created_at IS NOT NULL THEN to_char(t.created_at::timestamp, 'YYYY-MM-DD') ELSE '—' END as end_date,
        CASE WHEN t.submission_date IS NOT NULL THEN to_char(t.submission_date::timestamp, 'YYYY-MM-DD') ELSE '—' END as submission_date
      FROM ${table} t
      LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name))
      WHERE TRIM(LOWER(t.name)) = TRIM(LOWER($1))
      AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
    `;

    const params = [staffName];
    let paramCount = 2;

    // Staff Detail Detail Filter Hierarchy
    if (queryStartDate && queryEndDate) {
      query += ` AND t.${dateCol}::timestamp >= $${paramCount}::timestamp AND t.${dateCol}::timestamp <= $${paramCount + 1}::timestamp`;
      params.push(queryStartDate, `${queryEndDate} 23:59:59`);
      paramCount += 2;
    } else if (monthYear) {
      const [year, month] = monthYear.split('-').map(Number);
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);

      const startDate = formatLocalYMD(startOfMonth);
      let calculatedEndDate = formatLocalYMD(endOfMonth);

      // CAP by tillDate if provided
      if (tillDate) {
        const tillDateObj = new Date(tillDate);
        if (tillDateObj < endOfMonth) {
          calculatedEndDate = tillDate;
        }
      }

      query += ` AND t.${dateCol}::timestamp >= $${paramCount}::timestamp AND t.${dateCol}::timestamp <= $${paramCount + 1}::timestamp`;
      params.push(startDate, `${calculatedEndDate} 23:59:59`);
      paramCount += 2;
    } else if (tillDate) {
      query += ` AND t.${dateCol}::timestamp <= $${paramCount}::timestamp`;
      params.push(`${tillDate} 23:59:59`);
      paramCount++;
    } else {
      query += ` AND t.${dateCol}::timestamp <= NOW()`;
    }

    // Role-based restrictions (similar to getStaffTasks but focused on the selected user)
    if (userRole === "DIV_ADMIN" && unit && division) {
      query += ` AND LOWER(u.unit) = LOWER($${paramCount}) AND LOWER(u.division) = LOWER($${paramCount + 1})`;
      params.push(unit, division);
      paramCount += 2;
    } else if (userRole === "ADMIN" && unit && division && department) {
      query += ` AND LOWER(u.unit) = LOWER($${paramCount}) AND LOWER(u.division) = LOWER($${paramCount + 1}) AND LOWER(u.department) = LOWER($${paramCount + 2})`;
      params.push(unit, division, department);
      paramCount += 3;
    }

    // REMOVE redundant block or keep it for legacy? The above code already handles monthYear for details.
    // Actually, line 360-371 is a DUPLICATE block in the original file. I'll remove it or update it.

    query += ` ORDER BY t.${dateCol} DESC, t.submission_date DESC NULLS LAST`;

    const result = await pool.query(query, params);
    return res.json(result.rows);

  } catch (err) {
    console.error("Error in getStaffDetails:", err.message);
    res.status(500).json({ error: err.message });
  }
};



export const getStaffCount = async (req, res) => {
  try {
    const {
      dashboardType = "checklist",
      staffFilter = "all",
      role = "",
      username = "",
      unit = "",
      division = "",
      department = "",
      search = "",
      monthYear = "",
      tillDate = "",
      startDate: queryStartDate = "",
      endDate: queryEndDate = "",
      selectedDepartment = "",
      selectedDivision = "",
      selectedUnit = ""
    } = req.query;
    const table = dashboardType;
    const dateCol = table === "checklist" ? "task_start_date" : "planned_date";

    const paramsCount = [];
    let pc = 1;

    let query = "";
    const userRole = (role || "").toUpperCase();

    if (userRole === "SUPER_ADMIN" || !userRole) {
      query = `
        SELECT DISTINCT t.name 
        FROM ${table} t
        LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name))
        WHERE t.name IS NOT NULL 
        AND t.name != ''
        AND t.${dateCol} IS NOT NULL
        AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
      `;
    } else {
      query = `
        SELECT DISTINCT t.name 
        FROM ${table} t
        JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name))
        WHERE t.name IS NOT NULL 
        AND t.name != ''
        AND t.${dateCol} IS NOT NULL
        AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
      `;

      if (userRole === "DIV_ADMIN" && unit && division) {
        query += ` AND LOWER(u.unit) = LOWER($${pc}) AND LOWER(u.division) = LOWER($${pc + 1})`;
        paramsCount.push(unit, division);
        pc += 2;
      } else if (userRole === "ADMIN" && unit && division && department) {
        query += ` AND LOWER(u.unit) = LOWER($${pc}) AND LOWER(u.division) = LOWER($${pc + 1}) AND LOWER(u.department) = LOWER($${pc + 2})`;
        paramsCount.push(unit, division, department);
        pc += 3;
      } else if (userRole === "USER" && username) {
        query += ` AND LOWER(t.name) = LOWER($${pc})`;
        paramsCount.push(username);
        pc++;
      }
    }

    // Add search filter
    if (search) {
      query += ` AND t.name ILIKE $${pc}`;
      paramsCount.push(`%${search}%`);
      pc++;
    }

    // Add date filtering consistent with getStaffTasks
    if (queryStartDate && queryEndDate) {
      query += ` AND t.${dateCol} >= $${pc} AND t.${dateCol} <= $${pc + 1}`;
      paramsCount.push(queryStartDate, `${queryEndDate} 23:59:59`);
      pc += 2;
    } else if (monthYear) {
      const [year, month] = monthYear.split('-').map(Number);
      const startOfMonth = new Date(year, month - 1, 1);
      const endOfMonth = new Date(year, month, 0);

      const startDate = formatLocalYMD(startOfMonth);
      let calculatedEndDate = formatLocalYMD(endOfMonth);

      if (tillDate) {
        const tillDateObj = new Date(tillDate);
        if (tillDateObj < endOfMonth) {
          calculatedEndDate = tillDate;
        }
      }

      query += ` AND t.${dateCol} >= $${pc} AND t.${dateCol} <= $${pc + 1}`;
      paramsCount.push(startDate, `${calculatedEndDate} 23:59:59`);
      pc += 2;
    } else if (tillDate) {
      query += ` AND t.${dateCol} <= $${pc}`;
      paramsCount.push(`${tillDate} 23:59:59`);
      pc++;
    } else {
      query += ` AND t.${dateCol} <= NOW()`;
    }

    if (staffFilter !== "all") {
      query += ` AND LOWER(t.name) = LOWER($${pc})`;
      paramsCount.push(staffFilter);
      pc++;
    }

    // Apply user-selected dropdown filters
    if (selectedDivision && selectedDivision !== 'all') {
      query += ` AND LOWER(u.division) = LOWER($${pc})`;
      paramsCount.push(selectedDivision);
      pc++;
    }
    if (selectedDepartment && selectedDepartment !== 'all') {
      query += ` AND LOWER(u.department) = LOWER($${pc})`;
      paramsCount.push(selectedDepartment);
      pc++;
    }
    if (selectedUnit && selectedUnit !== 'all') {
      query += ` AND LOWER(u.unit) = LOWER($${pc})`;
      paramsCount.push(selectedUnit);
      pc++;
    }

    const result = await pool.query(query, paramsCount);
    const count = result.rows.length;

    return res.json(count);

  } catch (err) {
    console.error("Error in getStaffCount:", err);
    return res.status(500).json({ error: "Error fetching staff count" });
  }
};




export const getUsersCount = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT COUNT(*) FROM users
      WHERE user_name IS NOT NULL AND user_name != ''
    `);

    res.json(Number(result.rows[0].count));

  } catch (err) {
    console.error("Error in getUsersCount:", err);
    res.status(500).json({ error: "Error fetching total users count" });
  }
};
