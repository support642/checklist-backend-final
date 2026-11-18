import pool from "../config/chatbotDb.js";

// ==========================================
// 1. Retrieve and validate employee profile
// ==========================================

const getEmployeeProfile = async (username) => {
    const query = `
        SELECT
            id,
            user_name,
            employee_id,
            role,
            status,
            department,
            unit,
            division,
            designation
        FROM users
        WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
          AND status::text = 'active'
        LIMIT 1;
    `;

    const { rows } = await pool.query(query, [username]);

    if (rows.length === 0) {
        const error = new Error(
            "Active employee account not found or access denied."
        );

        error.statusCode = 403;
        throw error;
    }

    return rows[0];
};


// ==========================================
// 2. Validate administrator access
// ==========================================

export const getAdminProfile = async (username) => {
    const employee = await getEmployeeProfile(username);

    const allowedRoles = [
        "admin",
        "div_admin",
        "super_admin"
    ];

    const role = String(employee.role || "").toLowerCase();

    if (!allowedRoles.includes(role)) {
        const error = new Error(
            "Administrator access required."
        );

        error.statusCode = 403;
        throw error;
    }

    return {
        ...employee,
        role
    };
};


// ==========================================
// 3. Retrieve employee's assigned tasks
// ==========================================

const getEmployeeTaskRecords = async (username) => {
    const query = `
        SELECT
            'checklist' AS task_category,
            task_id::text AS task_id,
            task_description,
            status::text AS status,
            admin_done::text AS admin_status,
            task_start_date AS assigned_date,
            NULLIF(TRIM(planned_date), '')::timestamp AS planned_date,
            submission_date,
            given_by,
            department,
            unit,
            division
        FROM checklist
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
          AND status::text NOT IN ('Leave', 'Inactive')

        UNION ALL

        SELECT
            'delegation',
            task_id::text,
            task_description,
            status::text,
            NULL::text,
            task_start_date,
            planned_date,
            submission_date,
            given_by,
            department,
            unit,
            division
        FROM delegation
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))

        UNION ALL

        SELECT
            'maintenance',
            id::text,
            task_description,
            status::text,
            admin_done::text,
            task_start_date,
            planned_date,
            submission_date,
            given_by,
            department,
            unit,
            division
        FROM maintenance_tasks
        WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
          AND status::text <> 'Leave'

        ORDER BY planned_date DESC NULLS LAST;
    `;

    const { rows } = await pool.query(query, [username]);

    return rows;
};


// ==========================================
// 4. Retrieve employee tasks
// ==========================================

export const getEmployeeTasks = async (
    username,
    statusFilter = "all"
) => {
    const employee = await getEmployeeProfile(username);

    const allTasks = await getEmployeeTaskRecords(
        employee.user_name
    );

    const tasks = allTasks.map((task) => {
        const rawStatus = String(
            task.status || ""
        ).toLowerCase();

        let normalizedStatus = "other";

        if (
            (task.task_category === "checklist" && rawStatus === "no") ||
            (task.task_category === "delegation" && rawStatus === "pending") ||
            (task.task_category === "maintenance" && rawStatus === "pending")
        ) {
            normalizedStatus = "pending";
        }

        if (
            (task.task_category === "checklist" && rawStatus === "yes") ||
            (task.task_category === "delegation" && rawStatus === "done") ||
            (task.task_category === "maintenance" && rawStatus === "yes")
        ) {
            normalizedStatus = "completed";
        }

        return {
            ...task,
            normalized_status: normalizedStatus
        };
    });

    const filteredTasks = statusFilter === "all"
        ? tasks
        : tasks.filter(
            task => task.normalized_status === statusFilter
        );

    return {
        employee: {
            username: employee.user_name,
            employee_id: employee.employee_id,
            role: employee.role,
            department: employee.department,
            unit: employee.unit,
            division: employee.division,
            designation: employee.designation
        },

        summary: {
            total_tasks: tasks.length,
            pending_tasks: tasks.filter(
                task => task.normalized_status === "pending"
            ).length,
            completed_tasks: tasks.filter(
                task => task.normalized_status === "completed"
            ).length,
            other_tasks: tasks.filter(
                task => task.normalized_status === "other"
            ).length
        },

        tasks: filteredTasks
    };
};


// ==========================================
// 5. Parse work duration into minutes
// ==========================================

const parseDurationToMinutes = (duration) => {
    if (typeof duration !== "string") {
        return null;
    }

    const normalized = duration
        .trim()
        .replace(/\.$/, "")
        .trim();

    const match = normalized.match(
        /^(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)$/i
    );

    if (!match) {
        return null;
    }

    const value = Number(match[1]);
    const unit = match[2].toLowerCase();

    if (!Number.isFinite(value) || value < 0) {
        return null;
    }

    return unit.startsWith("h")
        ? Math.round(value * 60)
        : Math.round(value);
};


// ==========================================
// 6. Validate date format
// ==========================================

const isValidWorkHistoryDate = (date) => {
    if (typeof date !== "string") {
        return false;
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);

    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
    );
};


// ==========================================
// 7. Retrieve employee daily work history
// ==========================================

