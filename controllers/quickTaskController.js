import pool from "../config/db.js";

// ------------------------ FETCH CHECKLIST ------------------------
export const fetchChecklist = async (
  page = 0,
  pageSize = 50,
  nameFilter = "",
  freqFilter = "",
  userRole = "",
  userDept = "",
  userDiv = "",
  userName = "",
  search = ""
) => {
  try {
    const offset = page * pageSize;
    const params = [];
    let paramIndex = 1;

    let whereClause = "submission_date IS NULL";

    if (nameFilter) {
      whereClause += ` AND LOWER(name) = LOWER($${paramIndex++})`;
      params.push(nameFilter);
    }

    if (freqFilter) {
      whereClause += ` AND frequency = $${paramIndex++}`;
      params.push(freqFilter);
    }

    // Role-based filtering
    const role = userRole?.toLowerCase();
    if (role === 'admin' && userDept && userDiv) {
      whereClause += ` AND LOWER(division) = LOWER($${paramIndex++}) AND LOWER(department) = LOWER($${paramIndex++})`;
      params.push(userDiv, userDept);
    } else if (role === 'div_admin' && userDiv) {
      whereClause += ` AND LOWER(division) = LOWER($${paramIndex++})`;
      params.push(userDiv);
    } else if (role === 'user' && userName) {
      whereClause += ` AND LOWER(name) = LOWER($${paramIndex++})`;
      params.push(userName);
    }
    
    // ⭐ Database-level search filter
    if (search && search.trim()) {
      const searchVal = `%${search.toLowerCase()}%`;
      whereClause += ` AND (
        LOWER(name) LIKE $${paramIndex} OR
        LOWER(task_description) LIKE $${paramIndex} OR
        LOWER(department) LIKE $${paramIndex} OR
        LOWER(given_by) LIKE $${paramIndex} OR
        LOWER(unit) LIKE $${paramIndex} OR
        LOWER(division) LIKE $${paramIndex} OR
        LOWER(frequency) LIKE $${paramIndex} OR
        CAST(task_id AS TEXT) LIKE $${paramIndex}
      )`;
      params.push(searchVal);
      paramIndex++;
    }

    // ⭐ DISTINCT ON ensures uniqueness based on (name + task_description)
    const dataQuery = `
      SELECT DISTINCT ON (LOWER(name), LOWER(task_description))
        checklist.*,
        TO_CHAR(task_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') as task_start_date,
        TO_CHAR(planned_date::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as planned_date
      FROM checklist
      WHERE ${whereClause}
      ORDER BY LOWER(name), LOWER(task_description), checklist.task_start_date ASC
      LIMIT $${paramIndex++}
      OFFSET $${paramIndex}
    `;

    const dataParams = [...params, pageSize, offset];

    // Count unique rows
    const countQuery = `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (LOWER(name), LOWER(task_description))
          name, task_description
        FROM checklist
        WHERE ${whereClause}
      ) AS unique_tasks
    `;

    const [dataRes, countRes] = await Promise.all([
      pool.query(dataQuery, dataParams),
      pool.query(countQuery, params),
    ]);

    const total = parseInt(countRes.rows[0]?.count ?? 0, 10);

    return { data: dataRes.rows, total };

  } catch (err) {
    console.log(err);
    return { data: [], total: 0 };
  }
};



export const fetchDelegation = async (
  page = 0,
  pageSize = 50,
  nameFilter = "",
  freqFilter = "",
  userRole = "",
  userDept = "",
  userDiv = "",
  userName = "",
  deptFilter = "",
  divFilter = "",
  search = ""
) => {
  try {
    const offset = page * pageSize;
    const filters = ["submission_date IS NULL"];
    const params = [];
    let paramIndex = 1;

    if (nameFilter) {
      filters.push(`LOWER(name) = LOWER($${paramIndex++})`);
      params.push(nameFilter);
    }

    if (freqFilter) {
      filters.push(`frequency = $${paramIndex++}`);
      params.push(freqFilter);
    }

    if (deptFilter) {
      filters.push(`LOWER(department) = LOWER($${paramIndex++})`);
      params.push(deptFilter);
    }

    if (divFilter) {
      filters.push(`LOWER(division) = LOWER($${paramIndex++})`);
      params.push(divFilter);
    }

    // Role-based filtering
    const role = userRole?.toLowerCase();
    if (role === 'admin' && userDept && userDiv) {
      filters.push(`LOWER(division) = LOWER($${paramIndex++})`);
      params.push(userDiv);
      filters.push(`LOWER(department) = LOWER($${paramIndex++})`);
      params.push(userDept);
    } else if (role === 'div_admin' && userDiv) {
      filters.push(`LOWER(division) = LOWER($${paramIndex++})`);
      params.push(userDiv);
    } else if (role === 'user' && userName) {
      filters.push(`LOWER(name) = LOWER($${paramIndex++})`);
      params.push(userName);
    }
    
    // ⭐ Database-level search filter
    if (search && search.trim()) {
      const searchVal = `%${search.toLowerCase()}%`;
      filters.push(`(
        LOWER(name) LIKE $${paramIndex} OR
        LOWER(task_description) LIKE $${paramIndex} OR
        LOWER(department) LIKE $${paramIndex} OR
        LOWER(given_by) LIKE $${paramIndex} OR
        LOWER(unit) LIKE $${paramIndex} OR
        LOWER(division) LIKE $${paramIndex} OR
        LOWER(frequency) LIKE $${paramIndex} OR
        CAST(task_id AS TEXT) LIKE $${paramIndex}
      )`);
      params.push(searchVal);
      paramIndex++;
    }

    const whereClause = filters.join(" AND ");

    const dataQuery = `
      SELECT 
        delegation.*,
        TO_CHAR(task_start_date, 'YYYY-MM-DD"T"HH24:MI:SS') as task_start_date,
        TO_CHAR(planned_date::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS') as planned_date
      FROM delegation
      WHERE ${whereClause}
      ORDER BY delegation.planned_date ASC
      LIMIT $${paramIndex++}
      OFFSET $${paramIndex}
    `;

    const dataParams = [...params, pageSize, offset];

    const countQuery = `
      SELECT COUNT(*) AS count
      FROM delegation
      WHERE ${whereClause}
    `;

    const [dataRes, countRes] = await Promise.all([
      pool.query(dataQuery, dataParams),
      pool.query(countQuery, params),
    ]);

    const total = parseInt(countRes.rows[0]?.count ?? 0, 10);
    return { data: dataRes.rows, total };
  } catch (err) {
    console.log(err);
    return { data: [], total: 0 };
  }
};


