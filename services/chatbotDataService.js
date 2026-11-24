// =====================================================================
// Chatbot data-analysis service (READ-ONLY)
//
// Answers administrator questions such as:
//   - "Rahul ke pending tasks kya hain?"
//   - "Last 7 days mein kitne tasks complete hue?"
//   - "Sabse zyada overdue kis employee ke hain?"
//
// Every query runs through `chatbotReadOnlyDb`, whose connections are
// read-only at the PostgreSQL level. All user-provided values are passed as
// query parameters (never string-concatenated into SQL).
//
// Status rules mirror the existing dashboard (dashboardController.js):
//   - Leave / Inactive rows are excluded.
//   - pending   = submission_date IS NULL (includes overdue + due today)
//   - overdue   = pending AND task date < today
//   - completed = submitted (checklist additionally requires status = 'yes')
//   - not_done  = checklist submitted with status 'no' / NULL
// Date used: checklist & maintenance -> task_start_date, delegation -> planned_date
// =====================================================================

import pool from "../config/chatbotReadOnlyDb.js";

export const ADMIN_ROLES = ["super_admin", "div_admin", "admin"];

const MAX_RANGE_DAYS = 366;
const MAX_LIST_LIMIT = 50;
const MAX_EMPLOYEE_ROWS = 50;

// Same SQL as utils/activeUsers.js#activeDoerClause (the dashboard applies it to checklist).
const ACTIVE_DOER_SQL = `EXISTS (
            SELECT 1 FROM users au
            WHERE LOWER(TRIM(au.user_name)) = LOWER(TRIM(t.name))
              AND LOWER(COALESCE(au.status::text, 'active')) = 'active')`;

const CHECKLIST_PLANNED = "NULLIF(TRIM(t.planned_date), '')::timestamp";

// One entry per UNION branch. Each branch is normalised to the same columns.
// "on time" rules are copied from dashboardController.getDashboardSummaryCounts:
//   checklist   -> completed AND submission date <= planned date
//   delegation  -> submitted AND color_code_for = 1
//   maintenance -> submitted AND status = 'Done'
// Like the dashboard, the checklist type also counts completed daily work
// reports (working_date_history) as completed, on-time checklist entries.
const TASK_BRANCHES = [
    {
        taskType: "checklist",
        source: "checklist",
        from: "checklist t",
        dateCol: "t.task_start_date",
        hasTimeZone: false,
        activeDoerOnly: true,
        cols: {
            taskId: "t.task_id::text",
            description: "t.task_description",
            givenBy: "t.given_by",
            frequency: "t.frequency",
            planned: CHECKLIST_PLANNED,
            submission: "t.submission_date",
            completed: "t.submission_date IS NOT NULL AND LOWER(COALESCE(t.status::text, '')) = 'yes'",
            notDone: "t.submission_date IS NOT NULL AND (t.status IS NULL OR LOWER(t.status::text) = 'no')",
            onTime:
                "t.submission_date IS NOT NULL AND LOWER(COALESCE(t.status::text, '')) = 'yes' " +
                `AND ${CHECKLIST_PLANNED} IS NOT NULL AND t.submission_date::date <= ${CHECKLIST_PLANNED}::date`,
            delay: "t.delay::text",
            remarks: "t.remark",
            approval: "t.admin_done",
            submittedBy: "t.submitted_by",
            approvedBy: "t.approved_by",
            machine: "NULL",
            extendCount: "NULL"
        }
    },
    {
        taskType: "checklist",
        source: "work_report",
        from: `(
            SELECT w.id, w.user_name AS name, w.department, w.unit, w.division,
                   w.work_details, w.assign_by, w.work_datetime, w.status
            FROM working_date_history w
            WHERE LOWER(COALESCE(w.status, '')) = 'completed'
        ) t`,
        dateCol: "t.work_datetime",
        hasTimeZone: false,
        activeDoerOnly: true,
        cols: {
            taskId: "'WR-' || t.id::text",
            description: "t.work_details",
            givenBy: "t.assign_by",
            frequency: "'DAILY'",
            planned: "t.work_datetime",
            submission: "t.work_datetime",
            completed: "TRUE",
            notDone: "FALSE",
            onTime: "TRUE",
            delay: "'00:00:00'",
            remarks: "NULL",
            approval: "NULL",
            submittedBy: "t.name",
            approvedBy: "NULL",
            machine: "NULL",
            extendCount: "NULL"
        }
    },
    {
        taskType: "delegation",
        source: "delegation",
        from: `delegation t
            LEFT JOIN (
                SELECT
                    task_id,
                    COUNT(*) FILTER (WHERE status::text = 'extend')::int AS extend_count,
                    (ARRAY_AGG(admin_done ORDER BY created_at DESC)
                        FILTER (WHERE status::text = 'completed'))[1] AS approval,
                    (ARRAY_AGG(approved_by ORDER BY created_at DESC)
                        FILTER (WHERE status::text = 'completed'))[1] AS approved_by
                FROM delegation_done
                GROUP BY task_id
            ) dd ON dd.task_id = t.task_id`,
        dateCol: "t.planned_date",
        hasTimeZone: false,
        activeDoerOnly: false,
        cols: {
            taskId: "t.task_id::text",
            description: "t.task_description",
            givenBy: "t.given_by",
            frequency: "t.frequency",
            planned: "t.planned_date",
            submission: "t.submission_date",
            completed: "t.submission_date IS NOT NULL",
            notDone: "FALSE",
            onTime: "t.submission_date IS NOT NULL AND t.color_code_for = 1",
            delay: "t.delay::text",
            remarks: "t.remarks",
            approval: "dd.approval",
            submittedBy: "t.submitted_by",
            approvedBy: "dd.approved_by",
            machine: "NULL",
            extendCount: "COALESCE(dd.extend_count, 0)"
        }
    },
    {
        taskType: "maintenance",
        source: "maintenance",
        from: "maintenance_tasks t",
        dateCol: "t.task_start_date",
        // Maintenance dates are stored as "<date> 23:59 UTC" (= 05:29 IST next day),
        // so the task date is the UTC date - the same date the dashboard uses.
        hasTimeZone: true,
        dateZone: "UTC",
        activeDoerOnly: false,
        cols: {
            taskId: "t.id::text",
            description: "t.task_description",
            givenBy: "t.given_by",
            frequency: "t.frequency",
            planned: "(t.planned_date AT TIME ZONE 'UTC')",
            submission: "(t.submission_date AT TIME ZONE 'Asia/Kolkata')",
            completed: "t.submission_date IS NOT NULL",
            notDone: "FALSE",
            // Chatbot-only rule: the dashboard's rule (status = 'Done') never matches
            // because maintenance status is yes / no / Pending / Leave, so it always
            // shows 0. Here: submitted on or before the planned date (like checklist).
            onTime:
                "t.submission_date IS NOT NULL AND t.planned_date IS NOT NULL " +
                "AND (t.submission_date AT TIME ZONE 'UTC')::date <= (t.planned_date AT TIME ZONE 'UTC')::date",
            delay: "t.delay",
            remarks: "t.remarks",
            approval: "t.admin_done",
            submittedBy: "t.submitted_by",
            approvedBy: "t.approved_by",
            machine: "t.machine_name",
            extendCount: "NULL"
        }
    }
];

