import pool from "../config/db.js";
import { uploadToS3 } from "../middleware/s3Upload.js";
import { sendTaskAssignmentEmail, sendMaintenanceAssignmentEmail } from "../services/emailService.js";
import whatsappService from "../services/whatsappService.js";

// 0️⃣ User Profile (for AssignTaskUser pre-fill)
export const getUserProfile = async (req, res) => {
  try {
    const { username } = req.params;
    const { rows } = await pool.query(
      `SELECT user_name, unit, division, department FROM users WHERE user_name = $1 LIMIT 1`,
      [username]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server Error");
  }
};

// 1️⃣ Departments
export const getUniqueDepartments = async (req, res) => {
  try {
    const user_name = req.params.user_name;

    const user = await pool.query(
      `SELECT role, user_access FROM users WHERE user_name=$1`,
      [user_name]
    );

    if (user.rows.length === 0)
      return res.status(404).json({ message: "User not found" });

    const userRow = user.rows[0];
    const role = userRow.role ? userRow.role.toUpperCase() : "USER";

    if (role === "SUPER_ADMIN" || role === "super_admin") {
      const result = await pool.query(`
        SELECT DISTINCT department
        FROM users
        WHERE department IS NOT NULL
        ORDER BY department ASC
      `);
      return res.json(result.rows.map(r => r.department));
    }

    if (role === "DIV_ADMIN" || role === "div_admin") {
      const { unit, division } = userRow;
      const result = await pool.query(
        `SELECT DISTINCT department FROM users WHERE LOWER(unit)=LOWER($1) AND LOWER(division)=LOWER($2) AND department IS NOT NULL ORDER BY department ASC`,
        [unit, division]
      );
      return res.json(result.rows.map(r => r.department));
    }

    if (role === "ADMIN" || role === "admin") {
      const { unit, division, department } = userRow;
      const result = await pool.query(
        `SELECT DISTINCT department FROM users WHERE LOWER(unit)=LOWER($1) AND LOWER(division)=LOWER($2) AND LOWER(department)=LOWER($3) AND department IS NOT NULL ORDER BY department ASC`,
        [unit, division, department]
      );
      return res.json(result.rows.map(r => r.department));
    }

    // Default for USER
    return res.json([]);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server Error");
  }
};

// 2️⃣ Given By
export const getUniqueGivenBy = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT given_by 
      FROM users 
      WHERE given_by IS NOT NULL
      ORDER BY given_by ASC
    `);
    res.json(result.rows.map(r => r.given_by));
  } catch (e) {
    console.error(e);
    res.status(500).send("Server Error");
  }
};

// 3️⃣ Doer Names (FIXED ✔) — now also filters by unit & division
export const getUniqueDoerNames = async (req, res) => {
  try {
    const { department } = req.params;
    const { unit, division } = req.query;

    let query = `SELECT DISTINCT user_name
       FROM users 
       WHERE status='active'
         AND LOWER(department) = LOWER($1)`;
    const params = [department];

    if (unit) {
      params.push(unit);
      query += ` AND LOWER(unit) = LOWER($${params.length})`;
    }
    if (division) {
      params.push(division);
      query += ` AND LOWER(division) = LOWER($${params.length})`;
    }

    query += ` ORDER BY user_name ASC`;

    const result = await pool.query(query, params);

    res.json(result.rows.map(r => ({ user_name: r.user_name })));
  } catch (e) {
    console.error(e);
    res.status(500).send("Server Error");
  }
};

// 3b️⃣ All Doer Names (no department filter)
export const getAllDoerNames = async (req, res) => {
  try {
    const { role, division, department } = req.query;
    const upRole = (role || "").toUpperCase();

    let query = `SELECT DISTINCT user_name FROM users WHERE status='active'`;
    const params = [];

    if (upRole === "SUPER_ADMIN" || upRole === "super_admin") {
      // No filter
    } else if (upRole === "DIV_ADMIN" || upRole === "div_admin") {
      if (division) {
        query += ` AND LOWER(division) = LOWER($1)`;
        params.push(division);
      }
    } else if (upRole === "ADMIN" || upRole === "admin") {
      if (division && department) {
        query += ` AND LOWER(division) = LOWER($1) AND LOWER(department) = LOWER($2)`;
        params.push(division, department);
      } else if (department) {
        query += ` AND LOWER(department) = LOWER($1)`;
        params.push(department);
      }
    } else {
      // Default fallback or USER role (though usually history doesn't call this for USER in a broad way)
      // If we want to restrict to self:
      // query += ` AND LOWER(user_name) = LOWER($1)`;
      // params.push(req.query.username);
    }

    query += ` ORDER BY user_name ASC`;

    const result = await pool.query(query, params);
    res.json(result.rows.map(r => ({ user_name: r.user_name })));
  } catch (e) {
    console.error("❌ Error in getAllDoerNames:", e);
    res.status(500).send("Server Error");
  }
};

// 4️⃣ Working days
export const getWorkingDays = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT working_date, day, week_num, month
      FROM working_day_calender
      ORDER BY working_date ASC
    `);

    res.json(result.rows);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server Error");
  }
};

