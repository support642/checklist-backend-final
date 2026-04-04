import pool from "../../config/db.js";
import { sendRepairTicketEmail } from "../emailService.js";
import whatsappService from "../../services/whatsappService.js";

/**
 * Helper to fetch user contact info by username
 */
async function getUserContactInfo(username) {
  if (!username) return { email: null, phone: null };
  try {
    const query = 'SELECT email_id, number FROM users WHERE user_name = $1 LIMIT 1';
    const { rows } = await pool.query(query, [username]);
    return {
      email: rows[0]?.email_id || null,
      phone: rows[0]?.number || null
    };
  } catch (err) {
    console.error(`Error fetching contact info for user ${username}:`, err);
    return { email: null, phone: null };
  }
}

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
  const newRepair = rows[0];

  // --- Notification Logic (Email + WhatsApp) ---
  if (newRepair) {
    try {
      const emailRecipients = [];
      const phoneRecipients = [];
      
      // Fetch contact info for Assigned Person
      if (assigned_person) {
        const { email, phone } = await getUserContactInfo(assigned_person);
        if (email) emailRecipients.push(email);
        if (phone) phoneRecipients.push(phone);
      }

      // Fetch contact info for Creator (filled_by)
      if (filled_by) {
        const { email, phone } = await getUserContactInfo(filled_by);
        if (email && !emailRecipients.includes(email)) {
          emailRecipients.push(email);
        }
        if (phone && !phoneRecipients.includes(phone)) {
           phoneRecipients.push(phone);
        }
      }

      const repairDetails = {
        ticketId: newRepair.id,
        machineName: newRepair.machine_name,
        issueDescription: newRepair.issue_description,
        assignedPerson: newRepair.assigned_person || 'Unassigned',
        filledBy: newRepair.filled_by || 'Unknown'
      };

      // 📧 Send Email
      if (emailRecipients.length > 0) {
        console.log(`📧 Sending repair email notification to: ${emailRecipients.join(', ')}`);
        await sendRepairTicketEmail(emailRecipients, repairDetails);
      }

      // 📱 Send WhatsApp
      if (phoneRecipients.length > 0) {
        console.log(`📱 Sending repair WhatsApp notification to: ${phoneRecipients.join(', ')}`);
        const waMessage = `🛠️ *NEW REPAIR TICKET* 🛠️\n\nA new repair request has been created:\n\n📌 Ticket ID: ${repairDetails.ticketId}\n⚙️ Machine: ${repairDetails.machineName}\n📝 Issue: ${repairDetails.issueDescription}\n👤 Assigned to: ${repairDetails.assignedPerson}\n👤 Filed by: ${repairDetails.filledBy}\n\nPlease take necessary actions.`;
        
        for (const phone of phoneRecipients) {
           await whatsappService.sendWhatsAppMessage(phone, waMessage);
        }
      }
    } catch (notifErr) {
      // Don't fail the whole request if notifications fail, just log it
      console.error("Failed to send repair notifications:", notifErr);
    }
  }

  return newRepair;
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
  if (currentUser && currentUser.role === 'user') {
    // Regular users only see requests assigned to them
    query += ` AND assigned_person = $${paramIdx++}`;
    values.push(currentUser.username);
  } else if (currentUser && !['super_admin'].includes(currentUser.role)) {
    // admin / div_admin see requests they filed or are assigned to
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