const TASK_TYPES = ["all", ...new Set(TASK_BRANCHES.map((b) => b.taskType))];
const STATUS_FILTERS = [
    "all", "pending", "overdue", "due_today", "completed", "not_done",
    "on_time", "late", "extended"
];
const SORT_FIELDS = [
    "pending", "overdue", "completed", "total", "completion_rate", "on_time", "late", "extended"
];


// =====================================================================
// Date helpers (IST)
// =====================================================================

export const getISTToday = () => {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).formatToParts(new Date());

    const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
    return `${v.year}-${v.month}-${v.day}`;
};

const isValidDate = (date) => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return false;
    }
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};

const daysBetween = (a, b) =>
    Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

const resolveDateRange = (args = {}) => {
    const today = getISTToday();
    const startDate = args.start_date || `${today.slice(0, 8)}01`;
    const endDate = args.end_date || today;

    if (!isValidDate(startDate) || !isValidDate(endDate)) {
        throw new Error("Invalid date. Use YYYY-MM-DD format.");
    }
    if (startDate > endDate) {
        throw new Error("start_date cannot be after end_date.");
    }
    if (daysBetween(startDate, endDate) > MAX_RANGE_DAYS) {
        throw new Error(`Date range cannot be longer than ${MAX_RANGE_DAYS} days.`);
    }

    return { startDate, endDate, today };
};

const pickEnum = (value, allowed, fallback, label) => {
    if (value === undefined || value === null || value === "") return fallback;
    const normalized = String(value).toLowerCase().trim();
    if (!allowed.includes(normalized)) {
        throw new Error(`Invalid ${label}. Allowed: ${allowed.join(", ")}.`);
    }
    return normalized;
};

const cleanText = (value, max = 120) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (text.length > max) throw new Error("Filter value is too long.");
    return text;
};

const clampLimit = (value, fallback, max) => {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(n, max);
};

const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);


// =====================================================================
// Requester profile & role scope
// =====================================================================

export const getRequesterProfile = async (username) => {
    const { rows } = await pool.query(
        `SELECT user_name, role, department, unit, division, designation
         FROM users
         WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
           AND status::text = 'active'
         LIMIT 1`,
        [username]
    );

    if (rows.length === 0) return null;

    return {
        ...rows[0],
        role: String(rows[0].role || "").toLowerCase()
    };
};

const assertAdmin = (profile) => {
    if (!profile || !ADMIN_ROLES.includes(profile.role)) {
        const error = new Error("Administrator access required for organisation-wide data.");
        error.statusCode = 403;
        throw error;
    }
};

