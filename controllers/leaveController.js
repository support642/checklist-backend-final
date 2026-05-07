import pool from "../config/db.js";

// Transfer tasks from user on leave to delegated doer
const transferTasks = async (req, res) => {
  const { username, delegateTo, startDate, endDate, category } = req.body;

  if (!username || !delegateTo || !startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: username, delegateTo, startDate, endDate"
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Format dates for PostgreSQL
    const formattedStartDate = `${startDate}T00:00:00`;
    const formattedEndDate = `${endDate}T23:59:59`;

    // 1. Fetch tasks in the date range from the appropriate table
    const tableName = category === 'Maintenance' ? 'maintenance_tasks' : 'checklist';
    const fetchQuery = `
      SELECT *, division, unit FROM ${tableName}
      WHERE name = $1
      AND task_start_date >= $2
      AND task_start_date <= $3
    `;
    const fetchResult = await client.query(fetchQuery, [username, formattedStartDate, formattedEndDate]);
    const tasksToTransfer = fetchResult.rows;

    if (tasksToTransfer.length === 0) {
      await client.query('ROLLBACK');
      return res.status(200).json({
        success: true,
        tasksTransferred: 0,
        message: "No tasks found in the specified date range"
      });
    }

    if (category === 'Maintenance') {
      // For Maintenance: Just update the name in maintenance_tasks table
      const updateQuery = `
        UPDATE maintenance_tasks
        SET name = $1
        WHERE name = $2
        AND task_start_date >= $3
        AND task_start_date <= $4
      `;
      await client.query(updateQuery, [delegateTo, username, formattedStartDate, formattedEndDate]);
    } else {
      // For Checklist: Transfer to delegation and delete from checklist
      // 2. Insert tasks into delegation table
      const insertPromises = tasksToTransfer.map(task => {
        const insertQuery = `
          INSERT INTO delegation (
            task_id, task_description, given_by, name, 
            created_at, status, department, division, unit, frequency,
            task_start_date, planned_date
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `;
        return client.query(insertQuery, [
          task.task_id,
          task.task_description,
          task.name, // The original doer (user on leave)
          delegateTo, // The new doer
          task.task_start_date, // Use task start date as created_at
          'pending',
          task.department || '',
          task.division || '',
          task.unit || '',
          task.frequency || '',
          task.task_start_date,
          task.planned_date
        ]);
      });

      await Promise.all(insertPromises);

      // 3. Delete original checklist tasks
      const deleteQuery = `
        DELETE FROM checklist
        WHERE name = $1
        AND task_start_date >= $2
        AND task_start_date <= $3
      `;
      await client.query(deleteQuery, [username, formattedStartDate, formattedEndDate]);
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      tasksTransferred: tasksToTransfer.length,
      message: `Successfully transferred ${tasksToTransfer.length} tasks from ${username} to ${delegateTo}`
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error transferring tasks:", error);
    res.status(500).json({
      success: false,
      message: "Error transferring tasks",
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Fetch user tasks by date range
const getUserTasks = async (req, res) => {
  const { username, startDate, endDate, category } = req.query;

  if (!username || !startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: "Missing required parameters: username, startDate, endDate"
    });
  }

  try {
    // Format dates for PostgreSQL
    const formattedStartDate = `${startDate}T00:00:00`;
    const formattedEndDate = `${endDate}T23:59:59`;

    // Fetch tasks in the date range
    const isMaintenance = category === 'Maintenance';
    const tableName = isMaintenance ? 'maintenance_tasks' : 'checklist';

    // maintenance_tasks uses 'id' instead of 'task_id' and 'machine_department'/'department'
    const idColumn = isMaintenance ? 'id as task_id' : 'task_id';

    const fetchQuery = `
      SELECT 
        ${idColumn}, 
        name, 
        task_description, 
        task_start_date, 
        department, 
        division,
        unit,
        given_by, 
        frequency,
        planned_date
      FROM ${tableName}
      WHERE name = $1
      AND task_start_date >= $2
      AND task_start_date <= $3
      ORDER BY task_start_date ASC
    `;

    const result = await pool.query(fetchQuery, [username, formattedStartDate, formattedEndDate]);

    res.status(200).json({
      success: true,
      tasks: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    console.error("Error fetching user tasks:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching user tasks",
      error: error.message
    });
  }
};

// Assign individual tasks to different users
const assignIndividualTasks = async (req, res) => {
  const { assignments, category } = req.body;

  if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Missing or invalid assignments array"
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Filter assignments that have a delegateTo user (only these go to delegation table)
    const delegationAssignments = assignments.filter(task => task.delegateTo && task.delegateTo.trim() !== '');

    if (category === 'Maintenance') {
      // For Maintenance: Update the name for each assigned task directly in maintenance_tasks
      const updatePromises = delegationAssignments.map(task => {
        const updateQuery = `
          UPDATE maintenance_tasks
          SET name = $1
          WHERE id = $2
        `;
        return client.query(updateQuery, [task.delegateTo, task.task_id]);
      });
      await Promise.all(updatePromises);
    } else {
      // For Checklist: Insert into delegation table
      if (delegationAssignments.length > 0) {
        const insertPromises = delegationAssignments.map(task => {
          const insertQuery = `
            INSERT INTO delegation (
              task_id, task_description, given_by, name, 
              created_at, status, department, division, unit, frequency,
              task_start_date, planned_date
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          `;
          return client.query(insertQuery, [
            task.task_id,
            task.task_description,
            task.username,
            task.delegateTo,
            task.task_start_date,
            'pending',
            task.department || '',
            task.division || '',
            task.unit || '',
            task.frequency || '',
            task.task_start_date,
            task.planned_date
          ]);
        });
        await Promise.all(insertPromises);
      }
    }

    // Delete tasks that were NOT assigned (if any) or handle deletions for Checklist
    // For Checklist, we delete all handled tasks from the source table
    const table = category === 'Maintenance' ? 'maintenance_tasks' : 'checklist';

    if (category === 'Maintenance') {
      // Only delete tasks that were completely unassigned (if that's the desired flow)
      const unassignedTaskIds = assignments
        .filter(task => !task.delegateTo || task.delegateTo.trim() === '')
        .map(t => t.task_id);

      if (unassignedTaskIds.length > 0) {
        const deleteQuery = `DELETE FROM maintenance_tasks WHERE id = ANY($1)`;
        await client.query(deleteQuery, [unassignedTaskIds]);
      }
    } else {
      // Delete ALL submitted checklist tasks using task_ids
      const taskIds = assignments.map(t => t.task_id);
      const deleteQuery = `DELETE FROM checklist WHERE task_id = ANY($1)`;
      await client.query(deleteQuery, [taskIds]);
    }

    await client.query('COMMIT');

    const delegatedCount = delegationAssignments.length;
    const deletedCount = assignments.length - delegatedCount;

    let message = `Successfully processed ${assignments.length} tasks.`;
    if (delegatedCount > 0) message += ` ${delegatedCount} ${category === 'Maintenance' ? 'updated' : 'transferred'}.`;
    if (deletedCount > 0) message += ` ${deletedCount} deleted.`;

    res.status(200).json({
      success: true,
      tasksTransferred: delegatedCount,
      tasksDeleted: deletedCount,
      message: message
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error assigning individual tasks:", error);
    res.status(500).json({
      success: false,
      message: "Error assigning individual tasks",
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Extend task start date
const extendTask = async (req, res) => {
  const { taskId, newStartDate } = req.body;

  if (!taskId || !newStartDate) {
    return res.status(400).json({
      success: false,
      message: "Missing required fields: taskId, newStartDate"
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Update the task start date (and planned_date) but KEEP the original time
    // We cast the new date string to a DATE, and add the existing TIME component from the record
    const updateQuery = `
      UPDATE checklist
      SET task_start_date = ($1::date + task_start_date::timestamp::time),
          planned_date = ($1::date + planned_date::timestamp::time)
      WHERE task_id = $2
      RETURNING *
    `;

    // Pass strictly the YYYY-MM-DD string, not a timestamp string
    const result = await client.query(updateQuery, [newStartDate, taskId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: "Task not found"
      });
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: "Task extended successfully",
      task: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error extending task:", error);
    res.status(500).json({
      success: false,
      message: "Error extending task",
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Delete individual task
const deleteTask = async (req, res) => {
  const { taskId } = req.params;
  const { category } = req.query;

  if (!taskId) {
    return res.status(400).json({
      success: false,
      message: "Missing required field: taskId"
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete the specific task from the appropriate table
    const isMaintenance = category === 'Maintenance';
    const table = isMaintenance ? 'maintenance_tasks' : 'checklist';
    const idColumn = isMaintenance ? 'id' : 'task_id';

    const deleteQuery = `
      DELETE FROM ${table}
      WHERE ${idColumn} = $1
      RETURNING *
    `;

    const result = await client.query(deleteQuery, [taskId]);

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: "Task not found or already deleted"
      });
    }

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: "Task deleted successfully",
      task: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error deleting task:", error);
    res.status(500).json({
      success: false,
      message: "Error deleting task",
      error: error.message
    });
  } finally {
    client.release();
  }
};

// Bulk delete tasks
const bulkDeleteTasks = async (req, res) => {
  const { taskIds, category } = req.body;

  if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
    return res.status(400).json({
      success: false,
      message: "Missing or invalid field: taskIds array"
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete multiple tasks from the appropriate table
    const isMaintenance = category === 'Maintenance';
    const table = isMaintenance ? 'maintenance_tasks' : 'checklist';
    const idColumn = isMaintenance ? 'id' : 'task_id';

    const deleteQuery = `
      DELETE FROM ${table}
      WHERE ${idColumn} = ANY($1)
    `;

    const result = await client.query(deleteQuery, [taskIds]);

    await client.query('COMMIT');

    res.status(200).json({
      success: true,
      message: `Successfully deleted ${result.rowCount} tasks`,
      deletedCount: result.rowCount
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error bulk deleting tasks:", error);
    res.status(500).json({
      success: false,
      message: "Error bulk deleting tasks",
      error: error.message
    });
  } finally {
    client.release();
  }
};

export { transferTasks, getUserTasks, assignIndividualTasks, extendTask, deleteTask, bulkDeleteTasks };
