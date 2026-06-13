import pool from "../config/db.js";

const formatLocalYMD = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const today = formatLocalYMD(new Date());

const logQueries = process.env.LOG_QUERIES === "true";
const log = (...args) => {
  if (logQueries) console.log(...args);
};

// Helper function to get current month range
const getCurrentMonthRange = () => {
  const currentDate = new Date();
  const firstDayOfMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const firstDayStr = formatLocalYMD(firstDayOfMonth);
  const currentDayStr = formatLocalYMD(currentDate);
  return { firstDayStr, currentDayStr };
};

const getMapping = (dashboardType) => {
  let table = dashboardType === 'maintenance' ? 'maintenance_tasks' : (dashboardType || 'checklist');
  let idCol = 'task_id';
  let remarkCol = 'remark';
  let adminDoneCol = 'admin_done';
  let adminDoneRemarksCol = 'admin_done_remarks';
  let imageCol = 'image';
  let dateCol = 'task_start_date';
  let colorCodeCol = 'NULL as color_code_for';
  let enableReminderCol = 'enable_reminder';

  if (dashboardType === 'maintenance') {
    idCol = 'id';
    remarkCol = 'remarks';
    adminDoneRemarksCol = 'admin_remark';
    imageCol = 'uploaded_image_url';
    enableReminderCol = 'enable_reminders';
  } else if (dashboardType === 'delegation') {
    remarkCol = 'remarks';
    adminDoneCol = 'NULL';
    adminDoneRemarksCol = 'adminremarks';
    dateCol = 'planned_date';
    colorCodeCol = 'color_code_for';
  }

  return { table, idCol, remarkCol, adminDoneCol, adminDoneRemarksCol, imageCol, dateCol, colorCodeCol, enableReminderCol };
};

export const getDashboardData = async (req, res) => {
  let finalQuery = "";
  try {
    const {
      dashboardType,
      staffFilter,
      page = 1,
      limit = 50,
      departmentFilter,
      unitFilter,
      divisionFilter,
      role,
      username,
      taskView = "recent",
      startDate,
      endDate
    } = req.query;

    const { firstDayStr, currentDayStr } = getCurrentMonthRange();
    const { table, idCol, remarkCol, adminDoneCol, adminDoneRemarksCol, imageCol, dateCol, colorCodeCol, enableReminderCol } = getMapping(dashboardType);
    const offset = (page - 1) * limit;

    let onTimeClause = "false";
    if (table === 'maintenance_tasks') {
      onTimeClause = "(status = 'Done')";
    } else if (table === 'checklist') {
      onTimeClause = "(submission_date IS NOT NULL AND delay <= interval '0')";
    } else if (table === 'delegation') {
      onTimeClause = "(color_code_for = '1' OR color_code_for = 1)";
    }

    let fromTable = table;
    if (table === "checklist") {
      fromTable = `(
        SELECT 
          task_id,
          name, 
          department, 
          division, 
          unit,
          submission_date::timestamp AS submission_date, 
          status::text AS status, 
          task_start_date::timestamp AS task_start_date,
          given_by,
          task_description,
          frequency,
          created_at::timestamp AS created_at,
          delay,
          require_attachment::text AS require_attachment,
          enable_reminder::text AS enable_reminder,
          admin_done::text AS admin_done,
          admin_done_remarks,
          image,
          remark,
          planned_date::timestamp AS planned_date,
          false AS is_ledger
        FROM checklist
        UNION ALL
        SELECT 
          id AS task_id,
          user_name AS name, 
          department, 
          division, 
          unit,
          work_datetime::timestamp AS submission_date, 
          'yes'::text AS status, 
          work_datetime::timestamp AS task_start_date,
          assign_by AS given_by,
          work_details AS task_description,
          'DAILY' AS frequency,
          created_at::timestamp,
          interval '0' AS delay,
          'no'::text AS require_attachment,
          'yes'::text AS enable_reminder,
          'yes'::text AS admin_done,
          '' AS admin_done_remarks,
          '' AS image,
          '' AS remark,
          work_datetime::timestamp AS planned_date,
          true AS is_ledger
        FROM working_date_history
        WHERE LOWER(status) = 'completed'
      )`;
    }

    const isLedgerCol = table === 'checklist' ? 'is_ledger' : 'false AS is_ledger';

    let query = `
      SELECT 
        ${idCol} as task_id,
        department,
        division,
        given_by,
        name,
        task_description,
        ${enableReminderCol} as enable_reminder,
        require_attachment,
        frequency,
        ${remarkCol} as remark,
        status,
        ${imageCol} as image,
        ${adminDoneCol} as admin_done,
        delay,
        ${onTimeClause} as is_on_time,
        ${colorCodeCol},
        CASE WHEN planned_date IS NOT NULL THEN to_char(planned_date::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as planned_date,
        CASE WHEN created_at IS NOT NULL THEN to_char(created_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as created_at,
        CASE WHEN task_start_date IS NOT NULL THEN to_char(task_start_date::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as task_start_date,
        CASE WHEN submission_date IS NOT NULL THEN to_char(submission_date::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as submission_date,
        ${adminDoneRemarksCol} as admin_done_remarks,
        ${table}.${dateCol} as task_start_date_original,
        ${isLedgerCol}
      FROM ${fromTable} ${table} 
      WHERE 1=1
    `;
    finalQuery = query;

    // Normalize role comparison
    const upRole = (role || "").toUpperCase();
    const requesterUnit = req.query.unit || "";
    const requesterDivision = req.query.division || "";
    const requesterDepartment = (req.query.department || departmentFilter || "").trim();

    // ---------------------------
    // HIERARCHICAL FILTERS
    // ---------------------------
    if (upRole === "SUPER_ADMIN") {
      // No extra filter
    } else if (upRole === "DIV_ADMIN") {
      if (requesterUnit && requesterDivision) {
        query += ` AND LOWER(${table}.unit) = LOWER('${requesterUnit.replace(/'/g, "''")}') AND LOWER(${table}.division) = LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      }
    } else if (upRole === "ADMIN") {
      if (requesterUnit && requesterDivision && requesterDepartment) {
        const deptEscaped = requesterDepartment.replace(/'/g, "''");
        query += ` AND LOWER(${table}.unit) = LOWER('${requesterUnit.replace(/'/g, "''")}') AND LOWER(${table}.division) = LOWER('${requesterDivision.replace(/'/g, "''")}') AND LOWER(${table}.department) = LOWER('${deptEscaped}')`;
      } else {
        // Fallback to existing manual filters if requester info missing
        if (staffFilter && staffFilter !== "all") query += ` AND LOWER(${table}.name) = LOWER('${staffFilter}')`;
        if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(${table}.department) = LOWER('${departmentFilter}')`;
      }
    } else if (username) {
      query += ` AND LOWER(${table}.name) = LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(${table}.division) = LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(${table}.department) = LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    // Manual overrides from UI (if permitted)
    if (upRole === "SUPER_ADMIN" || upRole === "super_admin" || upRole === "DIV_ADMIN" || upRole === "div_admin" || upRole === "ADMIN" || upRole === "admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(${table}.name) = LOWER('${staffFilter.replace(/'/g, "''")}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(${table}.department) = LOWER('${departmentFilter.replace(/'/g, "''")}')`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(${table}.unit) = LOWER('${unitFilter.replace(/'/g, "''")}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(${table}.division) = LOWER('${divisionFilter.replace(/'/g, "''")}')`;
    }

    // ---------------------------
    // TASK VIEW FILTERS
    // ---------------------------
    // Use planned_date for delegation, task_start_date for checklist

    // Exclude Leave and Inactive (Day Off) tasks from main views
    query += ` AND (${table}.status IS NULL OR LOWER(${table}.status::text) NOT IN ('leave', 'inactive')) `;

    if (taskView === "recent") {
      // TODAY TASKS
      query += `
        AND ${dateCol}::date = CURRENT_DATE
      `;

      // For checklist: status is enum 'yes'/'no', compare directly
      if (dashboardType === "checklist") {
        query += ` AND ${table}.submission_date IS NULL`;
      }
    }
    else if (taskView === "upcoming") {
      // FUTURE TASKS
      query += `
        AND ${dateCol}::date > CURRENT_DATE
      `;

      // For checklist: exclude completed tasks
      if (dashboardType === "checklist") {
        query += ` AND ${table}.submission_date IS NULL`;
      }

      if (dashboardType !== "delegation") {
        query += `
          AND ${dateCol}::date <= CASE 
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
          END
        `;
      }
    }
    else if (taskView === "overdue") {
      // PAST DUE + NOT COMPLETED
      query += `
        AND ${dateCol}::date < CURRENT_DATE
      `;

      if (dashboardType === "checklist") {
        query += ` AND ${table}.submission_date IS NULL`;
      } else {
        query += ` AND ${table}.submission_date IS NULL`;
      }
    }
    else if (taskView === "all") {
      // ALL TASKS IN CURRENT MONTH (OR COMPLETED DELEGATION TASKS)
      let start = startDate;
      let end = endDate;

      if (!start || !end) {
        start = `${firstDayStr} 00:00:00`;
        end = `${currentDayStr} 23:59:59`;
      } else {
        start = `${start} 00:00:00`;
        end = `${end} 23:59:59`;
      }

      if (dashboardType === "delegation") {
        query += `
          AND (
            (${dateCol} >= '${start}' AND ${dateCol} <= '${end}')
            OR 
            (${table}.submission_date IS NOT NULL)
            OR
            (${table}.submission_date IS NULL AND ${dateCol}::date < CURRENT_DATE)
          )
        `;
      } else {
        query += `
          AND (
            (${dateCol} >= '${start}' AND ${dateCol} <= '${end}')
            OR
            (${table}.submission_date IS NULL AND ${dateCol}::date < CURRENT_DATE)
          )
        `;
      }
    }

    // ORDER + PAGINATION
    query += ` ORDER BY task_start_date_original ASC LIMIT ${limit} OFFSET ${offset}`;

    log("FINAL QUERY =>", query);

    const result = await pool.query(query);

    // Remove the helper column before returning
    const rows = result.rows.map(row => {
      const { task_start_date_original, ...rest } = row;
      return rest;
    });

    res.json(rows);

  } catch (err) {
    console.error("ERROR in getDashboardData:", err.message);
    if (finalQuery) console.error("QUERY WAS:", finalQuery);
    res.status(500).send("Error fetching dashboard data");
  }
};