// Builds the WHERE fragment that limits rows to what this admin may see,
// using the same rules as the dashboard:
//   super_admin -> everything
//   div_admin   -> own unit + division
//   admin       -> own unit + division + department(s)
const buildScope = (profile, params, alias = "t") => {
    const clauses = [];
    const add = (value) => {
        params.push(value);
        return `$${params.length}`;
    };

    if (profile.role === "div_admin" || profile.role === "admin") {
        clauses.push(`LOWER(TRIM(${alias}.unit)) = LOWER(TRIM(${add(profile.unit || "")}))`);
        clauses.push(`LOWER(TRIM(${alias}.division)) = LOWER(TRIM(${add(profile.division || "")}))`);
    }

    if (profile.role === "admin") {
        const departments = String(profile.department || "")
            .split(",")
            .map((d) => d.trim().toLowerCase())
            .filter(Boolean);
        clauses.push(`LOWER(TRIM(${alias}.department)) = ANY(${add(departments)})`);
    }

    return clauses;
};

const describeScope = (profile) => {
    if (profile.role === "super_admin") return "All units, divisions and departments";
    if (profile.role === "div_admin") return `Unit: ${profile.unit || "-"}, Division: ${profile.division || "-"}`;
    return `Unit: ${profile.unit || "-"}, Division: ${profile.division || "-"}, Department(s): ${profile.department || "-"}`;
};


// =====================================================================
// Employee name resolution
// =====================================================================

// Distinct doer names, taken from the users table AND the task tables
// (tasks can belong to people who are no longer in / renamed in `users`).
const employeeNamesSql = (scopeFor, nameCondition) => `
    SELECT DISTINCT ON (LOWER(TRIM(n.name))) TRIM(n.name) AS name, n.department
    FROM (
        SELECT u.user_name AS name, u.department FROM users u
        WHERE ${nameCondition("u.user_name")}${scopeFor("u")}
        UNION ALL
        SELECT t.name, t.department FROM checklist t
        WHERE ${nameCondition("t.name")}${scopeFor("t")}
        UNION ALL
        SELECT t.name, t.department FROM delegation t
        WHERE ${nameCondition("t.name")}${scopeFor("t")}
        UNION ALL
        SELECT t.name, t.department FROM maintenance_tasks t
        WHERE ${nameCondition("t.name")}${scopeFor("t")}
    ) n
    WHERE n.name IS NOT NULL AND TRIM(n.name) <> ''
    ORDER BY LOWER(TRIM(n.name))
    LIMIT 10`;

// Turns a (possibly partial) name into exactly one employee name.
// Returns { name } on success, or { error, candidates } when not resolvable.
const resolveEmployee = async (rawName, profile) => {
    const name = cleanText(rawName);
    if (!name) return { name: null };

    const lookup = async (value, nameCondition) => {
        const params = [];
        // Scope placeholders are identical for every alias, so build them once.
        const scopeU = buildScope(profile, params, "ALIAS");
        params.push(value);
        const valueP = `$${params.length}`;
        const scopeFor = (alias) =>
            scopeU.length ? ` AND ${scopeU.join(" AND ").replaceAll("ALIAS.", `${alias}.`)}` : "";

        const { rows } = await pool.query(
            employeeNamesSql(scopeFor, (col) => nameCondition(col, valueP)),
            params
        );
        return rows;
    };

    const exact = await lookup(name, (col, p) => `LOWER(TRIM(${col})) = LOWER(TRIM(${p}))`);
    if (exact.length) return { name: exact[0].name };

    const partial = await lookup(`%${escapeLike(name)}%`, (col, p) => `${col} ILIKE ${p}`);

    if (partial.length === 1) return { name: partial[0].name };

    if (partial.length > 1) {
        return {
            error: `Multiple employees match "${name}". Ask the user which one they mean.`,
            candidates: partial
        };
    }

    return {
        error: `No employee named "${name}" was found${profile.role === "super_admin" ? "" : " within your access scope"}.`,
        candidates: []
    };
};


// =====================================================================
// Department name resolution
// =====================================================================