export const deleteChecklistTasks = async (tasks) => {
  for (const t of tasks) {
    await pool.query(
      `
      DELETE FROM checklist
      WHERE name = $1
      AND task_description = $2
      AND submission_date IS NULL
      `,
      [t.name, t.task_description]
    );
  }

  return tasks;
};


export const deleteDelegationTasks = async (taskIds) => {
  await pool.query(
    `
    DELETE FROM delegation
    WHERE task_id = ANY($1)
    AND submission_date IS NULL
    `,
    [taskIds]
  );

  return taskIds;
};


export const updateChecklistTask = async (updatedTask, originalTask) => {
  try {
    // Sanitize enum values to match database enum ('yes', 'no')
    const sanitizedEnableReminder = updatedTask.enable_reminder
      ? updatedTask.enable_reminder.toLowerCase()
      : null;
    const sanitizedRequireAttachment = updatedTask.require_attachment
      ? updatedTask.require_attachment.toLowerCase()
      : null;

    const sql = `
      UPDATE checklist
      SET 
        department = $1,
        given_by = $2,
        name = $3,
        task_description = $4,
        enable_reminder = $5,
        require_attachment = $6,
        remark = $7,
        unit = $8,
        division = $9
      WHERE department = $10
      AND name = $11
      AND task_description = $12
      AND submission_date IS NULL
      RETURNING *;
    `;

    const values = [
      updatedTask.department,
      updatedTask.given_by,
      updatedTask.name,
      updatedTask.task_description,
      sanitizedEnableReminder,
      sanitizedRequireAttachment,
      updatedTask.remark,
      updatedTask.unit,
      updatedTask.division,

      originalTask.department,
      originalTask.name,
      originalTask.task_description
    ];

    const res = await pool.query(sql, values);
    return res.rows;
  } catch (err) {
    console.log(err);
    throw err;
  }
};

// ------------------------ FETCH USERS (UNIQUE NAMES) ------------------------
export const fetchUsers = async () => {
  try {
    const sql = `
      SELECT DISTINCT user_name
      FROM users
      WHERE user_name IS NOT NULL AND user_name <> ''
      ORDER BY user_name
    `;

    const { rows } = await pool.query(sql);
    // Return objects with user_name as expected by frontend
    return rows.map((r) => ({ user_name: r.user_name }));
  } catch (err) {
    console.log(err);
    return [];
  }
};

// ------------------------ GET UNIQUE TASK COUNTS ------------------------
export const getQuickTaskCounts = async (req, res) => {
  try {
    const { userRole, userDept, userDiv, userName } = req.body;
    const role = userRole?.toLowerCase();

    // BUILD WHERE CLAUSE
    let whereClause = "submission_date IS NULL";
    let params = [];
    let paramIndex = 1;

    if (role === 'admin' && userDept && userDiv) {
      whereClause += ` AND LOWER(division) = LOWER($${paramIndex++}) AND LOWER(department) = LOWER($${paramIndex++})`;
      params.push(userDiv, userDept);
    } else if (role === 'div_admin' && userDiv) {
      whereClause += ` AND LOWER(division) = LOWER($${paramIndex++})`;
      params.push(userDiv);
    } else if (role === 'user' && userName) {
      whereClause += ` AND LOWER(name) = LOWER($${paramIndex++})`;
      params.push(userName);
    }

    const checklistCountQuery = `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (LOWER(name), LOWER(task_description))
          name, task_description
        FROM checklist
        WHERE ${whereClause}
      ) AS unique_tasks
    `;

    // Delegation count usually has today's date filter if not specified, 
    // but for QuickTask view it shows all pending.
    // However, fetchDelegation uses a date filter. I'll match fetchDelegation's default (today).
    const delegationCountQuery = `
      SELECT COUNT(*) FROM (
        SELECT DISTINCT ON (LOWER(name), LOWER(task_description))
          name, task_description
        FROM delegation
        WHERE ${whereClause}
      ) AS unique_tasks
    `;

    const [checklistRes, delegationRes] = await Promise.all([
      pool.query(checklistCountQuery, params),
      pool.query(delegationCountQuery, params)
    ]);

    res.json({
      checklistCount: parseInt(checklistRes.rows[0]?.count ?? 0, 10),
      delegationCount: parseInt(delegationRes.rows[0]?.count ?? 0, 10)
    });

  } catch (err) {
    console.error("❌ Error fetching quick task counts:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
