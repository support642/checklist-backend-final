import pool from "../config/db.js";
import { triggerUserLogout } from "./loginController.js";
import { fetchAndSyncWhatsAppTemplates } from "../services/whatsappService.js";

function getDefaultPermissions(role) {
  if (role === "user") {
    return {
      system_access: ["checklist"],
      page_access: [
        "dashboard",
        "assign_task",
        "delegation",
        "pending_task",
        "admin_approval",
        "calendar"
      ]
    };
  }

  if (role === "admin" || role === "ADMIN" || role === "DIV_ADMIN" || role === "div_admin") {
    return {
      system_access: ["checklist", "maintenance"],
      page_access: [
        "dashboard",
        "dashboard_admin",
        "assign_task",
        "assign_task_admin",
        "delegation",
        "delegation_admin",
        "pending_task",
        "admin_approval",
        "calendar",
        "quick_task",
        "quick_task_admin",
        "settings",
        "holiday_management",
        "admin_data"
      ]
    };
  }

  if (role === "super_admin" || role === "SUPER_ADMIN") {
    return {
      system_access: ["*"],
      page_access: ["*"]
    };
  }

  return {
    system_access: [],
    page_access: []
  };
}

/*******************************
 * 1) GET USERS
 *******************************/
export const getUsers = async (req, res) => {
  try {
    const { requesterRole, requesterUnit, requesterDivision, requesterDepartment, page = 1, limit = 50, search } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let filterQuery = ` WHERE user_name IS NOT NULL`;
    const params = [];

    // Apply role-based filtering if requester info is provided
    if (requesterRole) {
      const role = requesterRole.toUpperCase();

      if (role === "SUPER_ADMIN") {
        // No filter
      } else if (role === "DIV_ADMIN") {
        params.push(requesterUnit, requesterDivision);
        filterQuery += ` AND LOWER(unit) = LOWER($1) AND LOWER(division) = LOWER($2)`;
      } else if (role === "ADMIN") {
        params.push(requesterUnit, requesterDivision, requesterDepartment);
        filterQuery += ` AND LOWER(unit) = LOWER($1) AND LOWER(division) = LOWER($2) AND LOWER(department) = LOWER($3)`;
      } else {
        // Standard user or other - ideally they shouldn't call this, but let's be safe
        params.push(req.query.username || ''); // Fallback to self
        filterQuery += ` AND user_name = $1`;
      }
    }

    // Apply search filter if provided
    if (search) {
      params.push(`%${search}%`);
      filterQuery += ` AND (LOWER(user_name) LIKE LOWER($${params.length}) OR LOWER(email_id) LIKE LOWER($${params.length}))`;
    }

    // Get total count
    const countResult = await pool.query(`SELECT COUNT(*) FROM users ${filterQuery}`, params);
    const totalCount = parseInt(countResult.rows[0].count);

    // Get paginated data
    const dataParams = [...params, limitNum, offset];
    const dataQuery = `
      SELECT *
      FROM users
      ${filterQuery}
      ORDER BY id ASC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const result = await pool.query(dataQuery, dataParams);

    res.json({
      users: result.rows,
      totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum)
    });
  } catch (error) {
    console.error("❌ Error fetching users:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 2) CREATE USER
 *******************************/
export const createUser = async (req, res) => {
  try {
    const {
      username,
      password,
      email,
      phone,
      department,
      givenBy,
      role,
      status,
      user_access,
      unit,
      division,
      system_access,
      page_access,
      subscription_access_system,
      designation
    } = req.body;


    let permissions = getDefaultPermissions(role || 'employee');

    // Override defaults if manual permissions are provided
    if (system_access && Array.isArray(system_access) && system_access.length > 0) {
      permissions.system_access = system_access;
    }
    if (page_access && Array.isArray(page_access) && page_access.length > 0) {
      permissions.page_access = page_access;
    }


    const query = `
      INSERT INTO users (
        user_name, password, email_id, number, department,
        given_by, role, status, user_access, unit, division, system_access, page_access, 
        subscription_access_system, designation
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *
    `;

    // Convert empty strings to null for fields that might be bigint or optional
    const values = [
      username || null,
      password || null,
      email || null,
      phone || null,  // number column is bigint, empty string causes error
      department || null,
      givenBy || null,
      role || 'employee',
      status || 'active',
      user_access || null,
      unit || null,
      division || null,
      system_access ? JSON.stringify(system_access) : null,
      page_access ? JSON.stringify(page_access) : null,
      subscription_access_system ? JSON.stringify(subscription_access_system) : null,
      designation || null
    ];

    const result = await pool.query(query, values);

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creating user:", error.message);
    res.status(500).json({ error: "Database error", detail: error.message });
  }
};


/*******************************
 * 3) UPDATE USER
 *******************************/
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      user_name,
      password,
      email_id,
      number,
      employee_id,
      role,
      status,
      user_access,
      department,
      unit,
      division,
      given_by,
      leave_date,
      leave_end_date,
      remark,
      system_access,
      page_access,
      subscription_access_system,
      designation,
      requesterRole // Expecting requesterRole in body or query
    } = req.body;

    // 1. Fetch current user data
    const currentUserResult = await pool.query('SELECT user_name, role FROM users WHERE id = $1', [id]);
    if (currentUserResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const currentUser = currentUserResult.rows[0];
    const oldUserName = currentUser.user_name;

    const query = `
      UPDATE users SET
        user_name = $1,
        password = $2,
        email_id = $3,
        number = $4,
        employee_id = $5,
        role = $6,
        status = $7,
        user_access = $8,
        department = $9,
        given_by = $10,
        leave_date = $11,
        leave_end_date = $12,
        remark = $13,
        unit = $15,
        division = $16,
        system_access = $17,
        page_access = $18,
        subscription_access_system = $19,
        designation = $20
      WHERE id = $14
      RETURNING *
    `;

    const values = [
      user_name || null, password || null, email_id || null, number || null, employee_id || null,
      role, status, user_access, department, given_by,
      leave_date, leave_end_date, remark, id, unit || null, division || null,
      system_access ? JSON.stringify(system_access) : null,
      page_access ? JSON.stringify(page_access) : null,
      subscription_access_system ? JSON.stringify(subscription_access_system) : null,
      designation || null
    ];


    const result = await pool.query(query, values);
    const updatedUser = result.rows[0];

    // Force log out the user across devices, handling if their username changed
    if (oldUserName) triggerUserLogout(oldUserName);
    if (updatedUser.user_name && updatedUser.user_name !== oldUserName) {
      triggerUserLogout(updatedUser.user_name);
    }

    res.json(updatedUser);
  } catch (error) {
    console.error("❌ Error updating user:", error.message);
    res.status(500).json({ error: "Database error", detail: error.message });
  }
};


/*******************************
 * 4) DELETE USER
 *******************************/
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`DELETE FROM users WHERE id = $1`, [id]);

    res.json({ message: "User deleted", id });

  } catch (error) {
    console.error("❌ Error deleting user:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 5) GET ALL DEPARTMENTS
 *******************************/
export const getDepartments = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT department, given_by, unit, division, id
      FROM users
      WHERE (department IS NOT NULL AND department <> '')
         OR (given_by IS NOT NULL AND given_by <> '')
      ORDER BY department ASC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error("❌ Error fetching departments:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 6) GET UNIQUE DEPARTMENTS ONLY
 *******************************/
export const getDepartmentsOnly = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT department
      FROM users
      WHERE department IS NOT NULL 
        AND department <> ''
      ORDER BY department ASC
    `);

    // Format the response
    const departments = result.rows.map(row => ({
      department: row.department
    }));

    res.json(departments);

  } catch (error) {
    console.error("❌ Error fetching unique departments:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 7) GET UNIQUE GIVEN_BY VALUES
 *******************************/
export const getGivenByData = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT given_by
      FROM users
      WHERE given_by IS NOT NULL 
        AND given_by <> ''
      ORDER BY given_by ASC
    `);

    // Format the response
    const givenByList = result.rows.map(row => ({
      given_by: row.given_by
    }));

    res.json(givenByList);

  } catch (error) {
    console.error("❌ Error fetching given_by data:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 8) CREATE DEPARTMENT
 *******************************/
export const createDepartment = async (req, res) => {
  try {
    const { department, given_by, unit, division } = req.body;

    const result = await pool.query(`
      INSERT INTO users (department, given_by, unit, division)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [department, given_by, unit || null, division || null]);

    res.json(result.rows[0]);

  } catch (error) {
    console.log("❌ Error creating dept:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 9) UPDATE DEPARTMENT
 *******************************/
export const updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { department, given_by, unit, division } = req.body;

    const result = await pool.query(`
      UPDATE users 
      SET department = $1, given_by = $2, unit = $3, division = $4
      WHERE id = $5
      RETURNING *
    `, [department, given_by, unit || null, division || null, id]);

    res.json(result.rows[0]);

  } catch (error) {
    console.error("❌ Error updating dept:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 10) GET ALL MACHINES
 *******************************/
export const getMachines = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM machine_parts
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching machines:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 11) CREATE MACHINE(S)
 *******************************/
export const createMachine = async (req, res) => {
  try {
    const data = req.body;

    const { machine_name, part_name, part_images, machine_area, machine_department, machine_division } = data;
    // Ensure part_name and part_images are arrays
    const partNameArray = Array.isArray(part_name) ? part_name : (part_name ? [part_name] : []);
    const partImagesArray = Array.isArray(part_images) ? part_images : (part_images ? [part_images] : []);

    const result = await pool.query(
      "INSERT INTO machine_parts (machine_name, part_name, part_images, machine_area, machine_department, machine_division) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
      [machine_name || null, partNameArray, partImagesArray, machine_area || null, machine_department || null, machine_division || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creating machine:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 12) UPDATE MACHINE
 *******************************/
export const updateMachine = async (req, res) => {
  try {
    const { id } = req.params;
    const { machine_name, part_name, part_images, machine_area, machine_department, machine_division } = req.body;
    // Ensure part_name and part_images are arrays
    const partNameArray = Array.isArray(part_name) ? part_name : (part_name ? [part_name] : []);
    const partImagesArray = Array.isArray(part_images) ? part_images : (part_images ? [part_images] : []);

    const result = await pool.query(
      "UPDATE machine_parts SET machine_name = $1, part_name = $2, part_images = $3, machine_area = $4, machine_department = $5, machine_division = $6 WHERE id = $7 RETURNING *",
      [machine_name || null, partNameArray, partImagesArray, machine_area || null, machine_department || null, machine_division || null, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating machine:", error);
    res.status(500).json({ error: "Database error" });
  }
};


/*******************************
 * 13) DELETE MACHINE
 *******************************/
export const deleteMachine = async (req, res) => {
  try {
    const { id } = req.params;

    await pool.query(`DELETE FROM machine_parts WHERE id = $1`, [id]);

    res.json({ message: "Machine deleted", id });

  } catch (error) {
    console.error("❌ Error deleting machine:", error);
    res.status(500).json({ error: "Database error" });
  }
};

/*******************************
 * 14) UPLOAD PART IMAGE
 *******************************/
import { uploadToS3 } from "../middleware/s3Upload.js";

export const uploadPartImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const imageUrl = await uploadToS3(req.file);
    res.json({ imageUrl });
  } catch (error) {
    console.error("❌ Error uploading part image:", error);
    res.status(500).json({ error: "Upload failed" });
  }
};

/*******************************
 * 15) SYSTEM SETTINGS
 *******************************/
export const getSystemSettings = async (req, res) => {
  try {
    const { category } = req.query;
    let query = "SELECT * FROM system_settings";
    const params = [];

    if (category) {
      query += " WHERE category = $1";
      params.push(category);
    }

    query += " ORDER BY category, setting_key ASC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching system settings:", error);
    res.status(500).json({ error: "Database error" });
  }
};

export const updateSystemSetting = async (req, res) => {
  try {
    const { setting_key, setting_value } = req.body;
    
    if (!setting_key) {
      return res.status(400).json({ error: "setting_key is required" });
    }

    const result = await pool.query(
      `INSERT INTO system_settings (category, setting_key, setting_value)
       VALUES ('general', $1, $2)
       ON CONFLICT (setting_key) 
       DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [setting_key, setting_value]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating system setting:", error);
    res.status(500).json({ error: "Database error" });
  }
};