// "Operations", "operation dept", "OPERATION" -> "operation"
const normalizeDept = (value) =>
    String(value || "")
        .toLowerCase()
        .replace(/\b(department|dept|deptt|team|section)\b/g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .trim()
        .split(" ")
        .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
        .join(" ");

// Maps a user-typed department to the exact name stored in the database.
// Returns { department } on success, or { error, candidates } when not resolvable.
const resolveDepartment = async (rawDepartment, profile) => {
    const wanted = cleanText(rawDepartment);
    if (!wanted) return { department: null };

    const params = [];
    const scope = buildScope(profile, params, "ALIAS");
    const scopeFor = (alias) =>
        scope.length ? ` AND ${scope.join(" AND ").replaceAll("ALIAS.", `${alias}.`)}` : "";

    const { rows } = await pool.query(
        `SELECT DISTINCT TRIM(d.department) AS department
         FROM (
             SELECT u.department FROM users u WHERE TRUE${scopeFor("u")}
             UNION ALL SELECT t.department FROM checklist t WHERE TRUE${scopeFor("t")}
             UNION ALL SELECT t.department FROM delegation t WHERE TRUE${scopeFor("t")}
             UNION ALL SELECT t.department FROM maintenance_tasks t WHERE TRUE${scopeFor("t")}
         ) d
         WHERE d.department IS NOT NULL AND TRIM(d.department) <> ''`,
        params
    );

    const names = rows.map((r) => r.department);
    const exact = names.find((n) => n.toLowerCase() === wanted.toLowerCase());
    if (exact) return { department: exact };

    const target = normalizeDept(wanted);
    if (!target) return { department: wanted };

    // Case variations of one name count as a single department.
    const uniqueByLower = (list) => [...new Map(list.map((n) => [n.toLowerCase(), n])).values()];

    const same = uniqueByLower(names.filter((n) => normalizeDept(n) === target));
    if (same.length === 1) return { department: same[0] };

    const partial = uniqueByLower(
        names.filter((n) => {
            const norm = normalizeDept(n);
            return norm && (norm.includes(target) || target.includes(norm));
        })
    );
    if (partial.length === 1) return { department: partial[0] };

    return {
        error: partial.length
            ? `Multiple departments match "${wanted}". Ask the user which one they mean.`
            : `No department named "${wanted}" was found. Use list_departments to show valid names.`,
        candidates: (same.length ? same : partial).slice(0, 15)
    };
};


// =====================================================================
// Unified task query builder
// =====================================================================

// Produces a CTE named `tasks` that normalises the selected task tables into
// one shape, already filtered by date range, role scope and optional filters.
const buildTasksCte = (profile, filters) => {
    const { taskType, startDate, endDate, employee, department, unit, division } = filters;

    const params = [];
    const add = (value) => {
        params.push(value);
        return `$${params.length}`;
    };

    const startP = add(startDate);
    const endP = add(endDate);

    // Shared filters (same placeholders reused in every UNION branch)
    const shared = buildScope(profile, params);
    if (employee) shared.push(`LOWER(TRIM(t.name)) = LOWER(TRIM(${add(employee)}))`);
    if (department) shared.push(`LOWER(TRIM(t.department)) = LOWER(TRIM(${add(department)}))`);
    if (unit) shared.push(`LOWER(TRIM(t.unit)) = LOWER(TRIM(${add(unit)}))`);
    if (division) shared.push(`LOWER(TRIM(t.division)) = LOWER(TRIM(${add(division)}))`);

    const selected = TASK_BRANCHES.filter(
        (b) => taskType === "all" || b.taskType === taskType
    );

    const branches = selected.map((b) => {
        const c = b.cols;
        const col = b.dateCol;
        const dateExpr = b.hasTimeZone
            ? `(${col} AT TIME ZONE '${b.dateZone || "Asia/Kolkata"}')::date`
            : `${col}::date`;
        // Range on the raw column for timestamp tables keeps it index-friendly.
        const rangeSql = b.hasTimeZone
            ? `${dateExpr} BETWEEN ${startP}::date AND ${endP}::date`
            : `${col} >= ${startP}::date AND ${col} < (${endP}::date + 1)`;

        const where = [
            "(t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))",
            rangeSql,
            ...(b.activeDoerOnly ? [ACTIVE_DOER_SQL] : []),
            ...shared
        ].join("\n          AND ");

        return `
        SELECT
            '${b.taskType}'::text AS task_type,
            '${b.source}'::text AS source,
            (${c.taskId})::text AS task_id,
            TRIM(t.name) AS employee,
            t.department,
            t.unit,
            t.division,
            (${c.description})::text AS task_description,
            (${c.givenBy})::text AS given_by,
            (${c.frequency})::text AS frequency,
            ${dateExpr} AS task_date,
            (${c.planned})::timestamp AS planned_at,
            (${c.submission})::timestamp AS submission_date,
            COALESCE(${c.completed}, FALSE) AS is_completed,
            COALESCE(${c.notDone}, FALSE) AS is_not_done,
            COALESCE(${c.onTime}, FALSE) AS is_on_time,
            t.status::text AS raw_status,
            (${c.delay})::text AS delay,
            (${c.remarks})::text AS remarks,
            (${c.approval})::text AS approval,
            (${c.submittedBy})::text AS submitted_by,
            (${c.approvedBy})::text AS approved_by,
            (${c.machine})::text AS machine_name,
            (${c.extendCount})::int AS extend_count
        FROM ${b.from}
        WHERE ${where}`;
    });

    return { cte: `WITH tasks AS (${branches.join("\n        UNION ALL\n")}\n)`, params, add };
};

const countColumns = (todayP) => `
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE is_completed)::int AS completed,
    COUNT(*) FILTER (WHERE submission_date IS NULL)::int AS pending,
    COUNT(*) FILTER (WHERE submission_date IS NULL AND task_date < ${todayP}::date)::int AS overdue,
    COUNT(*) FILTER (WHERE submission_date IS NULL AND task_date = ${todayP}::date)::int AS due_today,
    COUNT(*) FILTER (WHERE is_not_done)::int AS not_done,
    COUNT(*) FILTER (WHERE is_completed AND is_on_time)::int AS on_time,
    COUNT(*) FILTER (WHERE is_completed AND NOT is_on_time)::int AS late,
    COUNT(*) FILTER (WHERE extend_count > 0)::int AS extended`;

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

// on_time_rate_percent = on_time / completed, the same ratio as the dashboard's "On Time" card.
const withRate = (row) => ({
    ...row,
    completion_rate_percent: pct(row.completed, row.total),
    on_time_rate_percent: pct(row.on_time, row.completed)
});

const readCommonFilters = async (args, profile) => {
    const taskType = pickEnum(args.task_type, TASK_TYPES, "all", "task_type");
    const { startDate, endDate, today } = resolveDateRange(args);

    let employee = null;
    if (args.employee_name) {
        const resolved = await resolveEmployee(args.employee_name, profile);
        if (resolved.error) return { failure: { success: false, message: resolved.error, candidates: resolved.candidates } };
        employee = resolved.name;
    }

    const dept = await resolveDepartment(args.department, profile);
    if (dept.error) return { failure: { success: false, message: dept.error, candidates: dept.candidates } };

    return {
        filters: {
            taskType,
            startDate,
            endDate,
            today,
            employee,
            department: dept.department,
            unit: profile.role === "super_admin" ? cleanText(args.unit) : null,
            division: profile.role === "super_admin" ? cleanText(args.division) : null
        }
    };
};

const describeFilters = (f) => ({
    task_type: f.taskType,
    start_date: f.startDate,
    end_date: f.endDate,
    today: f.today,
    employee: f.employee || "all",
    department: f.department || "all",
    ...(f.unit ? { unit: f.unit } : {}),
    ...(f.division ? { division: f.division } : {})
});


// =====================================================================
// TOOL 1: Task summary counts
// =====================================================================

export const getTaskSummary = async (args, profile) => {
    assertAdmin(profile);
    const { filters, failure } = await readCommonFilters(args, profile);
    if (failure) return failure;

    const { cte, params, add } = buildTasksCte(profile, filters);
    const todayP = add(filters.today);

    const { rows } = await pool.query(
        `${cte}
        SELECT task_type, ${countColumns(todayP)}
        FROM tasks
        GROUP BY task_type
        ORDER BY task_type`,
        params
    );

    const empty = {
        total: 0, completed: 0, pending: 0, overdue: 0, due_today: 0, not_done: 0,
        on_time: 0, late: 0, extended: 0
    };
    const combined = rows.reduce((acc, r) => {
        for (const k of Object.keys(empty)) acc[k] += r[k];
        return acc;
    }, { ...empty });

    return {
        success: true,
        filters: describeFilters(filters),
        access_scope: describeScope(profile),
        definitions:
            "pending = not yet submitted (includes overdue and due_today); overdue = pending with task date before today; completed = submitted (checklist: marked yes); not_done = checklist submitted as 'no'; on_time / late = completed tasks done on time / late (checklist and maintenance: submitted on or before the planned date; delegation: color code 1). NOTE: the dashboard currently shows maintenance On Time as 0 because its rule checks a status value that never occurs; the chatbot's maintenance on-time is the real figure, so it will differ from the dashboard for maintenance only; on_time_rate_percent = on_time / completed (same as the dashboard On Time %); extended = delegation tasks that were extended at least once. Checklist counts include completed daily work reports, exactly like the dashboard.",
        overall: withRate(combined),
        by_task_type: rows.map(withRate)
    };
};


// =====================================================================
// TOOL 2: Employee-wise breakdown
// =====================================================================

export const getEmployeeWiseSummary = async (args, profile, { maxLimit = MAX_EMPLOYEE_ROWS } = {}) => {
    assertAdmin(profile);
    const { filters, failure } = await readCommonFilters({ ...args, employee_name: null }, profile);
    if (failure) return failure;

    const sortBy = pickEnum(args.sort_by, SORT_FIELDS, "pending", "sort_by");
    const limit = clampLimit(args.limit, 15, maxLimit);

    const { cte, params, add } = buildTasksCte(profile, filters);
    const todayP = add(filters.today);
    const limitP = add(limit);

    const orderSql = sortBy === "completion_rate"
        ? "(completed::numeric / NULLIF(total, 0)) DESC NULLS LAST, total DESC"
        : `${sortBy} DESC, total DESC`;

    const { rows } = await pool.query(
        `${cte},
        per_employee AS (
            SELECT employee, MAX(department) AS department, ${countColumns(todayP)}
            FROM tasks
            WHERE employee IS NOT NULL AND employee <> ''
            GROUP BY employee
        )
        SELECT *, COUNT(*) OVER ()::int AS employee_count
        FROM per_employee
        ORDER BY ${orderSql}
        LIMIT ${limitP}`,
        params
    );

    return {
        success: true,
        filters: describeFilters(filters),
        access_scope: describeScope(profile),
        export_filters: { ...describeFilters(filters), sort_by: sortBy },
        sorted_by: sortBy,
        employees_with_tasks: rows[0]?.employee_count ?? 0,
        showing: rows.length,
        employees: rows.map(({ employee_count, ...r }) => withRate(r))
    };
};


// =====================================================================
// TOOL 3: List individual tasks
// =====================================================================

const STATUS_SQL = {
    all: "TRUE",
    pending: "submission_date IS NULL",
    overdue: "submission_date IS NULL AND task_date < $TODAY::date",
    due_today: "submission_date IS NULL AND task_date = $TODAY::date",
    completed: "is_completed",
    not_done: "is_not_done",
    on_time: "is_completed AND is_on_time",
    late: "is_completed AND NOT is_on_time",
    extended: "extend_count > 0"
};

// Drops null / empty fields so the AI gets compact rows.
const compactRow = (row) =>
    Object.fromEntries(
        Object.entries(row).filter(([, v]) => v !== null && v !== undefined && v !== "")
    );

export const MAX_EXPORT_ROWS = 5000;

// `maxLimit` lets the export endpoint fetch more rows than the AI chat may.
export const listTasks = async (args, profile, { maxLimit = MAX_LIST_LIMIT } = {}) => {
    assertAdmin(profile);
    const { filters, failure } = await readCommonFilters(args, profile);
    if (failure) return failure;

    const status = pickEnum(args.status, STATUS_FILTERS, "pending", "status");
    const limit = clampLimit(args.limit, 20, maxLimit);

    const { cte, params, add } = buildTasksCte(profile, filters);
    const todayP = add(filters.today);
    const limitP = add(limit);
    const statusSql = STATUS_SQL[status].replaceAll("$TODAY", todayP);

    const { rows } = await pool.query(
        `${cte}
        SELECT
            task_type,
            NULLIF(source, task_type) AS source,
            task_id, employee, department, task_description, given_by, frequency,
            to_char(task_date, 'YYYY-MM-DD') AS task_date,
            to_char(planned_at, 'YYYY-MM-DD HH24:MI') AS planned_date,
            to_char(submission_date, 'YYYY-MM-DD HH24:MI') AS submitted_at,
            CASE
                WHEN is_not_done THEN 'not_done'
                WHEN is_completed THEN 'completed'
                WHEN submission_date IS NOT NULL THEN 'submitted'
                WHEN raw_status = 'extend' THEN 'extended_pending'
                WHEN task_date < ${todayP}::date THEN 'overdue'
                WHEN task_date = ${todayP}::date THEN 'due_today'
                ELSE 'upcoming'
            END AS current_status,
            CASE WHEN is_completed THEN (CASE WHEN is_on_time THEN 'on_time' ELSE 'late' END) END AS timeliness,
            NULLIF(delay, '00:00:00') AS delay,
            NULLIF(extend_count, 0) AS times_extended,
            remarks, approval, submitted_by, approved_by, machine_name,
            COUNT(*) OVER ()::int AS total_matching
        FROM tasks
        WHERE ${statusSql}
        ORDER BY task_date DESC, employee
        LIMIT ${limitP}`,
        params
    );

    const totalMatching = rows[0]?.total_matching ?? 0;

    return {
        success: true,
        filters: { ...describeFilters(filters), status },
        access_scope: describeScope(profile),
        total_matching: totalMatching,
        showing: rows.length,
        note: totalMatching > rows.length
            ? `Only the latest ${rows.length} of ${totalMatching} matching tasks are listed. Use get_task_summary / get_employee_wise_summary for full counts.`
            : undefined,
        tasks: rows.map(({ total_matching, ...r }) => compactRow(r))
    };
};


// Converts the `filters` object returned by listTasks back into tool args.
// Used to re-run the same (already resolved) query for PDF / Excel export.
export const exportArgsFromFilters = (filters = {}) => {
    const val = (v) => (v && v !== "all" ? String(v) : undefined);

    return {
        task_type: val(filters.task_type),
        start_date: val(filters.start_date),
        end_date: val(filters.end_date),
        employee_name: val(filters.employee),
        department: val(filters.department),
        unit: val(filters.unit),
        division: val(filters.division),
        status: filters.status || "pending",
        sort_by: filters.sort_by
    };
};

// Re-runs a chat query with a high row limit for PDF / Excel download.
export const runExport = async (type, filters, profile) => {
    const args = exportArgsFromFilters(filters);

    if (type === "tasks") {
        return listTasks({ ...args, limit: MAX_EXPORT_ROWS }, profile, { maxLimit: MAX_EXPORT_ROWS });
    }

    if (type === "employee_summary") {
        return getEmployeeWiseSummary({ ...args, limit: 1000 }, profile, { maxLimit: 1000 });
    }

    if (type === "employees") {
        return findEmployees(
            { query: filters.query, department: filters.department, limit: MAX_EXPORT_ROWS },
            profile,
            { maxLimit: MAX_EXPORT_ROWS }
        );
    }

    throw new Error("Unsupported export type.");
};


// =====================================================================
// TOOL 4: Find employees by name
// =====================================================================

export const findEmployees = async (args, profile, { maxLimit = 100 } = {}) => {
    assertAdmin(profile);
    const query = cleanText(args.query, 80);
    const dept = await resolveDepartment(args.department, profile);
    if (dept.error) return { success: false, message: dept.error, candidates: dept.candidates };
    const department = dept.department;
    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), maxLimit);

    const params = [];
    const where = buildScope(profile, params, "u");

    if (query) {
        params.push(`%${escapeLike(query)}%`);
        where.push(`u.user_name ILIKE $${params.length}`);
    }
    if (department) {
        params.push(department);
        where.push(`LOWER(TRIM(u.department)) = LOWER(TRIM($${params.length}))`);
    }
    if (!query && !department) {
        throw new Error("Provide a name query or a department.");
    }

    params.push(limit);
    const { rows } = await pool.query(
        `SELECT u.user_name, u.employee_id, u.department, u.designation, u.unit, u.division,
                u.role, u.status::text AS status, COUNT(*) OVER()::int AS total_matching
         FROM users u
         WHERE ${where.join(" AND ")}
         ORDER BY (u.status::text = 'active') DESC, u.user_name
         LIMIT $${params.length}`,
        params
    );

    return {
        success: true,
        total_matching: rows[0]?.total_matching || 0,
        showing: rows.length,
        filters: { query: query || null, department: department || null },
        employees: rows.map(({ total_matching, ...r }) => r)
    };
};


