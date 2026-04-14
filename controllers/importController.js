import pool from "../config/db.js";

// Helper function to sanitize enum values (handle "NULL" strings, empty values, etc.)
const sanitizeEnumValue = (value, defaultValue = 'no') => {
  // Handle null, undefined, or falsy values
  if (!value) return defaultValue;

  // Convert to string safely
  const strValue = String(value).trim();

  // Handle empty string or "NULL" string (case-insensitive)
  if (strValue === '' || strValue.toUpperCase() === 'NULL') {
    return defaultValue;
  }

  // Return the value in lowercase for consistency
  return strValue.toLowerCase();
};

// Helper function to sanitize non-text fields (convert "NULL" strings to actual null)
const sanitizeNullValue = (value) => {
  // Handle null, undefined, or falsy values
  if (!value) return null;

  // Convert to string safely and check
  const strValue = String(value).trim();

  // Handle empty string or "NULL" string (case-insensitive)
  if (strValue === '' || strValue.toUpperCase() === 'NULL') {
    return null;
  }

  // Return the original value
  return value;
};

// Helper function to calculate next working dates based on frequency
const generateTaskDates = async (startDate, frequency, count = 365, username = null) => {
  // 1. Generation start (day_off filtering removed)

  // Map English day names to Hindi day names used in working_day_calender
  const dayNameMap = {
    'Sunday': 'रवि',
    'Monday': 'सोम',
    'Tuesday': 'मंगल',
    'Wednesday': 'बुध',
    'Thursday': 'गुरु',
    'Friday': 'शुक्र',
    'Saturday': 'शनि'
  };

  // dayOffHindi filtering removed

  // Get working days from calendar (including Hindi day name for filtering)
  const workingDaysResult = await pool.query(`
    SELECT working_date, day
    FROM working_day_calender 
    WHERE working_date >= $1
    ORDER BY working_date ASC
    LIMIT $2
  `, [startDate, count]);

  const workingDaysRaw = workingDaysResult.rows.map(r => ({
    date: new Date(r.working_date),
    dayHindi: r.day
  }));

  const workingDays = workingDaysRaw.map(r => r.date);
  const taskDatesRaw = [];

  switch (frequency?.toLowerCase()) {
    case 'daily':
      taskDatesRaw.push(...workingDaysRaw);
      break;

    case 'tertiary':
      for (let i = 0; i < workingDaysRaw.length; i += 3) {
        taskDatesRaw.push(workingDaysRaw[i]);
      }
      break;

    case 'weekly':
      for (let i = 0; i < workingDaysRaw.length; i += 7) {
        taskDatesRaw.push(workingDaysRaw[i]);
      }
      break;

    case 'fortnightly':
      for (let i = 0; i < workingDaysRaw.length; i += 14) {
        taskDatesRaw.push(workingDaysRaw[i]);
      }
      break;

    case 'monthly':
      let lastMonth = -1;
      for (const item of workingDaysRaw) {
        const month = item.date.getMonth();
        if (month !== lastMonth) {
          taskDatesRaw.push(item);
          lastMonth = month;
        }
      }
      break;

    case 'quarterly':
      let lastQuarter = -1;
      for (const item of workingDaysRaw) {
        const quarter = Math.floor(item.date.getMonth() / 3);
        if (quarter !== lastQuarter) {
          taskDatesRaw.push(item);
          lastQuarter = quarter;
        }
      }
      break;

    case 'yearly':
      let lastYear = -1;
      for (const item of workingDaysRaw) {
        const year = item.date.getFullYear();
        if (year !== lastYear) {
          taskDatesRaw.push(item);
          lastYear = year;
        }
      }
      break;

    default:
      // If no frequency or unknown, just use the start date
      // We might not have the dayHindi for this specific date if it's not in calendar,
      // but usually the calendar is comprehensive.
      const directDate = new Date(startDate);
      const calendarMatch = workingDaysRaw.find(r => r.date.getTime() === directDate.getTime());
      taskDatesRaw.push({
        date: directDate,
        dayHindi: calendarMatch ? calendarMatch.dayHindi : null
      });
  }

  const filteredDates = taskDatesRaw.map(item => item.date);

  return filteredDates;
};