export const getTotalTask = async (req, res) => {
  try {
    const {
      dashboardType,
      staffFilter,
      departmentFilter,
      unitFilter,
      divisionFilter,
      role,
      username,
      startDate,
      endDate
    } = req.query;

    const { table, dateCol } = getMapping(dashboardType);
    const { firstDayStr, currentDayStr } = getCurrentMonthRange();

    let query = `
      SELECT COUNT(*) AS count
      FROM ${table}
      WHERE (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive')) AND
    `;

    if (dashboardType === "delegation") {
      // Delegation: Include all from start of this month onwards (including future)
      // PLUS all completed tasks from any time.
      if (startDate && endDate) {
        query += ` 
          (
            ${dateCol}::date >= '${startDate}' AND ${dateCol}::date <= '${endDate}'
          )
        `;
      } else {
        query += ` 
          (
            (${dateCol}::date >= '${firstDayStr}')
            OR 
            (submission_date IS NOT NULL)
          )
        `;
      }
    }
    else {
      // Checklist: Current month by default
      if (startDate && endDate) {
        query += ` ${dateCol}::date >= '${startDate}' AND ${dateCol}::date <= '${endDate}' `;
      } else {
        query += ` ${dateCol}::date >= '${firstDayStr}' AND ${dateCol}::date <= '${currentDayStr}' `;
      }
    }

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(unit)=LOWER('${unitFilter}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(division)=LOWER('${divisionFilter}')`;
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}')`;
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department)=LOWER('${requesterDepartment}')`;
      }
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
    } else {
      query += ` AND LOWER(name)=LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    const result = await pool.query(query);
    res.json(Number(result.rows[0].count));
  } catch (err) {
    console.error("TOTAL ERROR:", err.message);
    res.status(500).json({ error: "Error fetching total tasks" });
  }
};

