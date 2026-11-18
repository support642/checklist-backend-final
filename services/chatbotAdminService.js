import pool from "../config/chatbotDb.js";

// Apply role-based organizational access
const getAdminScope = (admin) => {
    if (!admin?.role) {
        const error = new Error("Admin authorization required.");
        error.statusCode = 403;
        throw error;
    }

    const conditions = [];
    const values = [];

    if (admin.role === "admin") {
        if (!admin.unit || !admin.division || !admin.department) {
            const error = new Error("Admin organizational scope is incomplete.");
            error.statusCode = 403;
            throw error;
        }

        values.push(admin.unit, admin.division, admin.department);

        conditions.push(
            `unit = $1 AND division = $2 AND department = $3`
        );

    } else if (admin.role === "div_admin") {
        if (!admin.unit || !admin.division) {
            const error = new Error("Division admin scope is incomplete.");
            error.statusCode = 403;
            throw error;
        }

        values.push(admin.unit, admin.division);

        conditions.push(
            `unit = $1 AND division = $2`
        );

    } else if (admin.role !== "super_admin") {
        const error = new Error("Unauthorized admin role.");
        error.statusCode = 403;
        throw error;
    }

    return {
        whereClause: conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "",
        values
    };
};


// Retrieve individual admin work reports
export const getAdminWorkReports = async (admin) => {
    const { whereClause, values } = getAdminScope(admin);

    const query = `
        SELECT
            id,
            work_datetime,
            user_name,
            employee_id,
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
        summary: {
            total_reports: rows.length
        },
        reports: rows
    };
};


// Retrieve admin dashboard summary
export const getAdminDashboardSummary = async (admin) => {
    const { whereClause, values } = getAdminScope(admin);

    const query = `
        SELECT
            COUNT(*) AS total_reports_today,

            COUNT(DISTINCT user_name) AS employees_reported,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(status)) = 'completed'
            ) AS completed_reports,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(status)) = 'in progress'
            ) AS in_progress_reports,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(status)) = 'pending'
            ) AS pending_reports

        FROM working_date_history

        ${whereClause}
        ${whereClause ? "AND" : "WHERE"}
            work_datetime >= CURRENT_DATE
            AND work_datetime < CURRENT_DATE + INTERVAL '1 day';
    `;

    const { rows } = await pool.query(query, values);

    const summary = rows[0];

    return {
        date: new Date().toISOString().slice(0, 10),

        summary: {
            total_reports_today: Number(summary.total_reports_today),
            employees_reported: Number(summary.employees_reported),
            completed_reports: Number(summary.completed_reports),
            in_progress_reports: Number(summary.in_progress_reports),
            pending_reports: Number(summary.pending_reports)
        }
    };
};


// Retrieve department-wise reporting analytics
export const getDepartmentWiseAnalytics = async (admin) => {
    const { whereClause, values } = getAdminScope(admin);

    const query = `
        SELECT
            COALESCE(
                NULLIF(TRIM(department), ''),
                'Unassigned'
            ) AS department,

            COUNT(*) AS total_reports,

            COUNT(DISTINCT user_name) AS employees_reported,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(status)) = 'completed'
            ) AS completed_reports,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(status)) = 'in progress'
            ) AS in_progress_reports,

            COUNT(*) FILTER (
                WHERE LOWER(TRIM(status)) = 'pending'
            ) AS pending_reports

        FROM working_date_history

        ${whereClause}
        ${whereClause ? "AND" : "WHERE"}
            work_datetime >= CURRENT_DATE
            AND work_datetime < CURRENT_DATE + INTERVAL '1 day'

        GROUP BY department

        ORDER BY department;
    `;

    const { rows } = await pool.query(query, values);

    return {
        date: new Date().toISOString().slice(0, 10),
        total_departments: rows.length,
        departments: rows.map((row) => ({
            department: row.department,
            total_reports: Number(row.total_reports),
            employees_reported: Number(row.employees_reported),
            completed_reports: Number(row.completed_reports),
            in_progress_reports: Number(row.in_progress_reports),
            pending_reports: Number(row.pending_reports)
        }))
    };
};

// Retrieve consolidated task analytics for administrators
export const getAdminTaskAnalytics = async (admin) => {
    const { whereClause, values } = getAdminScope(admin);

    const query = `
        WITH task_records AS (

            -- Checklist tasks
            SELECT
                'checklist' AS source,
                unit,
                division,
                department,
                LOWER(TRIM(status::text)) AS status
            FROM checklist
            WHERE status IS NULL
                OR LOWER(TRIM(status::text)) NOT IN ('leave', 'inactive')

            UNION ALL

            -- Delegation tasks
            SELECT
                'delegation' AS source,
                unit,
                division,
                department,
                LOWER(TRIM(status::text)) AS status
            FROM delegation

            UNION ALL

            -- Maintenance tasks
            SELECT
                'maintenance_tasks' AS source,
                unit,
                division,
                department,
                LOWER(TRIM(status::text)) AS status
            FROM maintenance_tasks
            WHERE status IS NULL
                OR LOWER(TRIM(status::text)) <> 'leave'
        )

        SELECT
            source,

            COUNT(*) AS total_tasks,

            COUNT(*) FILTER (
                WHERE
                    (source IN ('checklist', 'maintenance_tasks')
                        AND status = 'yes')
                    OR
                    (source = 'delegation' AND status = 'done')
            ) AS completed_tasks,

            COUNT(*) FILTER (
                WHERE
                    (source IN ('checklist', 'maintenance_tasks')
                        AND status IN ('no', 'pending'))
                    OR
                    (source = 'delegation' AND status = 'pending')
            ) AS pending_tasks

        FROM task_records

        ${whereClause}

        GROUP BY source
        ORDER BY source;
    `;

    const { rows } = await pool.query(query, values);

    const sources = [
        'checklist',
        'delegation',
        'maintenance_tasks'
    ];

    const taskBreakdown = sources.map((source) => {
        const record = rows.find((row) => row.source === source);

        const total = Number(record?.total_tasks || 0);
        const completed = Number(record?.completed_tasks || 0);
        const pending = Number(record?.pending_tasks || 0);

        return {
            source,
            total_tasks: total,
            completed_tasks: completed,
            pending_tasks: pending,
            other_tasks: total - completed - pending
        };
    });

    const summary = taskBreakdown.reduce(
        (result, item) => {
            result.total_tasks += item.total_tasks;
            result.completed_tasks += item.completed_tasks;
            result.pending_tasks += item.pending_tasks;
            result.other_tasks += item.other_tasks;

            return result;
        },
        {
            total_tasks: 0,
            completed_tasks: 0,
            pending_tasks: 0,
            other_tasks: 0
        }
    );

    return {
        summary,
        task_breakdown: taskBreakdown
    };
};

// Retrieve employee-wise task analytics for administrators
export const getEmployeeWiseTaskAnalytics = async (admin) => {
    const { whereClause, values } = getAdminScope(admin);

    const query = `
        WITH task_records AS (

            SELECT
                'checklist' AS source,
                NULLIF(TRIM(name), '') AS assigned_name,
                unit,
                division,
                department,
                LOWER(TRIM(status::text)) AS status
            FROM checklist
            WHERE status IS NULL
                OR LOWER(TRIM(status::text)) NOT IN ('leave', 'inactive')

            UNION ALL

            SELECT
                'delegation' AS source,
                NULLIF(TRIM(name), '') AS assigned_name,
                unit,
                division,
                department,
                LOWER(TRIM(status::text)) AS status
            FROM delegation

            UNION ALL

            SELECT
                'maintenance_tasks' AS source,
                NULLIF(TRIM(name), '') AS assigned_name,
                unit,
                division,
                department,
                LOWER(TRIM(status::text)) AS status
            FROM maintenance_tasks
            WHERE status IS NULL
                OR LOWER(TRIM(status::text)) <> 'leave'
        ),

        scoped_tasks AS (
            SELECT *
            FROM task_records
            ${whereClause}
        ),

        employee_tasks AS (
            SELECT
                t.source,
                t.assigned_name,
                t.department,
                u.user_name,
                u.employee_id,
                u.designation,
                u.status AS employee_status,
                t.status AS task_status

            FROM scoped_tasks t

            LEFT JOIN users u
                ON LOWER(TRIM(u.user_name)) =
                   LOWER(TRIM(t.assigned_name))
        ),

        employee_source_summary AS (
            SELECT
                COALESCE(
                    user_name,
                    assigned_name,
                    'Unassigned'
                ) AS employee_name,

                user_name,
                employee_id,
                designation,
                employee_status,
                department,
                source,

                COUNT(*) AS total_tasks,

                COUNT(*) FILTER (
                    WHERE
                        (source IN ('checklist', 'maintenance_tasks')
                            AND task_status = 'yes')
                        OR
                        (source = 'delegation'
                            AND task_status = 'done')
                ) AS completed_tasks,

                COUNT(*) FILTER (
                    WHERE
                        (source IN ('checklist', 'maintenance_tasks')
                            AND task_status IN ('no', 'pending'))
                        OR
                        (source = 'delegation'
                            AND task_status = 'pending')
                ) AS pending_tasks

            FROM employee_tasks

            GROUP BY
                COALESCE(user_name, assigned_name, 'Unassigned'),
                user_name,
                employee_id,
                designation,
                employee_status,
                department,
                source
        )

        SELECT
            employee_name,
            user_name,
            employee_id,
            designation,
            employee_status,
            department,

            SUM(total_tasks) AS total_tasks,
            SUM(completed_tasks) AS completed_tasks,
            SUM(pending_tasks) AS pending_tasks,

            JSONB_AGG(
                JSONB_BUILD_OBJECT(
                    'source', source,
                    'total_tasks', total_tasks,
                    'completed_tasks', completed_tasks,
                    'pending_tasks', pending_tasks,
                    'other_tasks',
                        total_tasks - completed_tasks - pending_tasks
                )
                ORDER BY source
            ) AS task_breakdown

        FROM employee_source_summary

        GROUP BY
            employee_name,
            user_name,
            employee_id,
            designation,
            employee_status,
            department

        ORDER BY employee_name;
    `;

    const { rows } = await pool.query(query, values);

    const employees = rows.map((row) => {
        const total = Number(row.total_tasks);
        const completed = Number(row.completed_tasks);
        const pending = Number(row.pending_tasks);

        return {
            employee_name: row.employee_name,
            username: row.user_name,
            employee_id: row.employee_id,
            designation: row.designation,
            employee_status: row.employee_status,
            department: row.department,

            total_tasks: total,
            completed_tasks: completed,
            pending_tasks: pending,
            other_tasks: total - completed - pending,

            task_breakdown: row.task_breakdown
        };
    });

    return {
        total_employees: employees.length,
        employees
    };
};

// Retrieve paginated work reports within a date range
export const getAdminWorkReportsByDateRange = async (
    admin,
    {
        startDate,
        endDate,
        employeeUsername = null,
        page = 1,
        limit = 100
    }
) => {
    const { whereClause, values } = getAdminScope(admin);

    const isValidDate = (date) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) {
            return false;
        }

        const parsedDate = new Date(`${date}T00:00:00.000Z`);

        return (
            !Number.isNaN(parsedDate.getTime()) &&
            parsedDate.toISOString().slice(0, 10) === date
        );
    };

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
        const error = new Error(
            "Invalid date. Use YYYY-MM-DD format."
        );
        error.statusCode = 400;
        throw error;
    }

    if (startDate > endDate) {
        const error = new Error(
            "Start date cannot be after end date."
        );
        error.statusCode = 400;
        throw error;
    }

    if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 500
    ) {
        const error = new Error(
            "Invalid pagination. Page must be positive and limit must be between 1 and 500."
        );
        error.statusCode = 400;
        throw error;
    }

    if ((page - 1) * limit > Number.MAX_SAFE_INTEGER) {
        const error = new Error("Requested page is too large.");
        error.statusCode = 400;
        throw error;
    }

    const conditions = [];

    if (whereClause) {
        conditions.push(whereClause.replace(/^WHERE\s+/i, ""));
    }

    const queryValues = [...values];

    queryValues.push(startDate);
    const startDateParam = `$${queryValues.length}`;

    queryValues.push(endDate);
    const endDateParam = `$${queryValues.length}`;

    conditions.push(
        `work_datetime >= ${startDateParam}::date`
    );

    conditions.push(
        `work_datetime < (${endDateParam}::date + INTERVAL '1 day')`
    );

    if (employeeUsername) {
        queryValues.push(employeeUsername.trim());

        conditions.push(
            `LOWER(TRIM(user_name)) = LOWER(TRIM($${queryValues.length}))`
        );
    }

    const whereCondition = conditions.join(" AND ");

    // Count matching reports before pagination
    const countQuery = `
        SELECT COUNT(*) AS count
        FROM working_date_history
        WHERE ${whereCondition};
    `;

    const countResult = await pool.query(
        countQuery,
        queryValues
    );

    const totalCount = Number(
        countResult.rows[0]?.count || 0
    );

    // Retrieve only the requested page
    const offset = (page - 1) * limit;

    const dataQuery = `
        SELECT
            id,
            work_datetime,
            user_name,
            employee_id,
            work_details,
            status,
            duration,
            department,
            unit,
            division
        FROM working_date_history
        WHERE ${whereCondition}
        ORDER BY work_datetime DESC NULLS LAST, id DESC
        LIMIT $${queryValues.length + 1}
        OFFSET $${queryValues.length + 2};
    `;

    const dataValues = [...queryValues, limit, offset];

    const { rows } = await pool.query(
        dataQuery,
        dataValues
    );

    const totalPages = Math.ceil(totalCount / limit);

    return {
        filters: {
            start_date: startDate,
            end_date: endDate,
            employee: employeeUsername || "all"
        },

        pagination: {
            page,
            limit,
            total_count: totalCount,
            total_pages: totalPages,
            has_more: page < totalPages
        },

        summary: {
            total_reports: totalCount,
            reports_returned: rows.length
        },

        reports: rows
    };
};