// =====================================================================
// TOOL 5: List departments
// =====================================================================

export const listDepartments = async (args, profile) => {
    assertAdmin(profile);

    const params = [];
    const where = [
        "u.department IS NOT NULL",
        "TRIM(u.department) <> ''",
        "u.status::text = 'active'",
        ...buildScope(profile, params, "u")
    ];

    const { rows } = await pool.query(
        `SELECT TRIM(u.department) AS department, u.unit, u.division, COUNT(*)::int AS active_employees
         FROM users u
         WHERE ${where.join(" AND ")}
         GROUP BY TRIM(u.department), u.unit, u.division
         ORDER BY u.unit, u.division, department`,
        params
    );

    return { success: true, access_scope: describeScope(profile), departments: rows };
};


// Shared optional filters for the tools below: employee, department, unit, division.
// Returns { where, failure } with conditions on `alias` appended to `params`.
const buildPersonFilters = async (args, profile, params, alias, nameCol = "name") => {
    const where = buildScope(profile, params, alias);

    if (args.employee_name) {
        const resolved = await resolveEmployee(args.employee_name, profile);
        if (resolved.error) {
            return { failure: { success: false, message: resolved.error, candidates: resolved.candidates } };
        }
        params.push(resolved.name);
        where.push(`LOWER(TRIM(${alias}.${nameCol})) = LOWER(TRIM($${params.length}))`);
    }

    const dept = await resolveDepartment(args.department, profile);
    if (dept.error) {
        return { failure: { success: false, message: dept.error, candidates: dept.candidates } };
    }
    if (dept.department) {
        params.push(dept.department);
        where.push(`LOWER(TRIM(${alias}.department)) = LOWER(TRIM($${params.length}))`);
    }

    if (profile.role === "super_admin") {
        for (const key of ["unit", "division"]) {
            const value = cleanText(args[key]);
            if (value) {
                params.push(value);
                where.push(`LOWER(TRIM(${alias}.${key})) = LOWER(TRIM($${params.length}))`);
            }
        }
    }

    return { where, department: dept.department };
};