export const getCompletedTask = async (req, res) => {
  try {
    const {
      dashboardType,
      staffFilter,
      departmentFilter,
      unitFilter,
      divisionFilter,
      role,
      username,
      startDate,
      endDate
    } = req.query;

    const { table, dateCol } = getMapping(dashboardType);
    const { firstDayStr, currentDayStr } = getCurrentMonthRange();

    let query = `
      SELECT COUNT(*) AS count
      FROM ${table}
      WHERE (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive'))
    `;

    if (dashboardType === "checklist") {
      if (startDate && endDate) {
        query += ` AND ${dateCol}::date >= '${startDate}' AND ${dateCol}::date <= '${endDate}' `;
      } else {
        query += ` AND ${dateCol}::date >= '${firstDayStr}' AND ${dateCol}::date <= '${currentDayStr}' `;
      }
      query += ` AND status = 'yes' AND submission_date IS NOT NULL `;
    } else {
      // Delegation: Completed tasks (has submission date) 
      query += ` AND submission_date IS NOT NULL `;

      if (startDate && endDate) {
        query += ` AND (${dateCol}::date >= '${startDate}' AND ${dateCol}::date <= '${endDate}')`;
      } else {
        query += ` AND (${dateCol}::date >= '${firstDayStr}' AND ${dateCol}::date <= '${currentDayStr}' OR submission_date IS NOT NULL)`;
      }
    }

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(unit)=LOWER('${unitFilter}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(division)=LOWER('${divisionFilter}')`;
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}')`;
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department)=LOWER('${requesterDepartment}')`;
      }
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
    } else {
      query += ` AND LOWER(name)=LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    const result = await pool.query(query);
    res.json(Number(result.rows[0].count));
  } catch (err) {
    console.error("COMPLETED ERROR:", err.message);
    res.status(500).json({ error: "Error fetching completed tasks" });
  }
};

// export const getPendingTask = async (req, res) => {
//   try {
//     const { dashboardType, staffFilter, departmentFilter, role, username } = req.query;

//     const table = dashboardType;

//     // Get current month range
//     const { firstDayStr, currentDayStr } = getCurrentMonthRange();

//     let query = `
//       SELECT COUNT(*) AS count
//       FROM ${table}
//       WHERE task_start_date >= '${firstDayStr} 00:00:00'
//       AND task_start_date <= '${currentDayStr} 23:59:59'
//       AND submission_date IS NULL
//     `;

//     if (dashboardType === "checklist") {
//       query += ` AND (status IS NULL OR status <> 'yes') `;
//     }

//     if (role === "user" && username) query += ` AND LOWER(name)=LOWER('${username}')`;
//     if (role === "admin" && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
//     if (dashboardType === "checklist" && departmentFilter !== "all")
//       query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;

//     const result = await pool.query(query);
//     res.json(Number(result.rows[0].count));
//   } catch (err) {
//     console.error("PENDING ERROR:", err.message);
//     res.status(500).json({ error: "Error fetching pending tasks" });
//   }
// };


export const getPendingTask = async (req, res) => {
  try {
    const {
      dashboardType,
      staffFilter,
      departmentFilter,
      unitFilter,
      divisionFilter,
      role,
      username,
      startDate,
      endDate
    } = req.query;
    const { table, dateCol } = getMapping(dashboardType);
    const { firstDayStr, currentDayStr } = getCurrentMonthRange();

    let query = `
      SELECT COUNT(*) AS count
      FROM ${table}
      WHERE submission_date IS NULL AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
    `;

    if (dashboardType === "checklist") {
      // Checklist: Pending for CURRENT MONTH (matching table)
      let start = startDate || firstDayStr;
      let end = endDate || currentDayStr;

      query += ` 
        AND ${dateCol}::date >= '${start}' 
        AND ${dateCol}::date <= '${end}'
        AND submission_date IS NULL 
      `;
    } else {
      // Delegation: All pending tasks (no submission date)
      query += ` AND submission_date IS NULL `;
      if (startDate && endDate) {
        query += ` AND ${dateCol}::date >= '${startDate}' AND ${dateCol}::date <= '${endDate}' `;
      }
    }

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(unit)=LOWER('${unitFilter}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(division)=LOWER('${divisionFilter}')`;
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}')`;
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department)=LOWER('${requesterDepartment}')`;
      }
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
    } else {
      query += ` AND LOWER(name)=LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    const result = await pool.query(query);
    res.json(Number(result.rows[0].count));

  } catch (err) {
    console.error("PENDING ERROR:", err.message);
    res.status(500).json({ error: "Error fetching pending tasks" });
  }
};


export const getNotDoneTask = async (req, res) => {
  try {
    const {
      dashboardType,
      staffFilter,
      departmentFilter,
      unitFilter,
      divisionFilter,
      role,
      username,
      startDate,
      endDate
    } = req.query;
    const { table, dateCol } = getMapping(dashboardType);
    const { firstDayStr, currentDayStr } = getCurrentMonthRange();

    let query = `
      SELECT COUNT(*) AS count
      FROM ${table}
      WHERE (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive'))
    `;

    if (dashboardType === "delegation") {
      query += ` AND submission_date IS NOT NULL AND color_code_for = 2 `;
      if (startDate && endDate) {
        query += ` AND ${dateCol}::date >= '${startDate}' AND ${dateCol}::date <= '${endDate}' `;
      }
    } else {
      let start = startDate || firstDayStr;
      let end = endDate || currentDayStr;

      query += ` 
        AND ${dateCol} >= '${start} 00:00:00'
        AND ${dateCol} <= '${end} 23:59:59'
        AND (status = 'no' OR status IS NULL)
        AND submission_date IS NOT NULL
      `;
    }

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND name='${staffFilter}'`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND department='${departmentFilter}'`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(unit)=LOWER('${unitFilter}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(division)=LOWER('${divisionFilter}')`;
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}')`;
      if (staffFilter && staffFilter !== "all") query += ` AND name='${staffFilter}'`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND department='${departmentFilter}'`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department)=LOWER('${requesterDepartment}')`;
      }
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
    } else {
      query += ` AND LOWER(name)=LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    const result = await pool.query(query);
    res.json(Number(result.rows[0].count || 0));

  } catch (err) {
    console.error("❌ NOT DONE ERROR:", err.message);
    res.status(500).json({ error: "Error fetching not done tasks" });
  }
};

export const getOverdueTask = async (req, res) => {
  try {
    const {
      dashboardType,
      staffFilter,
      departmentFilter,
      unitFilter,
      divisionFilter,
      role,
      username,
      startDate,
      endDate
    } = req.query;

    const { table, dateCol } = getMapping(dashboardType);
    const params = [];

    let query = "";
    if (startDate && endDate) {
      query = `
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE ${dateCol}::date >= '${startDate}'
        AND ${dateCol}::date <= '${endDate}'
        AND submission_date IS NULL
        AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
        AND ${dateCol}::date < CURRENT_DATE
      `;
    } else {
      query = `
        SELECT COUNT(*) AS count
        FROM ${table}
        WHERE ${dateCol}::date < CURRENT_DATE
        AND submission_date IS NULL
        AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
      `;
    }

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(unit)=LOWER('${unitFilter}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(division)=LOWER('${divisionFilter}')`;
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}')`;
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter}')`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(unit)=LOWER('${requesterUnit}') AND LOWER(division)=LOWER('${requesterDivision}') AND LOWER(department)=LOWER('${requesterDepartment}')`;
      }
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
    } else {
      query += ` AND LOWER(name)=LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    const result = await pool.query(query);
    res.json(Number(result.rows[0].count));

  } catch (err) {
    console.error("OVERDUE ERROR:", err.message);
    res.status(500).json({ error: "Error fetching overdue tasks" });
  }
};



export const getUniqueDepartments = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT department FROM users 
      WHERE department IS NOT NULL AND department!=''
    `);

    res.json(result.rows.map(d => d.department));
  } catch (err) {
    console.error("DEPARTMENTS ERROR:", err.message);
    res.status(500).json({ error: "Error fetching departments" });
  }
};

