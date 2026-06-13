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
      completedCondition = "t.status = 'yes'";
    } else {
      completedCondition = "LOWER(t.status) = 'yes'";
    }

    const dateCol = table === "checklist" ? "task_start_date" : "planned_date";

    const params = [];
    let paramCount = 1;

    const userRole = (role || "").toUpperCase();
    const joinType = (userRole === "SUPER_ADMIN" || !userRole) ? "LEFT JOIN" : "JOIN";

    let fromTable = table;
    if (table === "checklist") {
      fromTable = `(
        SELECT 
          name, 
          department, 
          division, 
          submission_date, 
          status, 
          task_start_date,
          given_by,
          task_description,
          frequency,
          created_at,
          delay
        FROM checklist
        UNION ALL
        SELECT 
          user_name AS name, 
          department, 
          division, 
          work_datetime AS submission_date, 
          'yes'::public.enable_reminder AS status, 
          work_datetime AS task_start_date,
          assign_by AS given_by,
          work_details AS task_description,
          'DAILY' AS frequency,
          created_at::timestamp,
          interval '0' AS delay
        FROM working_date_history
        WHERE LOWER(status) = 'completed'
      )`;
    }

    let query = `
      SELECT 
        t.name, 
        COALESCE(u.department, t.department, 'N/A') AS department, 
        COALESCE(u.division, t.division, 'N/A') AS division, 
        u.employee_id, 
        u.designation,
        COUNT(t.*) AS total_tasks,
        SUM(
           CASE 
             WHEN t.submission_date IS NOT NULL 
               OR (${completedCondition})
             THEN 1 
             ELSE 0 
           END
        ) AS completed_tasks,
        SUM(
           CASE 
             WHEN t.submission_date IS NULL AND COALESCE(${completedCondition}, false) = false AND t.${dateCol}::date < CURRENT_DATE
             THEN 1 
             ELSE 0 
           END
        ) AS overdue_tasks,
        SUM(
          CASE 
             WHEN t.submission_date IS NOT NULL AND t.submission_date <= t.${dateCol}
             THEN 1 
             WHEN t.submission_date IS NULL AND ${completedCondition} AND t.${dateCol} <= NOW()
             THEN 1
             ELSE 0 
          END
        ) AS done_on_time,
        AVG(
          CASE 
             WHEN t.submission_date IS NOT NULL AND t.submission_date > t.${dateCol}
             THEN EXTRACT(EPOCH FROM (t.submission_date - t.${dateCol})) / 86400.0
             ELSE 0
          END
        ) AS avg_delay_days
      FROM ${fromTable} t
      ${joinType} users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
      WHERE t.name IS NOT NULL
      AND t.name != ''
      AND t.${dateCol} IS NOT NULL
      AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
    `;

    if (userRole === "DIV_ADMIN" && unit && division) {
      query += ` AND LOWER(u.unit) = LOWER($${paramCount}) AND LOWER(u.division) = LOWER($${paramCount + 1})`;
      params.push(unit, division);
      paramCount += 2;
    } else if (userRole === "ADMIN" && unit && division && department) {
      query += ` AND LOWER(u.unit) = LOWER($${paramCount}) AND LOWER(u.division) = LOWER($${paramCount + 1}) AND LOWER(u.department) = LOWER($${paramCount + 2})`;
      params.push(unit, division, department);
      paramCount += 3;
    } else if (userRole === "USER" && username) {
      query += ` AND LOWER(t.name) = LOWER($${paramCount})`;
      params.push(username);
      paramCount++;
      if (division) {
        query += ` AND LOWER(t.division) = LOWER($${paramCount})`;
        params.push(division);
        paramCount++;
      }
      if (department) {
        query += ` AND LOWER(t.department) = LOWER($${paramCount})`;
        params.push(department);
        paramCount++;
      }
    }

    // Add search filter if provided
    if (search) {
      query += ` AND t.name ILIKE $${paramCount}`;
      params.push(`%${search}%`);
      paramCount++;
    }

    // Apply user-selected dropdown filters (division, department, unit)
    if (selectedDivision && selectedDivision !== 'all') {
      query += ` AND LOWER(u.division) = LOWER($${paramCount})`;
      params.push(selectedDivision);
      paramCount++;
    }
    if (selectedDepartment && selectedDepartment !== 'all') {
      query += ` AND LOWER(u.department) = LOWER($${paramCount})`;
      params.push(selectedDepartment);
      paramCount++;
    }
    if (selectedUnit && selectedUnit !== 'all') {
      query += ` AND LOWER(u.unit) = LOWER($${paramCount})`;
      params.push(selectedUnit);
      paramCount++;
    }

    // Add date filter - Hierarchy:
    // 1. Explicit queryStartDate & queryEndDate (from Export Modal/Header)
    // 2. Or monthYear (from Month Dropdown)
    // 3. Optional tillDate cap (independent or fallback)

    if (queryStartDate && queryEndDate) {
      query += ` AND t.${dateCol} >= $${paramCount} AND t.${dateCol} <= $${paramCount + 1}`;
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

      query += ` AND t.${dateCol} >= $${paramCount} AND t.${dateCol} <= $${paramCount + 1}`;
      params.push(startDate, `${calculatedEndDate} 23:59:59`);
      paramCount += 2;
    } else if (tillDate) {
      query += ` AND t.${dateCol} <= $${paramCount}`;
      params.push(`${tillDate} 23:59:59`);
      paramCount++;
    } else {
      query += ` AND t.${dateCol} <= NOW()`;
    }

    if (staffFilter !== "all") {
      query += ` AND LOWER(t.name) = LOWER($${paramCount})`;
      params.push(staffFilter);
      paramCount++;
    }

    query += ` GROUP BY t.name, u.department, u.division, u.employee_id, u.designation, t.department, t.division, u.unit`;

    const staffResult = await pool.query(query, params);

    if (staffResult.rows.length === 0) {
      return res.json([]);
    }

    const finalData = staffResult.rows.map(row => {
      const staffName = row.name;
      const total = Number(row.total_tasks) || 0;
      const completed = Number(row.completed_tasks) || 0;
      const overdue = Number(row.overdue_tasks) || 0;
      const doneOnTime = Number(row.done_on_time) || 0;
      const avgDelayDays = Number(row.avg_delay_days) || 0;
      const pending = total - completed - overdue;

      let onTimeScore = 0;
      if (avgDelayDays > 0) {
        onTimeScore = -Math.min(100, Math.round(avgDelayDays * 100));
      } else if (completed > 0 && doneOnTime === completed) {
        onTimeScore = 100;
      }

      return {
        id: staffName.toLowerCase().replace(/\s+/g, "-"),
        name: staffName,
        department: row.department || "N/A",
        division: row.division || "N/A",
        employee_id: row.employee_id || "—",
        designation: row.designation || "—",
        email: `${staffName.toLowerCase().replace(/\s+/g, ".")}@example.com`,
        totalTasks: total,
        completedTasks: completed,
        pendingTasks: pending,
        overdueTasks: overdue,
        doneOnTime: doneOnTime,
        onTimeScore: onTimeScore
      };
    });

    const getOnTimeScorePct = (staff) => {
      return staff.completedTasks > 0 ? (staff.doneOnTime / staff.completedTasks) * 100 : 0;
    };

    // Sort globally by the new ranking criteria:
    // 1. completedTasks >= 300 vs < 300
    // 2. If completedTasks >= 300, sort by onTimePct descending, then completedTasks descending
    // 3. If completedTasks < 300, sort by completedTasks descending, then onTimePct descending
    finalData.sort((a, b) => {
      const aQualified = a.completedTasks >= 300;
      const bQualified = b.completedTasks >= 300;

      if (aQualified && !bQualified) return -1;
      if (!aQualified && bQualified) return 1;

      if (aQualified && bQualified) {
        const aPct = getOnTimeScorePct(a);
        const bPct = getOnTimeScorePct(b);
        if (bPct !== aPct) {
          return bPct - aPct;
        }
        return b.completedTasks - a.completedTasks;
      }

      // Both < 300 tasks: sort by completedTasks descending
      if (b.completedTasks !== a.completedTasks) {
        return b.completedTasks - a.completedTasks;
      }
      return getOnTimeScorePct(b) - getOnTimeScorePct(a);
    });

    const paginatedData = finalData.slice(offset, offset + Number(limit));
    return res.json(paginatedData);

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
      endDate: queryEndDate = "",
      targetDivision = "",
      targetDepartment = ""
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

    let fromTable = table;
    if (table === "checklist") {
      fromTable = `(
        SELECT 
          name, 
          department, 
          division, 
          submission_date, 
          status, 
          task_start_date,
          given_by,
          task_description,
          frequency,
          created_at,
          delay,
          false AS is_ledger
        FROM checklist
        UNION ALL
        SELECT 
          user_name AS name, 
          department, 
          division, 
          work_datetime AS submission_date, 
          'yes'::public.enable_reminder AS status, 
          work_datetime AS task_start_date,
          assign_by AS given_by,
          work_details AS task_description,
          'DAILY' AS frequency,
          created_at::timestamp,
          interval '0' AS delay,
          true AS is_ledger
        FROM working_date_history
        WHERE LOWER(status) = 'completed'
      )`;
    }

    const isLedgerCol = table === 'checklist' ? 't.is_ledger' : 'false AS is_ledger';

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
        CASE WHEN t.submission_date IS NOT NULL THEN to_char(t.submission_date::timestamp, 'YYYY-MM-DD') ELSE '—' END as submission_date,
        ${isLedgerCol}
      FROM ${fromTable} t
      LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
      WHERE TRIM(LOWER(t.name)) = TRIM(LOWER($1))
      AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
    `;

    const params = [staffName];
    let paramCount = 2;

    if (targetDivision) {
      query += ` AND LOWER(t.division) = LOWER($${paramCount})`;
      params.push(targetDivision);
      paramCount++;
    }
    if (targetDepartment) {
      query += ` AND LOWER(t.department) = LOWER($${paramCount})`;
      params.push(targetDepartment);
      paramCount++;
    }

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
    } else if (userRole === "USER" && username) {
      if (division) {
        query += ` AND LOWER(t.division) = LOWER($${paramCount})`;
        params.push(division);
        paramCount++;
      }
      if (department) {
        query += ` AND LOWER(t.department) = LOWER($${paramCount})`;
        params.push(department);
        paramCount++;
      }
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

    let fromTable = table;
    if (table === "checklist") {
      fromTable = `(
        SELECT 
          name, 
          department, 
          division, 
          submission_date, 
          status, 
          task_start_date,
          given_by,
          task_description,
          frequency,
          created_at,
          delay
        FROM checklist
        UNION ALL
        SELECT 
          user_name AS name, 
          department, 
          division, 
          work_datetime AS submission_date, 
          'yes'::public.enable_reminder AS status, 
          work_datetime AS task_start_date,
          assign_by AS given_by,
          work_details AS task_description,
          'DAILY' AS frequency,
          created_at::timestamp,
          interval '0' AS delay
        FROM working_date_history
        WHERE LOWER(status) = 'completed'
      )`;
    }

    const paramsCount = [];
    let pc = 1;

    let query = "";
    const userRole = (role || "").toUpperCase();

    if (userRole === "SUPER_ADMIN" || !userRole) {
      query = `
        SELECT DISTINCT t.name 
        FROM ${fromTable} t
        LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
        WHERE t.name IS NOT NULL 
        AND t.name != ''
        AND t.${dateCol} IS NOT NULL
        AND (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
      `;
    } else {
      query = `
        SELECT DISTINCT t.name 
        FROM ${fromTable} t
        JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
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
        if (division) {
          query += ` AND LOWER(t.division) = LOWER($${pc})`;
          paramsCount.push(division);
          pc++;
        }
        if (department) {
          query += ` AND LOWER(t.department) = LOWER($${pc})`;
          paramsCount.push(department);
          pc++;
        }
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