// 5️⃣ Insert Assign Tasks
export const postAssignTasks = async (req, res) => {
  try {
    const tasks = req.body;

    // Step A: Upload image to S3 (if exists)
    let imageUrl = null;
    if (req.file) {
      imageUrl = await uploadToS3(req.file);
    }

    const taskType = tasks[0].taskType;
    const isOneTime = tasks[0].frequency === "one-time";

    // Check if it's explicitly a maintenance task
    if (taskType === "maintenance") {
      // ----- MAINTENANCE INSERT -----

      // Resolve machine_parts data if machinePartId is provided
      const machinePartId = tasks[0].machinePartId || null;
      var resolvedMachineName = tasks[0].machineName || null;
      var resolvedPartName = tasks[0].partName || null;
      var resolvedPartArea = tasks[0].partArea || null;

      if (machinePartId) {
        const mpResult = await pool.query(
          `SELECT machine_name, machine_area, machine_department, machine_division FROM machine_parts WHERE id = $1`,
          [machinePartId]
        );
        if (mpResult.rows.length > 0) {
          resolvedMachineName = mpResult.rows[0].machine_name;
          resolvedPartArea = mpResult.rows[0].machine_area;
          var resolvedMachineDept = mpResult.rows[0].machine_department;
          var resolvedMachineDiv = mpResult.rows[0].machine_division;
        }
      }

      // Use partName directly (should be an array from frontend)
      resolvedPartName = tasks[0].partName || [];

      const values = [];
      const params = [];

      tasks.forEach((t, i) => {
        const startDate = t.taskStartDate || t.startDate || t.dueDate;

        values.push(
          `($${i * 23 + 1}, $${i * 23 + 2}, $${i * 23 + 3}, $${i * 23 + 4}, $${i * 23 + 5},
            $${i * 23 + 6}, $${i * 23 + 7}, $${i * 23 + 8}, $${i * 23 + 9}, $${i * 23 + 10},
            $${i * 23 + 11}, $${i * 23 + 12}, $${i * 23 + 13}, $${i * 23 + 14}, $${i * 23 + 15},
            $${i * 23 + 16}, $${i * 23 + 17}, $${i * 23 + 18}, $${i * 23 + 19}, $${i * 23 + 20},
            $${i * 23 + 21}, $${i * 23 + 22}, $${i * 23 + 23})`
        );

        params.push(
          t.department,                        // 1
          t.givenBy,                           // 2
          t.doer,                              // 3 (name)
          t.description,                       // 4 (task_description)
          t.enableReminders ? true : false,    // 5 (enable_reminders)
          t.requireAttachment ? "yes" : "no",  // 6 (require_attachment)
          t.frequency,                         // 7
          null,                                // 8 remarks
          "Pending",                           // 9 status
          imageUrl,                            // 10 uploaded_image_url
          false,                               // 11 admin_done
          startDate,                           // 12 planned_date
          startDate,                           // 13 task_start_date
          null,                                // 14 submission_date
          t.unit || null,                      // 15 unit
          t.division || null,                  // 16 division
          resolvedMachineName,                 // 17
          resolvedPartName,                    // 18
          resolvedPartArea,                    // 19
          machinePartId,                       // 20 machine_part_id (FK)
          t.duration || null,                  // 21 duration
          resolvedMachineDept || t.machine_department || null, // 22 machine_department
          resolvedMachineDiv || t.machine_division || null    // 23 machine_division
        );
      });

      const result = await pool.query(
        `INSERT INTO maintenance_tasks 
        (department, given_by, name, task_description, enable_reminders,
         require_attachment, frequency, remarks, status, uploaded_image_url, admin_done,
         planned_date, task_start_date, submission_date, unit, division, machine_name, part_name, part_area, machine_part_id, duration, machine_department, machine_division)
        VALUES ${values.join(",")}
        RETURNING id AS task_id`,
        params
      );

      // Store the first inserted task_id for WhatsApp notification
      var insertedTaskId = result.rows.length > 0 ? result.rows[0].task_id : null;

    } else if (isOneTime) {
      // ----- DELEGATION INSERT -----
      const values = [];
      const params = [];

      tasks.forEach((t, i) => {
        values.push(
          `($${i * 13 + 1}, $${i * 13 + 2}, $${i * 13 + 3}, $${i * 13 + 4}, $${i * 13 + 5},
            $${i * 13 + 6}, $${i * 13 + 7}, $${i * 13 + 8}, $${i * 13 + 9}, $${i * 13 + 10}, $${i * 13 + 11}, $${i * 13 + 12}, $${i * 13 + 13})`
        );
        params.push(
          t.department,
          t.givenBy,
          t.doer,
          t.description,
          t.frequency,
          t.enableReminders ? "yes" : "no",
          t.requireAttachment ? "yes" : "no",
          t.dueDate,           // planned_date (the selected end/due date)
          null,                // status
          t.taskStartDate || new Date().toISOString().slice(0, 19).replace('T', ' '),  // task_start_date (from frontend or current timestamp)
          imageUrl,            // image
          t.unit || null,      // unit
          t.division || null   // division
        );
      });

      const result = await pool.query(
        `INSERT INTO delegation 
        (department, given_by, name, task_description, frequency,
         enable_reminder, require_attachment, planned_date, status, task_start_date, image, unit, division)
        VALUES ${values.join(",")}
        RETURNING task_id`,
        params
      );

      // Store the first inserted task_id for WhatsApp notification
      var insertedTaskId = result.rows.length > 0 ? result.rows[0].task_id : null;

    } else {
      // ----- CHECKLIST INSERT -----
      const values = [];
      const params = [];

      tasks.forEach((t, i) => {

        const startDate = t.taskStartDate || t.startDate || t.dueDate;

        values.push(
          `($${i * 16 + 1}, $${i * 16 + 2}, $${i * 16 + 3}, $${i * 16 + 4}, $${i * 16 + 5},
      $${i * 16 + 6}, $${i * 16 + 7}, $${i * 16 + 8}, $${i * 16 + 9},
      $${i * 16 + 10}, $${i * 16 + 11}, $${i * 16 + 12}, $${i * 16 + 13}, $${i * 16 + 14}, $${i * 16 + 15}, $${i * 16 + 16})`
        );

        params.push(
          t.department,                 // 1
          t.givenBy,                    // 2
          t.doer,                       // 3
          t.description,                // 4
          t.enableReminders ? "yes" : "no",  // 5
          t.requireAttachment ? "yes" : "no", // 6
          t.frequency,                    // 7
          null,                          // 8 remark
          null,                          // 9 status
          imageUrl,                      // 10 image
          null,                          // 11 admin_done
          startDate,                     // 12 planned_date
          startDate,                     // 13 task_start_date
          null,                          // 14 submission_date
          t.unit || null,                // 15 unit
          t.division || null             // 16 division
        );
      });


      const result = await pool.query(
        `INSERT INTO checklist 
        (department, given_by, name, task_description, enable_reminder,
         require_attachment, frequency, remark, status, image, admin_done,
         planned_date, task_start_date, submission_date, unit, division)
        VALUES ${values.join(",")}
        RETURNING task_id`,
        params
      );

      // Store the first inserted task_id for notification
      var insertedTaskId = result.rows.length > 0 ? result.rows[0].task_id : null;
    }

    // 📩 Email & WhatsApp Notification for new Task Assignment
    try {
      const doerName = tasks[0].doer;
      const userResult = await pool.query(
        "SELECT email_id, number FROM users WHERE user_name = $1",
        [doerName]
      );

      if (userResult.rows.length > 0) {
        const email = userResult.rows[0].email_id;
        const phone = userResult.rows[0].number;
        
        const taskDetails = {
          doerName: tasks[0].doer,
          taskId: insertedTaskId || "N/A",
          givenBy: tasks[0].givenBy,
          assignedBy: tasks[0].givenBy,
          description: tasks[0].description,
          checklistName: tasks[0].description,
          date: tasks[0].taskStartDate || tasks[0].startDate || tasks[0].dueDate,
          dueDate: tasks[0].taskStartDate || tasks[0].startDate || tasks[0].dueDate,
          department: tasks[0].department,
          division: tasks[0].division,
          frequency: tasks[0].frequency,
          // For Maintenance
          machineName: tasks[0].machineName,
          partName: Array.isArray(tasks[0].partName) ? tasks[0].partName.join(', ') : tasks[0].partName,
          partArea: tasks[0].partArea
        };

        // If it's maintenance but missing details from body, they might have been resolved in the maintenance block
        if (taskType === "maintenance") {
           // These variables were defined as 'var' or 'let' in the maintenance block
           // If they exist in scope, use them
           if (!taskDetails.machineName && typeof resolvedMachineName !== 'undefined') taskDetails.machineName = resolvedMachineName;
           if (!taskDetails.partArea && typeof resolvedPartArea !== 'undefined') taskDetails.partArea = resolvedPartArea;
           if (!taskDetails.partName && typeof resolvedPartName !== 'undefined') {
              taskDetails.partName = Array.isArray(resolvedPartName) ? resolvedPartName.join(', ') : resolvedPartName;
           }
        }

        if (email) {
          if (taskType === "maintenance") {
            console.log(`📧 Sending maintenance assignment email to: ${email}`);
            await sendMaintenanceAssignmentEmail(email, taskDetails);
          } else {
            console.log(`📧 Sending assignment email to: ${email}`);
            await sendTaskAssignmentEmail(email, taskDetails);
          }
        }

        if (phone) {
          if (taskType === "maintenance") {
            console.log(`📱 Sending maintenance WhatsApp to: ${phone}`);
            await whatsappService.sendMaintenanceAssignmentNotification(phone, taskDetails);
          } else if (tasks[0].frequency !== "one-time") {
            // It's a checklist (recurring)
            console.log(`📱 Sending checklist WhatsApp to: ${phone}`);
            await whatsappService.sendChecklistAssignmentNotification(phone, taskDetails);
          } else {
            // It's a delegation (one-time)
            console.log(`📱 Sending assignment WhatsApp to: ${phone}`);
            await whatsappService.sendTaskAssignmentNotification(phone, taskDetails);
          }
        }
      }
    } catch (notifErr) {
      console.error("❌ Notification error:", notifErr);
    }

    console.log(`ℹ️ Task created successfully for ${tasks[0].doer} (Email notification process complete)`);

    res.json({
      message: "Tasks inserted",
      count: tasks.length,
      image: imageUrl
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};