export const getStaffByDepartment = async (req, res) => {
  try {
    const { department, unit, division } = req.query;

    let query = `SELECT user_name, user_access, department, unit, division FROM users WHERE user_name IS NOT NULL`;

    const result = await pool.query(query);

    let staff = result.rows;

    if (unit && unit !== "all") {
      staff = staff.filter(u => u.unit && u.unit.toLowerCase() === unit.toLowerCase());
    }

    if (division && division !== "all") {
      staff = staff.filter(u => u.division && u.division.toLowerCase() === division.toLowerCase());
    }

    if (department && department !== "all") {
      staff = staff.filter(u => {
        // Match if user's primary department matches
        const deptMatch = u.department && u.department.toLowerCase() === department.toLowerCase();

        // Match if user has access to the department (exact match in comma-separated list)
        const accessMatch = u.user_access && u.user_access.split(',').some(access => access.trim().toLowerCase() === department.toLowerCase());

        return deptMatch || accessMatch;
      });
    }

    // Return unique non-null names
    const uniqueNames = [...new Set(staff.map(s => s.user_name).filter(Boolean))];
    res.json(uniqueNames);
  } catch (err) {
    console.error("STAFF BY DEPARTMENT ERROR:", err.message);
    res.status(500).json({ error: "Error fetching staff by department" });
  }
};

