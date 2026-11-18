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

const TASK_SOURCES = {
    checklist: {
        table: "checklist",
        idCol: "task_id",
        dateCol: "task_start_date",
        hasTimeZone: false,
        completedExtra: "AND LOWER(COALESCE(t.status::text, '')) = 'yes'",
        notDone:
            "t.submission_date IS NOT NULL AND (t.status IS NULL OR LOWER(t.status::text) = 'no')"
    },
    delegation: {
        table: "delegation",
        idCol: "task_id",
        dateCol: "planned_date",
        hasTimeZone: false,
        completedExtra: "",
        notDone: "FALSE"
    },
    maintenance: {
        table: "maintenance_tasks",
        idCol: "id",
        dateCol: "task_start_date",
        hasTimeZone: true,
        completedExtra: "",
        notDone: "FALSE"
    }
};

const TASK_TYPES = ["all", ...Object.keys(TASK_SOURCES)];
const STATUS_FILTERS = ["all", "pending", "overdue", "due_today", "completed", "not_done"];
const SORT_FIELDS = ["pending", "overdue", "completed", "total", "completion_rate"];


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

    const sources = taskType === "all" ? Object.keys(TASK_SOURCES) : [taskType];

    const branches = sources.map((key) => {
        const s = TASK_SOURCES[key];
        const col = `t.${s.dateCol}`;
        const dateExpr = s.hasTimeZone ? `(${col} AT TIME ZONE 'Asia/Kolkata')::date` : `${col}::date`;
        // Range on the raw column for timestamp tables keeps it index-friendly.
        const rangeSql = s.hasTimeZone
            ? `${dateExpr} BETWEEN ${startP}::date AND ${endP}::date`
            : `${col} >= ${startP}::date AND ${col} < (${endP}::date + 1)`;

        const where = [
            "(t.status IS NULL OR LOWER(t.status::text) NOT IN ('leave', 'inactive'))",
            rangeSql,
            ...shared
        ].join("\n          AND ");

        return `
        SELECT
            '${key}'::text AS task_type,
            t.${s.idCol}::text AS task_id,
            TRIM(t.name) AS employee,
            t.department,
            t.unit,
            t.division,
            t.task_description,
            t.given_by,
            t.frequency,
            ${dateExpr} AS task_date,
            t.submission_date,
            (t.submission_date IS NOT NULL ${s.completedExtra}) AS is_completed,
            (${s.notDone}) AS is_not_done
        FROM ${s.table} t
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
    COUNT(*) FILTER (WHERE is_not_done)::int AS not_done`;

const withRate = (row) => ({
    ...row,
    completion_rate_percent: row.total > 0 ? Math.round((row.completed / row.total) * 1000) / 10 : 0
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

    const empty = { total: 0, completed: 0, pending: 0, overdue: 0, due_today: 0, not_done: 0 };
    const combined = rows.reduce((acc, r) => {
        for (const k of Object.keys(empty)) acc[k] += r[k];
        return acc;
    }, { ...empty });

    return {
        success: true,
        filters: describeFilters(filters),
        access_scope: describeScope(profile),
        definitions:
            "pending = not yet submitted (includes overdue and due_today); overdue = pending with task date before today; completed = submitted (checklist: marked yes); not_done = checklist submitted as 'no'.",
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
    not_done: "is_not_done"
};

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
            task_type, task_id, employee, department, task_description, given_by, frequency,
            to_char(task_date, 'YYYY-MM-DD') AS task_date,
            to_char(submission_date, 'YYYY-MM-DD HH24:MI') AS submitted_at,
            CASE
                WHEN is_not_done THEN 'not_done'
                WHEN is_completed THEN 'completed'
                WHEN submission_date IS NOT NULL THEN 'submitted'
                WHEN task_date < ${todayP}::date THEN 'overdue'
                WHEN task_date = ${todayP}::date THEN 'due_today'
                ELSE 'upcoming'
            END AS current_status,
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
        tasks: rows.map(({ total_matching, ...r }) => r)
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
