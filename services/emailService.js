import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'onboarding@resend.dev'; // Default Resend testing email

/**
 * Format Date to human readable
 */
const formatDateTime = (dateStr) => {
  if (!dateStr) return 'N/A';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    return date.toLocaleString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch (err) {
    return dateStr;
  }
};

// GLOBAL TOGGLE: Set to true to enable sending emails, false to disconnect/disable
const ENABLE_EMAIL_SERVICE = true;

/**
 * Generic send email function
 */
export const sendEmail = async ({ to, subject, html }) => {
  if (!ENABLE_EMAIL_SERVICE) {
    console.log(`⚠️ Email Service is globally disabled. Skipped sending "${subject}" to: ${to}`);
    return { success: true, message: 'Email service is currently disabled via global toggle.' };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('❌ Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('❌ Email Service Error:', err);
    return { success: false, error: err.message };
  }
};

/**
 * Template for Task Assignment Notification
 */
export const sendTaskAssignmentEmail = async (to, details) => {
  const { doerName, taskId, givenBy, description, dueDate, frequency } = details;
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #4f46e5;">New Task Assigned</h2>
      <p>Hello <strong>${doerName}</strong>,</p>
      <p>A new task has been assigned to you by <strong>${givenBy}</strong>.</p>
      
      <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Task ID:</strong> ${taskId}</p>
        <p><strong>Description:</strong> ${description}</p>
        <p><strong>Frequency:</strong> ${frequency}</p>
        <p><strong>Due Date:</strong> ${formatDateTime(dueDate)}</p>
      </div>
      
      <p>Please log in to the portal to view and update the task.</p>
      <a href="https://checklist-frontend-nu.vercel.app" style="display: inline-block; background-color: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">View Portal</a>
      
      
      <hr style="margin: 30px 0; border: 0; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #6b7280;">This is an automated notification. Please do not reply.</p>
    </div>
  `;

  return sendEmail({
    to,
    subject: `New Task Assigned: ${description.substring(0, 30)}...`,
    html,
  });
};

/**
 * Template for Maintenance Task Assignment Notification
 */
export const sendMaintenanceAssignmentEmail = async (to, details) => {
  const { doerName, taskId, givenBy, description, dueDate, frequency, machineName, partName, partArea } = details;
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #7c3aed; border-radius: 10px;">
      <h2 style="color: #7c3aed;">🛠️ Maintenance Task Assigned</h2>
      <p>Hello <strong>${doerName}</strong>,</p>
      <p>A new maintenance task has been assigned to you by <strong>${givenBy}</strong>.</p>
      
      <div style="background-color: #f5f3ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;">
        <p><strong>Machine Name:</strong> ${machineName || 'N/A'}</p>
        <p><strong>Part Name:</strong> ${partName || 'N/A'}</p>
        <p><strong>Part Area:</strong> ${partArea || 'N/A'}</p>
        <hr style="border: 0; border-top: 1px solid #ddd; margin: 10px 0;">
        <p><strong>Task ID:</strong> ${taskId}</p>
        <p><strong>Description:</strong> ${description}</p>
        <p><strong>Frequency:</strong> ${frequency}</p>
        <p><strong>Due Date:</strong> ${formatDateTime(dueDate)}</p>
      </div>
      
      <p>Please log in to the portal to view and update the machine maintenance details.</p>
      <a href="https://checklist-frontend-nu.vercel.app" style="display: inline-block; background-color: #7c3aed; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">View Portal</a>
      
      <hr style="margin: 30px 0; border: 0; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #6b7280;">This is an automated notification from Rama Udyog Maintenance System.</p>
    </div>
  `;

  return sendEmail({
    to,
    subject: `🛠️ Maintenance: ${machineName || 'Task'} - ${description.substring(0, 20)}...`,
    html,
  });
};

/**
 * Template for Delegation Status Update (Admin Notification)
 */
export const sendDelegationStatusUpdateEmail = async (adminEmails, task, status) => {
  const { task_id, name, task_description, given_by } = task;
  
  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
      <h2 style="color: #059669;">Delegation Status Updated</h2>
      <p>The status of a delegated task has been updated to <strong>${status.toUpperCase()}</strong>.</p>
      
      <div style="background-color: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0;">
        <p><strong>Task ID:</strong> ${task_id}</p>
        <p><strong>Updated By:</strong> ${name}</p>
        <p><strong>Task Description:</strong> ${task_description}</p>
        <p><strong>Originally Assigned By:</strong> ${given_by}</p>
      </div>
      
      <p>Please review the update in the admin dashboard.</p>
      <a href="https://checklist-frontend-nu.vercel.app" style="display: inline-block; background-color: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Check Status</a>
    </div>
  `;

  return sendEmail({
    to: adminEmails,
    subject: `[Update] Task ${task_id}: ${status.toUpperCase()} by ${name}`,
    html,
  });
};

/**
 * Template for Urgent Task Alert (Checklist/Delegation)
 */
export const sendUrgentTaskEmail = async (to, details) => {
  const { name, taskId, description, dueDate, givenBy } = details;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #dc2626; border-radius: 10px;">
      <h2 style="color: #dc2626;">🚨 URGENT TASK ALERT</h2>
      <p>Hello <strong>${name}</strong>,</p>
      <p>The following task requires your <strong>immediate attention</strong>:</p>
      
      <div style="background-color: #fef2f2; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
        <p><strong>Task ID:</strong> ${taskId}</p>
        <p><strong>Task:</strong> ${description}</p>
        <p><strong>Planned Date:</strong> ${formatDateTime(dueDate)}</p>
        <p><strong>Given By:</strong> ${givenBy}</p>
      </div>
      
      <p>Please take immediate action and update the portal once completed.</p>
      <a href="https://checklist-frontend-nu.vercel.app" style="display: inline-block; background-color: #dc2626; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; margin-top: 10px;">Take Action Now</a>
    </div>
  `;

  return sendEmail({
    to,
    subject: `🚨 URGENT: Action Required for Task ${taskId}`,
    html,
  });
};

/**
 * Template for Document Sharing
 */
export const sendDocumentShareEmail = async (to, details) => {
  const { recipientName, documentName, message, documentUrl } = details;

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 10px;">
      <h2 style="color: #4f46e5;">Document Shared With You</h2>
      <p>Hello <strong>${recipientName}</strong>,</p>
      <p>A document has been shared with you via the Checklist Portal.</p>
      
      <div style="background-color: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
        <h3 style="margin-top: 0; color: #111827;">${documentName}</h3>
        ${message ? `<p style="color: #4b5563; font-style: italic;">"${message}"</p>` : ''}
        <a href="${documentUrl || 'https://checklist-frontend-nu.vercel.app'}" style="display: inline-block; background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 10px;">View Document</a>
      </div>
      
      <p style="font-size: 14px; color: #6b7280;">If the button above doesn't work, please log in to the portal directly.</p>
      <hr style="margin: 30px 0; border: 0; border-top: 1px solid #eee;" />
      <p style="font-size: 12px; color: #9ca3af;">This is an automated notification. Please do not reply.</p>
    </div>
  `;

  return sendEmail({
    to,
    subject: `Shared Document: ${documentName}`,
    html,
  });
};

/**
 * Template for Repair Ticket Generation
 */
export const sendRepairTicketEmail = async (to, details) => {
  const { ticketId, machineName, issueDescription, assignedPerson, filledBy } = details;
  const portalUrl = 'https://checklist-frontend-nu.vercel.app/repair/pending';

  const html = `
    <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #f3e8ff; border-radius: 12px; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
      <div style="background-color: #7c3aed; padding: 15px; border-radius: 8px 8px 0 0; text-align: center;">
        <h2 style="color: #ffffff; margin: 0; font-size: 20px;">New Repair Ticket Generated</h2>
      </div>
      
      <div style="padding: 20px; color: #1f2937;">
        <p style="font-size: 16px;">Hello,</p>
        <p>A new repair ticket has been generated in the Checklist Portal.</p>
        
        <div style="background-color: #f9fafb; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #7c3aed;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 5px 0; color: #6b7280; font-size: 12px; font-weight: bold; text-transform: uppercase;">Ticket ID</td>
              <td style="padding: 5px 0; color: #7c3aed; font-weight: bold; font-family: monospace;">#${ticketId}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #6b7280; font-size: 12px; font-weight: bold; text-transform: uppercase;">Machine Name</td>
              <td style="padding: 5px 0; color: #111827; font-weight: bold;">${machineName}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #6b7280; font-size: 12px; font-weight: bold; text-transform: uppercase;">Issue</td>
              <td style="padding: 5px 0; color: #374151; font-style: italic;">"${issueDescription}"</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #6b7280; font-size: 12px; font-weight: bold; text-transform: uppercase;">Assigned To</td>
              <td style="padding: 5px 0; color: #111827;">${assignedPerson}</td>
            </tr>
            <tr>
              <td style="padding: 5px 0; color: #6b7280; font-size: 12px; font-weight: bold; text-transform: uppercase;">Reported By</td>
              <td style="padding: 5px 0; color: #111827;">${filledBy}</td>
            </tr>
          </table>
        </div>
        
        <div style="text-align: center; margin-top: 30px;">
          <p style="font-size: 14px; color: #4b5563; margin-bottom: 20px;">Please log in to the portal to manage this ticket.</p>
          <a href="${portalUrl}" style="display: inline-block; background-color: #7c3aed; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 14px; box-shadow: 0 10px 15px -3px rgba(124, 58, 237, 0.3);">View Portal</a>
        </div>
      </div>
      
      <div style="border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 20px; text-align: center;">
        <p style="font-size: 12px; color: #9ca3af; margin: 0;">This is an automated notification. Please do not reply directly to this email.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to,
    subject: `[Repair #${ticketId}] New Ticket Generated: ${machineName}`,
    html,
  });
};