export const getChecklistByDateRange = async (req, res) => {
  try {
    const { startDate, endDate, staffFilter = "all", departmentFilter = "all", unitFilter = "all", divisionFilter = "all" } = req.query;

    // If no specific date range is provided, default to current month
    let start = startDate;
    let end = endDate;

    if (!startDate || !endDate) {
      const { firstDayStr, currentDayStr } = getCurrentMonthRange();
      start = firstDayStr;
      end = currentDayStr;
    }

    // Build parameterized query
    const params = [start, end];
    let idx = 3;

    // Query with original columns, we'll format dates after fetching
    let query = `
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
        CASE WHEN planned_date IS NOT NULL THEN to_char(planned_date::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as planned_date,
        CASE WHEN created_at IS NOT NULL THEN to_char(created_at::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as created_at,
        CASE WHEN task_start_date IS NOT NULL THEN to_char(task_start_date::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as task_start_date,
        CASE WHEN submission_date IS NOT NULL THEN to_char(submission_date::timestamp, 'YYYY-MM-DD HH24:MI:SS') ELSE NULL END as submission_date,
        admin_done_remarks,
        checklist.task_start_date as task_start_date_original
      FROM checklist
      WHERE checklist.task_start_date::date >= $1::date
      AND checklist.task_start_date::date <= $2::date
    `;

    const upRole = req.query.role ? req.query.role.toUpperCase() : "USER";
    const username = req.query.username;
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") { query += ` AND LOWER(checklist.name)=LOWER($${idx++})`; params.push(staffFilter); }
      if (departmentFilter && departmentFilter !== "all") { query += ` AND LOWER(checklist.department)=LOWER($${idx++})`; params.push(departmentFilter); }
      if (unitFilter && unitFilter !== "all") { query += ` AND LOWER(checklist.unit)=LOWER($${idx++})`; params.push(unitFilter); }
      if (divisionFilter && divisionFilter !== "all") { query += ` AND LOWER(checklist.division)=LOWER($${idx++})`; params.push(divisionFilter); }
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(checklist.unit)=LOWER($${idx++}) AND LOWER(checklist.division)=LOWER($${idx++})`;
      params.push(requesterUnit, requesterDivision);
      if (staffFilter && staffFilter !== "all") { query += ` AND LOWER(checklist.name)=LOWER($${idx++})`; params.push(staffFilter); }
      if (departmentFilter && departmentFilter !== "all") { query += ` AND LOWER(checklist.department)=LOWER($${idx++})`; params.push(departmentFilter); }
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        query += ` AND LOWER(checklist.unit)=LOWER($${idx++}) AND LOWER(checklist.division)=LOWER($${idx++}) AND LOWER(checklist.department) = ANY($${idx++})`;
        params.push(requesterUnit, requesterDivision, depts);
      } else {
        query += ` AND LOWER(checklist.unit)=LOWER($${idx++}) AND LOWER(checklist.division)=LOWER($${idx++}) AND LOWER(checklist.department)=LOWER($${idx++})`;
        params.push(requesterUnit, requesterDivision, requesterDepartment);
      }
      if (staffFilter && staffFilter !== "all") {
        query += ` AND LOWER(checklist.name)=LOWER($${idx++})`;
        params.push(staffFilter);
      }
    } else {
      query += ` AND LOWER(checklist.name)=LOWER($${idx++})`;
      params.push(username);
      if (requesterDivision) {
        query += ` AND LOWER(checklist.division)=LOWER($${idx++})`;
        params.push(requesterDivision);
      }
      if (requesterDepartment) {
        query += ` AND LOWER(checklist.department)=LOWER($${idx++})`;
        params.push(requesterDepartment);
      }
    }

    // Use the original timestamp column for sorting
    query += " ORDER BY task_start_date_original ASC LIMIT 5000";

    const result = await pool.query(query, params);

    // Remove the helper column before returning
    const rows = result.rows.map(row => {
      const { task_start_date_original, ...rest } = row;
      return rest;
    });

    log("DATE RANGE QUERY =>", query, "PARAMS =>", params, "ROWS =>", result.rowCount);
    res.json(rows);
  } catch (err) {
    console.error("CHECKLIST DATE RANGE ERROR:", err.message);
    res.status(500).json({ error: "Error fetching checklist by date range" });
  }
};

export const getChecklistStatsByDate = async (req, res) => {
  try {
    const { startDate, endDate, staffFilter = "all", departmentFilter = "all", unitFilter = "all", divisionFilter = "all" } = req.query;

    // If no date range provided, default to current month
    let start = startDate;
    let end = endDate;

    if (!startDate || !endDate) {
      const { firstDayStr, currentDayStr } = getCurrentMonthRange();
      start = firstDayStr;
      end = currentDayStr;
    }

    // Compare on date-only to avoid timezone boundary misses
    const params = [start, end];
    let idx = 3;

    let query = `
      SELECT
        COUNT(*) AS total_tasks,
        SUM(CASE WHEN LOWER(status::text) = 'yes' THEN 1 ELSE 0 END) AS completed_tasks,
        SUM(CASE WHEN LOWER(status::text) = 'no' THEN 1 ELSE 0 END) AS not_done_tasks,
        SUM(
          CASE 
            WHEN (status IS NULL OR LOWER(status::text) NOT IN ('yes', 'leave', 'inactive'))
              AND task_start_date::date < CURRENT_DATE
            THEN 1 ELSE 0 END
        ) AS overdue_tasks
      FROM checklist
      WHERE task_start_date::date >= $1::date
      AND task_start_date::date <= $2::date
      AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive'))
    `;

    const upRole = req.query.role ? req.query.role.toUpperCase() : "USER";
    const username = req.query.username;
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") { query += ` AND LOWER(name)=LOWER($${idx++})`; params.push(staffFilter); }
      if (departmentFilter && departmentFilter !== "all") { query += ` AND LOWER(department)=LOWER($${idx++})`; params.push(departmentFilter); }
      if (unitFilter && unitFilter !== "all") { query += ` AND LOWER(unit)=LOWER($${idx++})`; params.push(unitFilter); }
      if (divisionFilter && divisionFilter !== "all") { query += ` AND LOWER(division)=LOWER($${idx++})`; params.push(divisionFilter); }
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER($${idx++}) AND LOWER(division)=LOWER($${idx++})`;
      params.push(requesterUnit, requesterDivision);
      if (staffFilter && staffFilter !== "all") { query += ` AND LOWER(name)=LOWER($${idx++})`; params.push(staffFilter); }
      if (departmentFilter && departmentFilter !== "all") { query += ` AND LOWER(department)=LOWER($${idx++})`; params.push(departmentFilter); }
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        query += ` AND LOWER(unit)=LOWER($${idx++}) AND LOWER(division)=LOWER($${idx++}) AND LOWER(department) = ANY($${idx++})`;
        params.push(requesterUnit, requesterDivision, depts);
      } else {
        query += ` AND LOWER(unit)=LOWER($${idx++}) AND LOWER(division)=LOWER($${idx++}) AND LOWER(department)=LOWER($${idx++})`;
        params.push(requesterUnit, requesterDivision, requesterDepartment);
      }
      if (staffFilter && staffFilter !== "all") {
        query += ` AND LOWER(name)=LOWER($${idx++})`;
        params.push(staffFilter);
      }
    } else {
      query += ` AND LOWER(name)=LOWER($${idx++})`;
      params.push(username);
      if (requesterDivision) {
        query += ` AND LOWER(division)=LOWER($${idx++})`;
        params.push(requesterDivision);
      }
      if (requesterDepartment) {
        query += ` AND LOWER(department)=LOWER($${idx++})`;
        params.push(requesterDepartment);
      }
    }

    const result = await pool.query(query, params);
    log("DATE RANGE STATS QUERY =>", query, "PARAMS =>", params, "ROWS =>", result.rowCount);

    const row = result.rows[0] || {};
    const totalTasks = Number(row.total_tasks || 0);
    const completedTasks = Number(row.completed_tasks || 0);
    const overdueTasks = Number(row.overdue_tasks || 0);
    const notDoneTasks = Number(row.not_done_tasks || 0);
    const pendingTasks = Math.max(totalTasks - completedTasks, 0);

    res.json({
      totalTasks,
      completedTasks,
      pendingTasks,
      overdueTasks,
      notDone: notDoneTasks,
      completionRate: totalTasks > 0 ? (completedTasks / totalTasks * 100).toFixed(1) : 0
    });
  } catch (err) {
    console.error("CHECKLIST STATS ERROR:", err.message);
    res.status(500).json({ error: "Error fetching checklist stats" });
  }
};