// =====================================================================
// TOOL 6: Extended delegation tasks (delegation_done, status 'extend')
// =====================================================================

const EXTENDED_STATUS = ["all", "pending", "completed"];

export const listExtendedDelegations = async (args, profile, { maxLimit = MAX_LIST_LIMIT } = {}) => {
    assertAdmin(profile);
    const { startDate, endDate, today } = resolveDateRange(args);
    const status = pickEnum(args.status, EXTENDED_STATUS, "all", "status");
    const limit = clampLimit(args.limit, 20, maxLimit);

    const params = [startDate, endDate];
    const filters = await buildPersonFilters(args, profile, params, "d");
    if (filters.failure) return filters.failure;

    const where = [...filters.where];
    if (status === "pending") where.push("d.submission_date IS NULL");
    if (status === "completed") where.push("d.submission_date IS NOT NULL");

    params.push(today);
    const todayP = `$${params.length}`;
    params.push(limit);
    const limitP = `$${params.length}`;

    // An extension is counted in the range by the date it was requested.
    const { rows } = await pool.query(
        `WITH ext AS (
            SELECT
                dd.task_id,
                COUNT(*)::int AS extend_count,
                MAX(dd.created_at) AS last_extended_at,
                (ARRAY_AGG(dd.next_extend_date ORDER BY dd.created_at DESC))[1] AS extended_to,
                (ARRAY_AGG(dd.reason ORDER BY dd.created_at DESC))[1] AS last_reason
            FROM delegation_done dd
            WHERE dd.status::text = 'extend'
              AND (dd.created_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN $1::date AND $2::date
            GROUP BY dd.task_id
        )
        SELECT
            d.task_id::text AS task_id,
            TRIM(d.name) AS employee,
            d.department,
            d.task_description,
            d.given_by,
            e.extend_count AS times_extended,
            to_char(e.last_extended_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI') AS last_extended_on,
            to_char(e.extended_to, 'YYYY-MM-DD HH24:MI') AS extended_to,
            e.last_reason AS extension_reason,
            to_char(d.planned_date, 'YYYY-MM-DD HH24:MI') AS current_planned_date,
            to_char(d.submission_date, 'YYYY-MM-DD HH24:MI') AS submitted_at,
            CASE
                WHEN d.submission_date IS NOT NULL THEN
                    CASE WHEN d.color_code_for = 1 THEN 'completed_on_time' ELSE 'completed_late' END
                WHEN d.planned_date::date < ${todayP}::date THEN 'overdue'
                WHEN d.status = 'extend' THEN 'extended_pending'
                ELSE 'pending'
            END AS current_status,
            COUNT(*) OVER ()::int AS total_matching,
            SUM(e.extend_count) OVER ()::int AS total_extensions,
            COUNT(*) FILTER (WHERE d.submission_date IS NULL) OVER ()::int AS still_pending
        FROM ext e
        JOIN delegation d ON d.task_id = e.task_id
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        ORDER BY e.last_extended_at DESC
        LIMIT ${limitP}`,
        params
    );

    const first = rows[0] || {};

    return {
        success: true,
        filters: {
            start_date: startDate,
            end_date: endDate,
            date_basis: "date the extension was requested",
            status,
            employee: args.employee_name || "all",
            department: filters.department || "all"
        },
        access_scope: describeScope(profile),
        extended_tasks: first.total_matching || 0,
        total_extensions: first.total_extensions || 0,
        still_pending: first.still_pending || 0,
        showing: rows.length,
        tasks: rows.map(({ total_matching, total_extensions, still_pending, ...r }) => compactRow(r))
    };
};