// Bulk import into checklist table (SMART IMPORT - generates recurring tasks)
// TODO: For large CSV imports with daily frequency, the single bulk INSERT can exceed
// PostgreSQL's ~65,535 parameter limit (~8-9 daily rows max). Add batched inserts
// (e.g., 500 rows per batch) to handle larger imports safely.
export const bulkImportChecklist = async (req, res) => {
  try {
    const tasks = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data: Expected array of tasks"
      });
    }

    // Validate required fields for checklist
    const requiredFields = ['name', 'task_description'];
    const errors = [];

    tasks.forEach((task, index) => {
      requiredFields.forEach(field => {
        if (!task[field]) {
          errors.push(`Row ${index + 1}: Missing required field '${field}'`);
        }
      });
    });

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors
      });
    }

    console.log(`📥 Importing ${tasks.length} unique task definitions...`);

    // For each unique task definition, generate recurring task instances
    const allTaskInstances = [];

    for (const taskDef of tasks) {
      const startDate = taskDef.task_start_date || new Date().toISOString().split('T')[0];
      const frequency = taskDef.frequency || 'daily';

      // Generate task dates based on frequency and working calendar
      const taskDates = await generateTaskDates(startDate, frequency, 365, taskDef.name);

      console.log(`📅 Task "${taskDef.task_description}" (${frequency}): Generating ${taskDates.length} instances`);

      // Create task instance for each date
      for (const date of taskDates) {
        const taskInstance = {
          unit: taskDef.unit || null,
          division: taskDef.division || null,
          department: taskDef.department || null,
          given_by: taskDef.given_by || null,
          name: taskDef.name,
          task_description: taskDef.task_description,
          enable_reminder: sanitizeEnumValue(taskDef.enable_reminder, 'no'),
          require_attachment: sanitizeEnumValue(taskDef.require_attachment, 'no'),
          frequency: taskDef.frequency || null,
          remark: taskDef.remark || null,
          status: sanitizeEnumValue(taskDef.status, 'no'),
          image: taskDef.image || null,
          admin_done: taskDef.admin_done || null,
          delay: null,
          planned_date: sanitizeNullValue(taskDef.planned_date), // Use value from CSV
          task_start_date: date.toISOString(),
          submission_date: null
        };

        allTaskInstances.push(taskInstance);
      }
    }

    console.log(`✅ Total task instances to insert: ${allTaskInstances.length}`);

    // Build dynamic INSERT query for all instances
    const values = [];
    const params = [];
    let paramIndex = 1;

    allTaskInstances.forEach((task) => {
      const taskParams = [];
      const placeholders = [];

      const columns = {
        unit: task.unit,
        division: task.division,
        department: task.department,
        given_by: task.given_by,
        name: task.name,
        task_description: task.task_description,
        enable_reminder: task.enable_reminder,
        require_attachment: task.require_attachment,
        frequency: task.frequency,
        remark: task.remark,
        status: task.status,
        image: task.image,
        admin_done: task.admin_done,
        delay: task.delay,
        planned_date: task.planned_date,
        task_start_date: task.task_start_date,
        submission_date: task.submission_date
      };

      Object.values(columns).forEach(value => {
        placeholders.push(`$${paramIndex++}`);
        taskParams.push(value);
      });

      values.push(`(${placeholders.join(', ')})`);
      params.push(...taskParams);
    });

    const columnNames = [
      'unit', 'division',
      'department', 'given_by', 'name', 'task_description',
      'enable_reminder', 'require_attachment', 'frequency',
      'remark', 'status', 'image', 'admin_done', 'delay',
      'planned_date', 'task_start_date', 'submission_date'
    ];

    const query = `
      INSERT INTO checklist (${columnNames.join(', ')})
      VALUES ${values.join(', ')}
      RETURNING task_id, created_at
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: `Successfully generated ${result.rows.length} task instances from ${tasks.length} unique task definitions`,
      count: result.rows.length, // For frontend compatibility
      uniqueTasksCount: tasks.length,
      generatedTasksCount: result.rows.length,
      insertedIds: result.rows.map(r => r.task_id)
    });

  } catch (error) {
    console.error("Bulk import checklist error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to import tasks",
      error: error.message
    });
  }
};

// Bulk import into delegation table
export const bulkImportDelegation = async (req, res) => {
  try {
    const tasks = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data: Expected array of tasks"
      });
    }

    // Validate required fields for delegation
    const requiredFields = ['name', 'task_description'];
    const errors = [];

    tasks.forEach((task, index) => {
      requiredFields.forEach(field => {
        if (!task[field]) {
          errors.push(`Row ${index + 1}: Missing required field '${field}'`);
        }
      });
    });

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors
      });
    }

    // Build dynamic INSERT query
    const values = [];
    const params = [];
    let paramIndex = 1;

    tasks.forEach((task) => {
      const taskParams = [];
      const placeholders = [];

      // Define column mapping (skip task_id and created_at as they're auto-generated)
      const columns = {
        unit: task.unit || null,
        division: task.division || null,
        department: task.department || null,
        given_by: task.given_by || null,
        name: task.name,
        task_description: task.task_description,
        // Handle string "NULL", empty strings, and null values for enum fields
        enable_reminder: sanitizeEnumValue(task.enable_reminder, 'no'),
        require_attachment: sanitizeEnumValue(task.require_attachment, 'no'),
        frequency: task.frequency || null,
        remark: task.remark || null,
        status: sanitizeEnumValue(task.status, 'no'),
        image: task.image || null,
        admin_done: task.admin_done || null,
        delay: sanitizeNullValue(task.delay),
        planned_date: sanitizeNullValue(task.planned_date),
        task_start_date: sanitizeNullValue(task.task_start_date),
        submission_date: sanitizeNullValue(task.submission_date)
      };

      Object.values(columns).forEach(value => {
        placeholders.push(`$${paramIndex++}`);
        taskParams.push(value);
      });

      values.push(`(${placeholders.join(', ')})`);
      params.push(...taskParams);
    });

    const columnNames = [
      'unit', 'division',
      'department', 'given_by', 'name', 'task_description',
      'enable_reminder', 'require_attachment', 'frequency',
      'remark', 'status', 'image', 'admin_done', 'delay',
      'planned_date', 'task_start_date', 'submission_date'
    ];

    const query = `
      INSERT INTO delegation (${columnNames.join(', ')})
      VALUES ${values.join(', ')}
      RETURNING task_id, created_at
    `;

    const result = await pool.query(query, params);

    res.json({
      success: true,
      message: `Successfully imported ${result.rows.length} tasks`,
      count: result.rows.length,
      insertedIds: result.rows.map(r => r.task_id)
    });

  } catch (error) {
    console.error("Bulk import delegation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to import tasks",
      error: error.message
    });
  }
};

// Bulk import into maintenance_tasks table
export const bulkImportMaintenance = async (req, res) => {
  try {
    const tasks = req.body;

    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid data: Expected array of tasks"
      });
    }

    // Validate required fields for maintenance
    const requiredFields = ['unit', 'division', 'department', 'name', 'task_description', 'machine_name', 'part_name', 'machine_area', 'frequency', 'planned_date', 'machine_department', 'machine_division'];
    const errors = [];

    tasks.forEach((task, index) => {
      requiredFields.forEach(field => {
        if (!task[field]) {
          errors.push(`Row ${index + 1}: Missing required field '${field}'`);
        }
      });
    });

    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors
      });
    }

    console.log(`📥 Importing ${tasks.length} maintenance task definitions...`);

    const allTaskInstances = [];

    for (const taskDef of tasks) {
      const startDate = taskDef.planned_date;
      const frequency = taskDef.frequency || 'daily';

      // Parse part_name: CSV may have comma-separated values like "gear,motor,belt"
      const partNameArray = typeof taskDef.part_name === 'string'
        ? taskDef.part_name.split(',').map(p => p.trim()).filter(Boolean)
        : (Array.isArray(taskDef.part_name) ? taskDef.part_name : []);

      // Attempt to look up machine_part_id using array overlap
      const mpResult = await pool.query(
        `SELECT id FROM machine_parts 
         WHERE LOWER(machine_name) = LOWER($1) 
         AND part_name && $2
         AND LOWER(machine_area) = LOWER($3) 
         LIMIT 1`,
        [taskDef.machine_name, partNameArray, taskDef.machine_area]
      );
      const machinePartId = mpResult.rows.length > 0 ? mpResult.rows[0].id : null;

      // Generate task dates based on frequency and working calendar
      const taskDates = await generateTaskDates(startDate, frequency, 365, taskDef.name);

      // Create task instance for each date
      for (const date of taskDates) {
        const taskTime = taskDef.time || '00:00';
        const dateStr = date.toISOString().split('T')[0];
        const combinedPlannedDate = `${dateStr} ${taskTime}:00`;

        const taskInstance = {
          unit: taskDef.unit || null,
          division: taskDef.division || null,
          department: taskDef.department || null,
          given_by: taskDef.given_by || null,
          name: taskDef.name,
          task_description: taskDef.task_description,
          enable_reminders: sanitizeEnumValue(taskDef.enable_reminder, 'no') === 'yes',
          require_attachment: sanitizeEnumValue(taskDef.require_attachment, 'no'),
          frequency: taskDef.frequency || null,
          remarks: taskDef.remark || null,
          status: 'Pending',
          uploaded_image_url: null,
          admin_done: null,
          planned_date: combinedPlannedDate,
          task_start_date: date.toISOString(),
          submission_date: null,
          machine_name: taskDef.machine_name,
          part_name: partNameArray,
          part_area: taskDef.machine_area,
          machine_part_id: machinePartId,
          duration: taskDef.duration || null,
          machine_department: taskDef.machine_department || null,
          machine_division: taskDef.machine_division || null
        };

        allTaskInstances.push(taskInstance);
      }
    }

    // Build and execute dynamic INSERT queries in batches
    const columnNames = [
      'unit', 'division', 'department', 'given_by', 'name',
      'task_description', 'enable_reminders', 'require_attachment',
      'frequency', 'remarks', 'status', 'uploaded_image_url',
      'admin_done', 'planned_date', 'task_start_date',
      'submission_date', 'machine_name', 'part_name',
      'part_area', 'machine_part_id', 'duration',
      'machine_department', 'machine_division'
    ];

    const BATCH_SIZE = 100; // Number of task instances per batch
    const insertedIds = [];

    for (let i = 0; i < allTaskInstances.length; i += BATCH_SIZE) {
      const batch = allTaskInstances.slice(i, i + BATCH_SIZE);
      const values = [];
      const params = [];
      let paramIndex = 1;

      batch.forEach((task) => {
        const placeholders = [];
        const columns = [
          task.unit, task.division, task.department, task.given_by, task.name,
          task.task_description, task.enable_reminders, task.require_attachment,
          task.frequency, task.remarks, task.status, task.uploaded_image_url,
          task.admin_done, task.planned_date, task.task_start_date,
          task.submission_date, task.machine_name, task.part_name,
          task.part_area, task.machine_part_id, task.duration,
          task.machine_department, task.machine_division
        ];

        columns.forEach(value => {
          placeholders.push(`$${paramIndex++}`);
          params.push(value);
        });

        values.push(`(${placeholders.join(', ')})`);
      });

      const query = `
        INSERT INTO maintenance_tasks (${columnNames.join(', ')})
        VALUES ${values.join(', ')}
        RETURNING id
      `;

      const result = await pool.query(query, params);
      insertedIds.push(...result.rows.map(r => r.id));
    }

    res.json({
      success: true,
      message: `Successfully generated ${insertedIds.length} maintenance task instances from ${tasks.length} unique task definitions`,
      count: insertedIds.length,
      insertedIds
    });

  } catch (error) {
    console.error("Bulk import maintenance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to import maintenance tasks",
      error: error.message
    });
  }
};