export const getEmployeeWorkHistory = async (
    username,
    date = null,
    dateRange = null
) => {
    const employee = await getEmployeeProfile(username);

    const startDate = dateRange?.startDate || null;
    const endDate = dateRange?.endDate || null;

    if (date && (startDate || endDate)) {
        throw new Error(
            "Use either a specific date or a date range, not both."
        );
    }

    if (date && !isValidWorkHistoryDate(date)) {
        throw new Error(
            "Invalid date. Use YYYY-MM-DD format."
        );
    }

    if (Boolean(startDate) !== Boolean(endDate)) {
        throw new Error(
            "Both start date and end date are required."
        );
    }

    if (startDate && endDate) {
        if (
            !isValidWorkHistoryDate(startDate) ||
            !isValidWorkHistoryDate(endDate)
        ) {
            throw new Error(
                "Invalid date range. Use YYYY-MM-DD format."
            );
        }

        if (startDate > endDate) {
            throw new Error(
                "Start date cannot be after end date."
            );
        }
    }

    const query = `
        SELECT
            id,
            work_datetime,
            work_details,
            status,
            duration,
            assign_by,
            department,
            unit,
            division
        FROM working_date_history
        WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))

          AND (
              $2::date IS NULL
              OR work_datetime::date = $2::date
          )

          AND (
              $3::date IS NULL
              OR work_datetime >= $3::date
          )

          AND (
              $4::date IS NULL
              OR work_datetime < ($4::date + INTERVAL '1 day')
          )

        ORDER BY work_datetime DESC NULLS LAST
        LIMIT 50;
    `;

    const { rows } = await pool.query(query, [
        employee.user_name,
        date,
        startDate,
        endDate
    ]);

    // Calculate duration totals server-side.

    let completedMinutes = 0;
    let inProgressMinutes = 0;
    let pendingMinutes = 0;
    let unparsedDurationCount = 0;

    for (const report of rows) {
        const minutes = parseDurationToMinutes(
            report.duration
        );

        if (minutes === null) {
            unparsedDurationCount++;
            continue;
        }

        const status = String(report.status || "")
            .trim()
            .toLowerCase();

        if (status === "completed") {
            completedMinutes += minutes;
        } else if (status === "in progress") {
            inProgressMinutes += minutes;
        } else if (status === "pending") {
            pendingMinutes += minutes;
        }
    }

    const totalMinutes =
        completedMinutes +
        inProgressMinutes +
        pendingMinutes;

    return {
        employee: {
            username: employee.user_name,
            employee_id: employee.employee_id
        },

        date_range: {
            start_date: startDate,
            end_date: endDate,
            specific_date: date
        },

        summary: {
            total_reports: rows.length,
            completed_minutes: completedMinutes,
            in_progress_minutes: inProgressMinutes,
            pending_minutes: pendingMinutes,
            total_minutes: totalMinutes,
            unparsed_duration_count: unparsedDurationCount
        },

        reports: rows
    };
};


// ==========================================
// 8. Submit employee daily work report
// ==========================================

export const submitEmployeeWorkReport = async (
    username,
    workDetails,
    status,
    duration
) => {
    const employee = await getEmployeeProfile(username);

    const query = `
        INSERT INTO working_date_history (
            work_datetime,
            user_name,
            employee_id,
            work_details,
            status,
            duration,
            department,
            unit,
            division
        )
        VALUES (
            CURRENT_TIMESTAMP,
            $1, $2, $3, $4, $5, $6, $7, $8
        )
        RETURNING
            id,
            work_datetime,
            user_name,
            employee_id,
            work_details,
            status,
            duration,
            department,
            unit,
            division;
    `;

    const values = [
        employee.user_name,
        employee.employee_id,
        workDetails,
        status,
        duration,
        employee.department,
        employee.unit,
        employee.division
    ];

    const { rows } = await pool.query(query, values);

    return rows[0];
};


// ==========================================
// 9. Retrieve work reports for administrators
// ==========================================

export const getAdminWorkReports = async (
    username,
    filters = {}
) => {
    const admin = await getAdminProfile(username);

    const { date, department, employee } = filters;

    const conditions = [];
    const values = [];

    if (admin.role === "admin") {
        values.push(admin.department);
        conditions.push(`department = $${values.length}`);

        values.push(admin.unit);
        conditions.push(`unit = $${values.length}`);

        values.push(admin.division);
        conditions.push(`division = $${values.length}`);
    }

    else if (admin.role === "div_admin") {
        values.push(admin.division);
        conditions.push(`division = $${values.length}`);
    }

    if (date) {
        values.push(date);

        conditions.push(
            `work_datetime::date = $${values.length}::date`
        );
    }

    if (department) {
        values.push(department);

        conditions.push(
            `department = $${values.length}`
        );
    }

    if (employee) {
        values.push(employee);

        conditions.push(
            `LOWER(TRIM(user_name)) = LOWER(TRIM($${values.length}))`
        );
    }

    const whereClause = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";

    const query = `
        SELECT
            id,
            user_name,
            employee_id,
            work_datetime,
            work_details,
            status,
            duration,
            department,
            unit,
            division
        FROM working_date_history
        ${whereClause}
        ORDER BY work_datetime DESC NULLS LAST
        LIMIT 100;
    `;

    const { rows } = await pool.query(query, values);

    return {
        admin: {
            username: admin.user_name,
            role: admin.role,
            department: admin.department,
            unit: admin.unit,
            division: admin.division
        },

        summary: {
            total_reports: rows.length
        },

        reports: rows
    };
};