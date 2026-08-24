import pool from "../config/db.js";

/**
 * Helper to format date YYYY-MM-DD
 */
const formatDate = (dateStr) => {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  } catch (e) {
    return "";
  }
};

/**
 * 1️⃣ GET /api/equipment/master - Get all Equipment Master records with filtering
 */
export const getEquipmentMaster = async (req, res) => {
  try {
    const { department, division, status, search } = req.query;

    let query = `
      SELECT 
        e.*,
        COUNT(DISTINCT r.id) AS total_repairs,
        COUNT(DISTINCT m.id) AS total_maintenance_tasks
      FROM public.equipment_master e
      LEFT JOIN public.repair_tasks r ON LOWER(TRIM(r.machine_name)) = LOWER(TRIM(e.equipment_name))
      LEFT JOIN public.maintenance_tasks m ON LOWER(TRIM(m.machine_name)) = LOWER(TRIM(e.equipment_name))
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 1;

    if (department && department !== 'all') {
      query += ` AND LOWER(e.machine_department) = LOWER($${paramCount})`;
      params.push(department);
      paramCount++;
    }

    if (division && division !== 'all') {
      query += ` AND LOWER(e.machine_division) = LOWER($${paramCount})`;
      params.push(division);
      paramCount++;
    }

    if (status && status !== 'all') {
      query += ` AND LOWER(e.status) = LOWER($${paramCount})`;
      params.push(status);
      paramCount++;
    }

    if (search) {
      query += ` AND (e.equipment_id ILIKE $${paramCount} OR e.equipment_name ILIKE $${paramCount} OR e.model ILIKE $${paramCount} OR e.serial_no ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` GROUP BY e.id ORDER BY e.equipment_id ASC`;

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error("Error fetching Equipment Master:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 2️⃣ POST /api/equipment/master - Create a new Equipment Master record
 */
export const createEquipmentMaster = async (req, res) => {
  try {
    const {
      equipment_id,
      equipment_name,
      model,
      serial_no,
      machine_division,
      machine_department,
      machine_area,
      purchase_date,
      installation_date,
      running_hours,
      status,
      remarks
    } = req.body;

    if (!equipment_id || !equipment_name) {
      return res.status(400).json({ success: false, message: "Equipment ID and Equipment Name are required." });
    }

    const query = `
      INSERT INTO public.equipment_master (
        equipment_id, equipment_name, model, serial_no,
        machine_division, machine_department, machine_area,
        purchase_date, installation_date, running_hours,
        status, remarks
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `;

    const values = [
      equipment_id.trim().toUpperCase(),
      equipment_name.trim(),
      model?.trim() || null,
      serial_no?.trim() || null,
      machine_division?.trim() || null,
      machine_department?.trim() || null,
      machine_area?.trim() || null,
      purchase_date || null,
      installation_date || null,
      running_hours || 0,
      status || 'Running',
      remarks?.trim() || null
    ];

    const { rows } = await pool.query(query, values);
    const newEquipment = rows[0];

    // Ensure machine_parts sync
    await pool.query(`
      INSERT INTO public.machine_parts (machine_name, machine_department, machine_division, machine_area, equipment_master_id, equipment_id)
      SELECT $1, $2, $3, $4, $5, $6
      WHERE NOT EXISTS (
        SELECT 1 FROM public.machine_parts WHERE LOWER(TRIM(machine_name)) = LOWER(TRIM($1))
      )
    `, [newEquipment.equipment_name, newEquipment.machine_department, newEquipment.machine_division, newEquipment.machine_area, newEquipment.id, newEquipment.equipment_id]);

    res.status(201).json({ success: true, data: newEquipment, message: "Equipment master record created successfully." });
  } catch (error) {
    console.error("Error creating Equipment Master:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 3️⃣ PUT /api/equipment/master/:id - Update Equipment Master record
 */
export const updateEquipmentMaster = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      equipment_id,
      equipment_name,
      model,
      serial_no,
      machine_division,
      machine_department,
      machine_area,
      purchase_date,
      installation_date,
      running_hours,
      status,
      remarks
    } = req.body;

    const query = `
      UPDATE public.equipment_master
      SET 
        equipment_id = COALESCE($1, equipment_id),
        equipment_name = COALESCE($2, equipment_name),
        model = $3,
        serial_no = $4,
        machine_division = COALESCE($5, machine_division),
        machine_department = COALESCE($6, machine_department),
        machine_area = COALESCE($7, machine_area),
        purchase_date = $8,
        installation_date = $9,
        running_hours = COALESCE($10, running_hours),
        status = COALESCE($11, status),
        remarks = $12
      WHERE id = $13
      RETURNING *
    `;

    const values = [
      equipment_id ? equipment_id.trim().toUpperCase() : null,
      equipment_name ? equipment_name.trim() : null,
      model !== undefined ? model : null,
      serial_no !== undefined ? serial_no : null,
      machine_division || null,
      machine_department || null,
      machine_area || null,
      purchase_date || null,
      installation_date || null,
      running_hours !== undefined ? running_hours : null,
      status || null,
      remarks !== undefined ? remarks : null,
      id
    ];

    const { rows } = await pool.query(query, values);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Equipment record not found." });
    }

    res.json({ success: true, data: rows[0], message: "Equipment updated successfully." });
  } catch (error) {
    console.error("Error updating Equipment Master:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 4️⃣ DELETE /api/equipment/master/:id - Delete Equipment Master record
 */
export const deleteEquipmentMaster = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query(`DELETE FROM public.equipment_master WHERE id = $1 RETURNING *`, [id]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Equipment record not found." });
    }
    res.json({ success: true, message: "Equipment master record deleted successfully." });
  } catch (error) {
    console.error("Error deleting Equipment Master:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * 5️⃣ GET /api/equipment/history - Unified Equipment History Register Endpoint
 * Returns all 16 columns matching Equipment_History_Register.csv
 */
export const getEquipmentHistory = async (req, res) => {
  try {
    const { department, division, status, startDate, endDate, search } = req.query;

    let query = `
      SELECT 
        e.id AS master_id,
        e.equipment_id,
        e.equipment_name,
        COALESCE(e.model, '—') AS model,
        COALESCE(e.serial_no, '—') AS serial_no,
        COALESCE(e.machine_department, 'N/A') AS department,
        COALESCE(e.machine_division, 'N/A') AS division,
        e.purchase_date,
        COALESCE(e.installation_date, e.created_at::date) AS installation_date,
        COALESCE(e.running_hours, 0) AS running_hours,
        
        -- Maintenance Service Info
        m_info.last_service_date,
        m_info.next_service_due,
        
        -- Repair Info
        r_info.breakdown_date,
        r_info.repair_details,
        r_info.parts_replaced,
        r_info.latest_repair_status,
        
        COALESCE(r_info.latest_repair_status, e.status, 'Running') AS status,
        COALESCE(r_info.repair_remarks, e.remarks, 'Good Condition') AS remarks
      FROM public.equipment_master e
      
      -- Join Maintenance Info
      LEFT JOIN LATERAL (
        SELECT 
          MAX(CASE WHEN (status = 'Done' OR status = 'yes' OR admin_done = 'Done' OR submission_date IS NOT NULL) THEN task_start_date END) AS last_service_date,
          MIN(CASE WHEN (status IS NULL OR status = 'no') AND task_start_date >= CURRENT_DATE THEN task_start_date END) AS next_service_due
        FROM public.maintenance_tasks
        WHERE LOWER(TRIM(machine_name)) = LOWER(TRIM(e.equipment_name))
      ) m_info ON true

      -- Join Repair Info (Latest breakdown/repair record)
      LEFT JOIN LATERAL (
        SELECT 
          submission_date AS breakdown_date,
          issue_description AS repair_details,
          part_replaced AS parts_replaced,
          status AS latest_repair_status,
          remarks AS repair_remarks
        FROM public.repair_tasks
        WHERE LOWER(TRIM(machine_name)) = LOWER(TRIM(e.equipment_name))
        ORDER BY created_at DESC
        LIMIT 1
      ) r_info ON true
      
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 1;

    if (department && department !== 'all') {
      query += ` AND LOWER(e.machine_department) = LOWER($${paramCount})`;
      params.push(department);
      paramCount++;
    }

    if (division && division !== 'all') {
      query += ` AND LOWER(e.machine_division) = LOWER($${paramCount})`;
      params.push(division);
      paramCount++;
    }

    if (status && status !== 'all') {
      query += ` AND (LOWER(e.status) = LOWER($${paramCount}) OR LOWER(r_info.latest_repair_status) = LOWER($${paramCount}))`;
      params.push(status);
      paramCount++;
    }

    if (search) {
      query += ` AND (e.equipment_id ILIKE $${paramCount} OR e.equipment_name ILIKE $${paramCount} OR e.model ILIKE $${paramCount} OR e.serial_no ILIKE $${paramCount})`;
      params.push(`%${search}%`);
      paramCount++;
    }

    query += ` ORDER BY e.equipment_id ASC`;

    const { rows } = await pool.query(query, params);

    // Format fields for frontend and CSV download matching 16 columns
    const historyRegister = rows.map((row, index) => {
      return {
        s_no: index + 1,
        equipment_id: row.equipment_id || `EQ-${String(index + 1).padStart(3, '0')}`,
        equipment_name: row.equipment_name || "—",
        model: row.model || "—",
        serial_no: row.serial_no || "—",
        department: row.department || "N/A",
        division: row.division || "N/A",
        purchase_date: formatDate(row.purchase_date) || "—",
        installation_date: formatDate(row.installation_date) || "—",
        running_hours: row.running_hours || 0,
        service_date: formatDate(row.last_service_date) || "—",
        breakdown_date: formatDate(row.breakdown_date) || "—",
        repair_details: row.repair_details || "—",
        parts_replaced: row.parts_replaced || "—",
        next_service_due: formatDate(row.next_service_due) || "—",
        status: row.status || "Running",
        remarks: row.remarks || "Good Condition"
      };
    });

    res.json({ success: true, count: historyRegister.length, data: historyRegister });
  } catch (error) {
    console.error("Error fetching Equipment History Register:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
