import cron from 'node-cron';
import pool from '../config/db.js';
import { sendTaskOverdueSummaryNotification, sendDailyManagementSummary } from './whatsappService.js';

/**
 * Process all overdue tasks and send WhatsApp reminders
 * This function groups tasks by employee to avoid spamming.
 */
export const processOverdueReminders = async () => {
  console.log('⏰ [Scheduler] Starting overdue task check...');

  try {
    // 1. Fetch overdue tasks from all relevant tables
    // Checklist tasks
    const checklistQuery = `
      SELECT 'Checklist' as type, task_id as id, name, task_description as description, task_start_date as due_date
      FROM checklist
      WHERE submission_date IS NULL 
        AND task_start_date::date < CURRENT_DATE
        AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
    `;

    // Maintenance tasks
    const maintenanceQuery = `
      SELECT 'Maintenance' as type, id, name, task_description as description, task_start_date as due_date
      FROM maintenance_tasks
      WHERE submission_date IS NULL 
        AND task_start_date::date < CURRENT_DATE
        AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
    `;

    // Delegation tasks
    const delegationQuery = `
      SELECT 'Delegation' as type, task_id as id, name, task_description as description, planned_date as due_date
      FROM delegation
      WHERE submission_date IS NULL 
        AND planned_date::date < CURRENT_DATE
        AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
    `;

    const [checklistRes, maintenanceRes, delegationRes] = await Promise.all([
      pool.query(checklistQuery),
      pool.query(maintenanceQuery),
      pool.query(delegationQuery)
    ]);

    const allOverdueTasks = [
      ...checklistRes.rows,
      ...maintenanceRes.rows,
      ...delegationRes.rows
    ];

    if (allOverdueTasks.length === 0) {
      console.log('✅ [Scheduler] No overdue tasks found.');
      return { success: true, count: 0 };
    }

    // 2. Group tasks by employee name
    const groupedByEmployee = allOverdueTasks.reduce((acc, task) => {
      if (!task.name) return acc;
      const name = task.name.trim();
      if (!acc[name]) acc[name] = [];
      acc[name].push({
        taskId: task.id,
        description: `[${task.type}] ${task.description}`,
        dueDate: task.due_date
      });
      return acc;
    }, {});

    // 3. Fetch phone numbers for these employees
    const employeeNames = Object.keys(groupedByEmployee);
    const usersRes = await pool.query(
      'SELECT user_name, number FROM users WHERE user_name = ANY($1)',
      [employeeNames]
    );

    const userMap = usersRes.rows.reduce((acc, user) => {
      acc[user.user_name.trim()] = user.number;
      return acc;
    }, {});

    // 4. Send notifications
    console.log(`📡 [Scheduler] Sending reminders to ${employeeNames.length} employees...`);

    let sentCount = 0;
    for (const name of employeeNames) {
      const phoneNumber = userMap[name];
      const tasks = groupedByEmployee[name];

      if (phoneNumber && tasks.length > 0) {
        try {
          await sendTaskOverdueSummaryNotification(phoneNumber, name, tasks);
          sentCount++;
        } catch (err) {
          console.error(`❌ [Scheduler] Failed to send reminder to ${name}:`, err.message);
        }
      } else {
        console.warn(`⚠️ [Scheduler] Skipping ${name}: Phone number not found in users table.`);
      }
    }

    console.log(`✅ [Scheduler] Processed ${sentCount} reminders.`);
    return { success: true, count: sentCount };

  } catch (error) {
    console.error('❌ [Scheduler] Critical error in overdue processing:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Generate and send the Daily Management Summary report
 */
export const processManagementSummary = async () => {
  console.log('📊 [Scheduler] Starting daily management summary generation...');

  try {
    // Build date range strings matching the StatsCard / dashboardController logic
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const pad = (n) => String(n).padStart(2, '0');
    const firstDayStr = `${firstDayOfMonth.getFullYear()}-${pad(firstDayOfMonth.getMonth() + 1)}-${pad(firstDayOfMonth.getDate())}`;
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    // ── CHECKLIST ──────────────────────────────────────────────────────────────
    // Matches getTotalTask / getCompletedTask logic for checklist:
    // Total   = date in [firstDay, today], status not leave/inactive
    // Done    = same date filter + status='yes' + submission_date IS NOT NULL
    // Pending = date in [firstDay, today] + submission_date IS NULL + date >= today
    // Overdue = date in [firstDay, today] + submission_date IS NULL + date <  today
    const checklistStatsQuery = `
      SELECT
        COUNT(*)::int                                                                       AS total,
        COUNT(CASE WHEN status = 'yes' AND submission_date IS NOT NULL THEN 1 END)::int    AS done,
        COUNT(CASE WHEN submission_date IS NULL AND task_start_date::date >= CURRENT_DATE THEN 1 END)::int AS pending,
        COUNT(CASE WHEN submission_date IS NULL AND task_start_date::date <  CURRENT_DATE THEN 1 END)::int AS overdue,
        COUNT(CASE WHEN status = 'yes' AND submission_date IS NOT NULL AND delay <= interval '0' THEN 1 END)::int AS on_time
      FROM checklist
      WHERE task_start_date::date >= $1
        AND task_start_date::date <= $2
        AND (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
    `;

    // ── DELEGATION ─────────────────────────────────────────────────────────────
    // Matches getTotalTask / getCompletedTask logic for delegation:
    // Total   = planned_date >= firstDay  OR  submission_date IS NOT NULL (any completed)
    // Done    = submission_date IS NOT NULL AND (planned_date in range OR submission_date IS NOT NULL)
    // Pending = submission_date IS NULL + planned_date >= today + planned_date in range
    // Overdue = submission_date IS NULL + planned_date <  today + planned_date in range
    const delegationStatsQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN submission_date IS NOT NULL THEN 1 END)::int AS done,
        COUNT(CASE WHEN submission_date IS NULL AND planned_date::date >= CURRENT_DATE THEN 1 END)::int AS pending,
        COUNT(CASE WHEN submission_date IS NULL AND planned_date::date <  CURRENT_DATE THEN 1 END)::int AS overdue,
        COUNT(CASE WHEN submission_date IS NOT NULL AND (color_code_for = '1' OR color_code_for = 1) THEN 1 END)::int AS on_time
      FROM delegation
      WHERE (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
        AND (
          (planned_date::date >= $1 AND planned_date::date <= $2)
          OR (submission_date IS NOT NULL AND submission_date::date >= $1 AND submission_date::date <= $2)
        )
    `;

    // ── MAINTENANCE ────────────────────────────────────────────────────────────
    // Same as checklist logic (uses task_start_date, submission_date, no status='yes' check)
    // Done    = submission_date IS NOT NULL (within date range)
    const maintenanceStatsQuery = `
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN submission_date IS NOT NULL THEN 1 END)::int AS done,
        COUNT(CASE WHEN submission_date IS NULL AND task_start_date::date >= CURRENT_DATE THEN 1 END)::int AS pending,
        COUNT(CASE WHEN submission_date IS NULL AND task_start_date::date <  CURRENT_DATE THEN 1 END)::int AS overdue,
        COUNT(CASE WHEN submission_date IS NOT NULL AND (submission_date::date <= task_start_date::date) THEN 1 END)::int AS on_time
      FROM maintenance_tasks
      WHERE (status IS NULL OR (LOWER(status::text) <> 'leave' AND LOWER(status::text) <> 'inactive'))
        AND (
          (task_start_date::date >= $1 AND task_start_date::date <= $2)
          OR (submission_date IS NOT NULL AND submission_date::date >= $1 AND submission_date::date <= $2)
        )
    `;

    const dateParams = [firstDayStr, todayStr];

    const [checklistRes, delegationRes, maintenanceRes] = await Promise.all([
      pool.query(checklistStatsQuery, dateParams),
      pool.query(delegationStatsQuery, dateParams),
      pool.query(maintenanceStatsQuery, dateParams)
    ]);

    const shortYear = String(now.getFullYear()).slice(-2);
    const periodStr = `1/${now.getMonth() + 1}/${shortYear} to ${now.getDate()}/${now.getMonth() + 1}/${shortYear}`;

    // Helper to calculate on-time score
    const getOnTimeScore = (stats) => {
      const { done, on_time } = stats;
      return done > 0 ? Math.round((on_time / done) * 100) : 0;
    };

    // Helper to format category string
    const formatCategoryStats = (stats) => {
      const score = getOnTimeScore(stats);
      return `📊 Total: ${stats.total || 0} | 🟢 Done: ${stats.done || 0} | 🟡 Pend: ${stats.pending || 0} | 🔴 Over: ${stats.overdue || 0} | *🟣 Score: ${score}%*`;
    };

    const checklistData = checklistRes.rows[0];
    const delegationData = delegationRes.rows[0];
    const maintenanceData = maintenanceRes.rows[0];

    const reportStats = {
      period: periodStr,
      checklistStr: formatCategoryStats(checklistData),
      delegationStr: formatCategoryStats(delegationData),
      maintenanceStr: formatCategoryStats(maintenanceData)
    };

    // 2. Management recipient numbers (Hardcoded as requested)
    const recipientNumbers = ["917772999905", "919764560196"];

    if (recipientNumbers.length === 0) {
      console.warn('⚠️ [Scheduler] No valid management numbers found in .env (MANAGEMENT_NUMBERS).');
      return { success: false, error: 'No recipients' };
    }

    console.log(`📡 [Scheduler] Sending Management Summary to ${recipientNumbers.length} numbers...`);

    for (const phone of recipientNumbers) {
      try {
        await sendDailyManagementSummary(phone, reportStats);
      } catch (err) {
        console.error(`❌ [Scheduler] Failed to send report to ${phone}:`, err.message);
      }
    }

    console.log('✅ [Scheduler] Management Summary completed.');
    return { success: true };

  } catch (error) {
    console.error('❌ [Scheduler] Error generating management summary:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Initialize the scheduler
 * Defaults to running once every day at 9:00 AM
 */
export const initOverdueScheduler = () => {
  // Cron pattern: '0 9 * * *' (9:00 AM every day)
  // For testing, you can use '*/5 * * * *' (every 5 minutes)
  const schedulePattern = process.env.OVERDUE_CRON_SCHEDULE || '0 9 * * *';

  cron.schedule(schedulePattern, () => {
    processOverdueReminders();
  });

  // Daily Management Summary: 10:15 AM IST
  // '15 10 * * *'
  const summaryPattern = process.env.SUMMARY_CRON_SCHEDULE || '15 10 * * *';
  cron.schedule(summaryPattern, () => {
    processManagementSummary();
  });

  console.log(`🚀 [Scheduler] Notification services initialized.`);
  console.log(`   - Overdue Reminders: ${schedulePattern}`);
  console.log(`   - Management Summary: ${summaryPattern}`);
};

export default {
  processOverdueReminders,
  processManagementSummary,
  initOverdueScheduler
};