export const getStaffTaskSummary = async (req, res) => {
  try {
    const {
      dashboardType,
      startDate,
      endDate
    } = req.query;
    const { table } = getMapping(dashboardType);
    const { firstDayStr, currentDayStr } = getCurrentMonthRange();

    const query = `
      SELECT 
        t.name,
        u.email_id,
        COUNT(*) AS total,
        SUM(
          CASE 
            WHEN t.submission_date IS NOT NULL THEN 1
            WHEN LOWER(t.status::text) = 'yes' THEN 1
            ELSE 0 
          END
        ) AS completed
      FROM ${table} t
      LEFT JOIN users u ON LOWER(t.name) = LOWER(u.user_name)
      WHERE (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive')) AND
    `;

    if (dashboardType === "delegation") {
      let start = startDate ? `${startDate} 00:00:00` : `${firstDayStr} 00:00:00`;
      let end = endDate ? `${endDate} 23:59:59` : `${currentDayStr} 23:59:59`;

      query += `
        (
          (t.planned_date >= '${start}' AND t.planned_date <= '${end}')
          OR 
          (t.submission_date IS NOT NULL)
        )
      `;
    } else {
      let start = startDate ? `${startDate} 00:00:00` : `${firstDayStr} 00:00:00`;
      let end = endDate ? `${endDate} 23:59:59` : `${currentDayStr} 23:59:59`;

      query += `
        t.task_start_date >= '${start}'
        AND t.task_start_date <= '${end}'
      `;
    }

    const upRole = req.query.role ? req.query.role.toUpperCase() : "USER";
    const username = req.query.username;
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      // No extra filter
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(t.unit)=LOWER('${requesterUnit}') AND LOWER(t.division)=LOWER('${requesterDivision}')`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(t.unit)=LOWER('${requesterUnit}') AND LOWER(t.division)=LOWER('${requesterDivision}') AND LOWER(t.department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(t.unit)=LOWER('${requesterUnit}') AND LOWER(t.division)=LOWER('${requesterDivision}') AND LOWER(t.department)=LOWER('${requesterDepartment}')`;
      }
    } else {
      query += ` AND LOWER(t.name)=LOWER('${username}')`;
      if (requesterDivision) query += ` AND LOWER(t.division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(t.department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    query += `
      GROUP BY t.name, u.email_id
      ORDER BY t.name ASC
    `;

    const result = await pool.query(query);

    const formatted = result.rows.map(r => ({
      id: r.name?.toLowerCase().replace(/\s+/g, "-"),
      name: r.name,
      email: r.email_id || null, // Show null if no email found
      totalTasks: Number(r.total),
      completedTasks: Number(r.completed),
      pendingTasks: Number(r.total) - Number(r.completed),
      progress: Math.round((Number(r.completed) / Number(r.total)) * 100)
    }));

    res.json(formatted);

  } catch (err) {
    console.error("STAFF SUMMARY ERROR:", err.message);
    res.status(500).json({ error: "Error fetching staff task summary" });
  }
};

export const getDashboardDataCount = async (req, res) => {
  try {
    const {
      dashboardType,
      staffFilter = "all",
      taskView = "recent",
      departmentFilter = "all",
      unitFilter = "all",
      divisionFilter = "all",
      role,
      username,
      startDate,
      endDate
    } = req.query;

    const { table, dateCol } = getMapping(dashboardType);

    // Base query (no month cap) so it matches list view filters exactly
    let query = `
      SELECT COUNT(*) AS count
      FROM ${table}
      WHERE (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive'))
    `;

    const upRole = role ? role.toUpperCase() : "USER";
    const requesterUnit = req.query.unit;
    const requesterDivision = req.query.division;
    const requesterDepartment = req.query.department;

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter.replace(/'/g, "''")}')`;
      if (unitFilter && unitFilter !== "all") query += ` AND LOWER(unit)=LOWER('${unitFilter.replace(/'/g, "''")}')`;
      if (divisionFilter && divisionFilter !== "all") query += ` AND LOWER(division)=LOWER('${divisionFilter.replace(/'/g, "''")}')`;
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      query += ` AND LOWER(unit)=LOWER('${requesterUnit?.replace(/'/g, "''")}') AND LOWER(division)=LOWER('${requesterDivision?.replace(/'/g, "''")}')`;
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
      if (departmentFilter && departmentFilter !== "all") query += ` AND LOWER(department)=LOWER('${departmentFilter.replace(/'/g, "''")}')`;
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (requesterDepartment && requesterDepartment.includes(',')) {
        const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
        const deptList = depts.map(d => `'${d.replace(/'/g, "''")}'`).join(',');
        query += ` AND LOWER(unit)=LOWER('${requesterUnit?.replace(/'/g, "''")}') AND LOWER(division)=LOWER('${requesterDivision?.replace(/'/g, "''")}') AND LOWER(department) IN (${deptList})`;
      } else {
        query += ` AND LOWER(unit)=LOWER('${requesterUnit?.replace(/'/g, "''")}') AND LOWER(division)=LOWER('${requesterDivision?.replace(/'/g, "''")}') AND LOWER(department)=LOWER('${requesterDepartment?.replace(/'/g, "''")}')`;
      }
      if (staffFilter && staffFilter !== "all") query += ` AND LOWER(name)=LOWER('${staffFilter.replace(/'/g, "''")}')`;
    } else {
      query += ` AND LOWER(name)=LOWER('${username?.replace(/'/g, "''")}')`;
      if (requesterDivision) query += ` AND LOWER(division)=LOWER('${requesterDivision.replace(/'/g, "''")}')`;
      if (requesterDepartment) query += ` AND LOWER(department)=LOWER('${requesterDepartment.replace(/'/g, "''")}')`;
    }

    // TASK VIEW LOGIC
    if (taskView === "recent") {
      query += `
        AND DATE(${dateCol}) = CURRENT_DATE
        AND submission_date IS NULL
      `;
    }
    else if (taskView === "upcoming") {
      query += `
        AND DATE(${dateCol}) > CURRENT_DATE
        AND submission_date IS NULL
      `;
      if (dashboardType !== "delegation") {
        query += `
          AND DATE(${dateCol}) <= CASE 
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
          END
        `;
      }
    }
    else if (taskView === "overdue") {
      if (startDate && endDate) {
        query += `
          AND DATE(${dateCol}) >= '${startDate}'
          AND DATE(${dateCol}) <= '${endDate}'
          AND submission_date IS NULL
          AND DATE(${dateCol}) < CURRENT_DATE
        `;
      } else {
        query += `
          AND DATE(${dateCol}) < CURRENT_DATE
          AND submission_date IS NULL
        `;
      }
    }

    const result = await pool.query(query);
    const count = Number(result.rows[0].count || 0);

    log("COUNT QUERY for", taskView, "=>", query);
    log("COUNT RESULT:", count);

    res.json(count);

  } catch (err) {
    console.error("DASHBOARD COUNT ERROR:", err.message);
    res.status(500).json({ error: "Error fetching dashboard count" });
  }
};