// =====================================================================
// TOOL 7: Employees' daily work reports (working_date_history)
// =====================================================================

const WORK_REPORT_STATUS = ["all", "completed", "in progress", "pending"];

export const getWorkReports = async (args, profile, { maxLimit = MAX_LIST_LIMIT } = {}) => {
    assertAdmin(profile);
    const { startDate, endDate } = resolveDateRange(args);
    const status = pickEnum(args.status, WORK_REPORT_STATUS, "all", "status");
    const limit = clampLimit(args.limit, 20, maxLimit);

    const params = [startDate, endDate];
    const filters = await buildPersonFilters(args, profile, params, "w", "user_name");
    if (filters.failure) return filters.failure;

    const where = [
        "w.work_datetime >= $1::date",
        "w.work_datetime < ($2::date + 1)",
        ...filters.where
    ];
    if (status !== "all") {
        params.push(status);
        where.push(`LOWER(TRIM(COALESCE(w.status, ''))) = $${params.length}`);
    }

    const whereSql = where.join(" AND ");

    const [summary, list] = await Promise.all([
        pool.query(
            `SELECT
                COUNT(*)::int AS total_reports,
                COUNT(DISTINCT LOWER(TRIM(w.user_name)))::int AS employees_reporting,
                COUNT(*) FILTER (WHERE LOWER(w.status) = 'completed')::int AS completed,
                COUNT(*) FILTER (WHERE LOWER(w.status) = 'in progress')::int AS in_progress,
                COUNT(*) FILTER (WHERE LOWER(w.status) = 'pending')::int AS pending,
                COUNT(*) FILTER (WHERE w.status IS NULL OR TRIM(w.status) = '')::int AS no_status
             FROM working_date_history w
             WHERE ${whereSql}`,
            params
        ),
        pool.query(
            `SELECT
                w.id::text AS report_id,
                to_char(w.work_datetime, 'YYYY-MM-DD HH24:MI') AS work_datetime,
                TRIM(w.user_name) AS employee,
                w.department,
                LEFT(w.work_details, 300) AS work_details,
                w.status,
                w.duration,
                w.assign_by
             FROM working_date_history w
             WHERE ${whereSql}
             ORDER BY w.work_datetime DESC NULLS LAST
             LIMIT $${params.length + 1}`,
            [...params, limit]
        )
    ]);

    return {
        success: true,
        filters: {
            start_date: startDate,
            end_date: endDate,
            status,
            employee: args.employee_name || "all",
            department: filters.department || "all"
        },
        access_scope: describeScope(profile),
        summary: summary.rows[0],
        showing: list.rows.length,
        reports: list.rows.map(compactRow)
    };
};
