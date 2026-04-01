import pool from "../../config/db.js";

/**
 * Create a new repair task
 */
export async function createRepairRequest(repairData) {
  const {
    filled_by,
    assigned_person,
    machine_name,
    issue_description,
    part_replaced,
    status,
    submission_date,
    remarks,
    bill_amount,
    vendor_name,
    work_photo_url,
    bill_copy_url,
    duration,
    audio_url,
    machine_department,
    machine_division
  } = repairData;

  const query = `
    INSERT INTO repair_tasks (
      filled_by, assigned_person, machine_name, issue_description, part_replaced,
      status, submission_date, remarks, bill_amount, vendor_name,
      work_photo_url, bill_copy_url, duration, audio_url,
      machine_department, machine_division
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *
  `;

  const values = [
    filled_by || null,
    assigned_person || null,
    machine_name || null,
    issue_description || null,
    part_replaced || null,
    status || 'Pending',
    submission_date || new Date().toISOString(),
    remarks || null,
    bill_amount || null,
    vendor_name || null,
    work_photo_url || null,
    bill_copy_url || null,
    duration || null,
    audio_url || null,
    machine_department || null,
    machine_division || null
  ];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

/**
 * Get all repair tasks with optional filters
 */
export async function getAllRepairRequests(filters = {}) {
  const { 
    status, 
    status_exclude,
    assigned_person, 
    machine_name, 
    filled_by, 
    machine_department, 
    machine_division,
    currentUser // { username, role }
  } = filters;
  
  let query = `SELECT * FROM repair_tasks WHERE 1=1`;
  const values = [];
  let paramIdx = 1;

  // Role-based visibility filtering
  if (currentUser && currentUser.role !== 'super_admin') {
    query += ` AND (filled_by = $${paramIdx++} OR assigned_person = $${paramIdx++})`;
    values.push(currentUser.username, currentUser.username);
  }

  if (status) {
    const statuses = status.split(',');
    if (statuses.length > 1) {
      const placeholders = statuses.map(() => `$${paramIdx++}`).join(',');
      query += ` AND status IN (${placeholders})`;
      values.push(...statuses);
    } else {
      query += ` AND status = $${paramIdx++}`;
      values.push(status);
    }
  }
  
  if (status_exclude) {
    // If status_exclude is a comma-separated string, handle it
    const excludes = status_exclude.split(',');
    excludes.forEach(ex => {
      query += ` AND status != $${paramIdx++}`;
      values.push(ex);
    });
  }

  if (assigned_person) {
    query += ` AND assigned_person = $${paramIdx++}`;
    values.push(assigned_person);
  }
  if (machine_name) {
    query += ` AND machine_name ILIKE $${paramIdx++}`;
    values.push(`%${machine_name}%`);
  }
  if (filled_by) {
    query += ` AND filled_by = $${paramIdx++}`;
    values.push(filled_by);
  }
  if (machine_department) {
    query += ` AND machine_department = $${paramIdx++}`;
    values.push(machine_department);
  }
  if (machine_division) {
    query += ` AND machine_division = $${paramIdx++}`;
    values.push(machine_division);
  }

  query += ` ORDER BY submission_date DESC`;

  const { rows } = await pool.query(query, values);
  return rows;
}

/**
 * Get repair task by ID
 */
export async function getRepairRequestById(id, currentUser = null) {
  let query = `SELECT * FROM repair_tasks WHERE id = $1`;
  const values = [id];

  if (currentUser && currentUser.role !== 'super_admin') {
    query += ` AND (filled_by = $2 OR assigned_person = $2)`;
    values.push(currentUser.username);
  }

  const { rows } = await pool.query(query, values);
  return rows[0];
}

/**
 * Update an existing repair task
 */
export async function updateRepairRequest(id, updateData) {
  const fields = Object.keys(updateData).filter(f => f !== 'id' && f !== 'created_at');
  if (fields.length === 0) return null;

  const setClause = fields.map((field, idx) => `"${field}" = $${idx + 2}`).join(", ");
  const query = `
    UPDATE repair_tasks 
    SET ${setClause} 
    WHERE id = $1 
    RETURNING *
  `;
  const values = [id, ...fields.map(f => updateData[f])];

  const { rows } = await pool.query(query, values);
  return rows[0];
}

/**
 * Delete a repair task
 */
export async function deleteRepairRequest(id) {
  const query = `DELETE FROM repair_tasks WHERE id = $1 RETURNING *`;
  const { rows } = await pool.query(query, [id]);
  return rows[0];
}