export const getChecklistDateRangeCount = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      staffFilter = "all",
      departmentFilter = "all",
      unitFilter = "all",
      divisionFilter = "all",
      statusFilter = "all"
    } = req.query;

    const role = req.query.role;
    const username = req.query.username;

    // If no date range provided, default to current month
    let start = startDate;
    let end = endDate;

    if (!startDate || !endDate) {
      const { firstDayStr, currentDayStr } = getCurrentMonthRange();
      start = firstDayStr;
      end = currentDayStr;
    }

    // Compare on date-only to avoid timezone boundary misses
    const params = [start, end];
    let idx = 3;

    let query = `
      SELECT COUNT(*) AS count
      FROM checklist
      WHERE task_start_date::date >= $1::date
      AND task_start_date::date <= $2::date
      AND (status IS NULL OR LOWER(status::text) NOT IN ('leave', 'inactive'))
    `;

    // ROLE FILTER (USER)
    if (role === "user" && username) {
      query += ` AND LOWER(name) = LOWER($${idx++})`;
      params.push(username);
      const requesterDivision = req.query.division;
      const requesterDepartment = req.query.department;
      if (requesterDivision) {
        query += ` AND LOWER(division) = LOWER($${idx++})`;
        params.push(requesterDivision);
      }
      if (requesterDepartment) {
        query += ` AND LOWER(department) = LOWER($${idx++})`;
        params.push(requesterDepartment);
      }
    }

    // ADMIN STAFF FILTER
    if ((role === "admin" || role === "super_admin") && staffFilter !== "all") {
      query += ` AND LOWER(name) = LOWER($${idx++})`;
      params.push(staffFilter);
    }

    // DEPARTMENT FILTER
    if (departmentFilter && departmentFilter !== "all") {
      query += ` AND LOWER(department) = LOWER($${idx++})`;
      params.push(departmentFilter);
    }
    if (unitFilter && unitFilter !== "all") {
      query += ` AND LOWER(unit) = LOWER($${idx++})`;
      params.push(unitFilter);
    }
    if (divisionFilter && divisionFilter !== "all") {
      query += ` AND LOWER(division) = LOWER($${idx++})`;
      params.push(divisionFilter);
    }

    // STATUS FILTER
    switch (statusFilter) {
      case "completed":
        query += ` AND LOWER(status::text) = 'yes'`;
        break;
      case "pending":
        query += ` AND (status IS NULL OR LOWER(status::text) <> 'yes') AND LOWER(status::text) NOT IN ('leave', 'inactive')`;
        break;
      case "overdue":
        query += ` 
          AND (status IS NULL OR LOWER(status::text) <> 'yes')
          AND submission_date IS NULL
          AND task_start_date < CURRENT_DATE
          AND LOWER(status::text) NOT IN ('leave', 'inactive')
        `;
        break;
    }

    const result = await pool.query(query, params);
    const count = Number(result.rows[0].count || 0);

    res.json(count);

  } catch (err) {
    console.error("DATE RANGE COUNT ERROR:", err.message);
    res.status(500).json({ error: "Error fetching date range count" });
  }
};

export const getDashboardSummaryCounts = async (req, res) => {
  try {
    const {
      dashboardType = "checklist",
      staffFilter = "all",
      departmentFilter = "all",
      unitFilter = "all",
      divisionFilter = "all",
      role,
      username,
      startDate,
      endDate
    } = req.query;

    const { table, dateCol } = getMapping(dashboardType);
    const { firstDayStr, currentDayStr } = getCurrentMonthRange();

    let start = startDate || firstDayStr;
    let end = endDate || currentDayStr;

    const upRole = (role || "").toUpperCase();
    const requesterUnit = req.query.unit || "";
    const requesterDivision = req.query.division || "";
    const requesterDepartment = (req.query.department || "").trim();

    // Build common filter SQL conditions
    let filterQuery = "";
    const params = [];
    let paramCount = 1;

    // Role-based restrictions
    if (upRole === "SUPER_ADMIN") {
      // No extra filter
    } else if (upRole === "DIV_ADMIN") {
      if (requesterUnit && requesterDivision) {
        filterQuery += ` AND LOWER(t.unit) = LOWER($${paramCount}) AND LOWER(t.division) = LOWER($${paramCount + 1})`;
        params.push(requesterUnit, requesterDivision);
        paramCount += 2;
      }
    } else if (upRole === "ADMIN") {
      if (requesterUnit && requesterDivision && requesterDepartment) {
        if (requesterDepartment.includes(',')) {
          const depts = requesterDepartment.split(',').map(d => d.trim().toLowerCase());
          filterQuery += ` AND LOWER(t.unit) = LOWER($${paramCount}) AND LOWER(t.division) = LOWER($${paramCount + 1}) AND LOWER(t.department) = ANY($${paramCount + 2})`;
          params.push(requesterUnit, requesterDivision, depts);
          paramCount += 3;
        } else {
          filterQuery += ` AND LOWER(t.unit) = LOWER($${paramCount}) AND LOWER(t.division) = LOWER($${paramCount + 1}) AND LOWER(t.department) = LOWER($${paramCount + 2})`;
          params.push(requesterUnit, requesterDivision, requesterDepartment);
          paramCount += 3;
        }
      } else {
        if (staffFilter && staffFilter !== "all") {
          filterQuery += ` AND LOWER(t.name) = LOWER($${paramCount})`;
          params.push(staffFilter);
          paramCount++;
        }
        if (departmentFilter && departmentFilter !== "all") {
          filterQuery += ` AND LOWER(t.department) = LOWER($${paramCount})`;
          params.push(departmentFilter);
          paramCount++;
        }
      }
    } else if (username) {
      filterQuery += ` AND LOWER(t.name) = LOWER($${paramCount})`;
      params.push(username);
      paramCount++;
      if (requesterDivision) {
        filterQuery += ` AND LOWER(t.division) = LOWER($${paramCount})`;
        params.push(requesterDivision);
        paramCount++;
      }
      if (requesterDepartment) {
        filterQuery += ` AND LOWER(t.department) = LOWER($${paramCount})`;
        params.push(requesterDepartment);
        paramCount++;
      }
    }

    // Manual overrides from UI (if permitted)
    if (upRole === "SUPER_ADMIN" || upRole === "DIV_ADMIN" || upRole === "ADMIN") {
      if (staffFilter && staffFilter !== "all" && upRole !== "ADMIN") {
        filterQuery += ` AND LOWER(t.name) = LOWER($${paramCount})`;
        params.push(staffFilter);
        paramCount++;
      }
      if (departmentFilter && departmentFilter !== "all") {
        filterQuery += ` AND LOWER(t.department) = LOWER($${paramCount})`;
        params.push(departmentFilter);
        paramCount++;
      }
      if (unitFilter && unitFilter !== "all") {
        filterQuery += ` AND LOWER(t.unit) = LOWER($${paramCount})`;
        params.push(unitFilter);
        paramCount++;
      }
      if (divisionFilter && divisionFilter !== "all") {
        filterQuery += ` AND LOWER(t.division) = LOWER($${paramCount})`;
        params.push(divisionFilter);
        paramCount++;
      }
    }

    let query = "";

    if (dashboardType === "delegation") {
      const startIdx = paramCount;
      const endIdx = paramCount + 1;
      params.push(start, end);

      if (startDate && endDate) {
        query = `
          SELECT
            COUNT(*) AS total_tasks,
            SUM(CASE WHEN submission_date IS NOT NULL THEN 1 ELSE 0 END) AS completed_tasks,
            SUM(CASE WHEN submission_date IS NULL THEN 1 ELSE 0 END) AS pending_tasks,
            SUM(CASE WHEN planned_date::date < CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS overdue_tasks,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for = 2 THEN 1 ELSE 0 END) AS not_done_tasks,
            SUM(CASE WHEN planned_date::date = CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS pending_today,
            SUM(CASE WHEN planned_date::date > CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS pending_upcoming,
            SUM(CASE WHEN planned_date::date < CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS pending_overdue,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for = 1 THEN 1 ELSE 0 END) AS completed_rating_one,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for = 2 THEN 1 ELSE 0 END) AS completed_rating_two,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for >= 3 THEN 1 ELSE 0 END) AS completed_rating_three_plus
          FROM delegation t
          LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) 
            AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) 
            AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
          WHERE (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
            AND t.planned_date::date >= $${startIdx}::date
            AND t.planned_date::date <= $${endIdx}::date
            ${filterQuery}
        `;
      } else {
        const hasDateRangeIdx = paramCount + 2;
        params.push(false);
        query = `
          SELECT
            SUM(CASE WHEN (planned_date::date >= $${startIdx} AND planned_date::date <= $${endIdx}) OR submission_date IS NOT NULL THEN 1 ELSE 0 END) AS total_tasks,
            SUM(CASE WHEN submission_date IS NOT NULL THEN 1 ELSE 0 END) AS completed_tasks,
            SUM(CASE WHEN submission_date IS NULL THEN 1 ELSE 0 END) AS pending_tasks,
            SUM(CASE WHEN planned_date::date < CURRENT_DATE AND submission_date IS NULL 
                      AND (CASE WHEN $${hasDateRangeIdx} THEN planned_date::date >= $${startIdx} AND planned_date::date <= $${endIdx} ELSE true END) THEN 1 ELSE 0 END) AS overdue_tasks,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for = 2 THEN 1 ELSE 0 END) AS not_done_tasks,
            SUM(CASE WHEN planned_date::date = CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS pending_today,
            SUM(CASE WHEN planned_date::date > CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS pending_upcoming,
            SUM(CASE WHEN planned_date::date < CURRENT_DATE AND submission_date IS NULL THEN 1 ELSE 0 END) AS pending_overdue,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for = 1 THEN 1 ELSE 0 END) AS completed_rating_one,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for = 2 THEN 1 ELSE 0 END) AS completed_rating_two,
            SUM(CASE WHEN submission_date IS NOT NULL AND color_code_for >= 3 THEN 1 ELSE 0 END) AS completed_rating_three_plus
          FROM delegation t
          LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) 
            AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) 
            AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
          WHERE (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
            ${filterQuery}
        `;
      }
    } else {
      // Checklist / Maintenance: Base date filter in WHERE clause
      let fromTable = table;
      if (dashboardType === "checklist") {
        fromTable = `(
          SELECT 
            name, 
            department, 
            division, 
            unit,
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
            unit,
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

      const completedExp = dashboardType === "checklist"
        ? "t.submission_date IS NOT NULL AND t.status = 'yes'"
        : "t.submission_date IS NOT NULL";

      const startIdx = paramCount;
      const endIdx = paramCount + 1;
      params.push(start, end);

      const targetDateCol = "task_start_date";

      query = `
        SELECT
          COUNT(*) AS total_tasks,
          SUM(CASE WHEN ${completedExp} THEN 1 ELSE 0 END) AS completed_tasks,
          SUM(CASE WHEN t.submission_date IS NULL THEN 1 ELSE 0 END) AS pending_tasks,
          SUM(CASE WHEN t.${targetDateCol}::date < CURRENT_DATE AND t.submission_date IS NULL THEN 1 ELSE 0 END) AS overdue_tasks,
          SUM(CASE WHEN t.submission_date IS NOT NULL AND (t.status = 'no' OR t.status IS NULL) THEN 1 ELSE 0 END) AS not_done_tasks,
          SUM(CASE WHEN t.${targetDateCol}::date = CURRENT_DATE AND t.submission_date IS NULL THEN 1 ELSE 0 END) AS pending_today,
          SUM(CASE 
            WHEN t.${targetDateCol}::date > CURRENT_DATE AND t.submission_date IS NULL 
            AND t.${targetDateCol}::date <= CASE 
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
            END
            THEN 1 ELSE 0 
          END) AS pending_upcoming,
          SUM(CASE WHEN t.${targetDateCol}::date < CURRENT_DATE AND t.submission_date IS NULL THEN 1 ELSE 0 END) AS pending_overdue
        FROM ${fromTable} t
        LEFT JOIN users u ON TRIM(LOWER(t.name)) = TRIM(LOWER(u.user_name)) 
          AND TRIM(LOWER(t.department)) = TRIM(LOWER(u.department)) 
          AND TRIM(LOWER(t.division)) = TRIM(LOWER(u.division))
        WHERE (t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))
          AND t.${targetDateCol}::date >= $${startIdx}::date
          AND t.${targetDateCol}::date <= $${endIdx}::date
          ${filterQuery}
      `;
    }

    const result = await pool.query(query, params);
    const row = result.rows[0] || {};

    const totalTasks = Number(row.total_tasks || 0);
    const completedTasks = Number(row.completed_tasks || 0);
    const pendingTasks = Number(row.pending_tasks || 0);
    const overdueTasks = Number(row.overdue_tasks || 0);
    const notDoneTasks = Number(row.not_done_tasks || 0);
    const pendingToday = Number(row.pending_today || 0);
    const pendingUpcoming = Number(row.pending_upcoming || 0);
    const pendingOverdue = Number(row.pending_overdue || 0);

    const completedRatingOne = Number(row.completed_rating_one || 0);
    const completedRatingTwo = Number(row.completed_rating_two || 0);
    const completedRatingThreePlus = Number(row.completed_rating_three_plus || 0);

    const completionRate = totalTasks > 0 ? Number(((completedTasks / totalTasks) * 100).toFixed(1)) : 0;

    res.json({
      totalTasks,
      completedTasks,
      pendingTasks,
      overdueTasks,
      notDoneTasks,
      pendingToday,
      pendingUpcoming,
      pendingOverdue,
      completedRatingOne,
      completedRatingTwo,
      completedRatingThreePlus,
      completionRate
    });

  } catch (err) {
    console.error("DASHBOARD SUMMARY COUNTS ERROR:", err.message);
    res.status(500).json({ error: "Error fetching dashboard summary counts" });
  }
};

