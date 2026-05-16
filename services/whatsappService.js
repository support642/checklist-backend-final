import axios from 'axios';
import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_CLOUD_API_ACCESS_TOKEN;
const WHATSAPP_WABA_ID = process.env.WHATSAPP_CLOUD_API_WABA_ID;
const WHATSAPP_VERSION = process.env.WHATSAPP_CLOUD_API_VERSION || 'v19.0';
const WHATSAPP_BASE_URL = `https://graph.facebook.com/${WHATSAPP_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

/**
 * GLOBAL TOGGLE TO DISCONNECT WHATSAPP SERVICE
 * Set to true to disable all outgoing WhatsApp messages.
 * Set to false to enable the service when WhatsApp Cloud API is configured.
 */
const IS_WHATSAPP_DISCONNECTED = false;

/**
 * WHATSAPP DYNAMIC CONFIGURATION
 * These values are now primarily fetched from the database (system_settings table).
 * .env values serve as a secondary fallback.
 */
let cachedConfig = null;
let lastCacheUpdate = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch WhatsApp configuration from database system_settings
 */
export const getWhatsAppDynamicConfig = async () => {
  const now = Date.now();
  if (cachedConfig && (now - lastCacheUpdate < CACHE_TTL)) {
    return cachedConfig;
  }

  try {
    const result = await pool.query(
      "SELECT setting_key, setting_value FROM system_settings WHERE category = 'whatsapp'"
    );

    const dbConfig = {};
    result.rows.forEach(row => {
      dbConfig[row.setting_key] = row.setting_value;
    });

    // Structure the config strictly from DB values
    const config = {
      templates: {
        task_assignment: {
          name: dbConfig['whatsapp_task_assignment_name'] || 'new_task_assign',
          lang: dbConfig['whatsapp_task_assignment_lang'] || 'en'
        },
        maintenance: {
          name: dbConfig['whatsapp_maintenance_name'] || 'maintenance_task',
          lang: dbConfig['whatsapp_maintenance_lang'] || 'en'
        },
        delegation: {
          name: dbConfig['whatsapp_delegation_name'] || 'delegation_status',
          lang: dbConfig['whatsapp_delegation_lang'] || 'en'
        },
        checklist: {
          name: dbConfig['whatsapp_checklist_name'] || 'checklist_assignment_v2',
          lang: dbConfig['whatsapp_checklist_lang'] || 'en'
        },
        transfer: {
          name: dbConfig['whatsapp_transfer_name'] || 'task_transferred',
          lang: dbConfig['whatsapp_transfer_lang'] || 'en'
        },
        overdue: {
          name: dbConfig['whatsapp_overdue_name'] || 'task_overdue_summary_v1',
          lang: dbConfig['whatsapp_overdue_lang'] || 'en'
        }
      },
      admin: {
        notification_number: dbConfig['whatsapp_admin_number'] || process.env.WHATSAPP_ADMIN_NUMBER || '917772999905'
      }
    };

    // Log a warning if any mapping is missing in DB
    const actions = ['task_assignment', 'maintenance', 'delegation', 'checklist', 'overdue'];
    actions.forEach(action => {
      if (!dbConfig[`whatsapp_${action}_name`]) {
        console.warn(`⚠️ Warning: WhatsApp template for [${action}] is not mapped in system_settings. Using hardcoded default.`);
      }
    });

    cachedConfig = config;
    lastCacheUpdate = now;
    return config;
  } catch (error) {
    console.error('❌ CRITICAL: Error fetching WhatsApp config from DB:', error.message);
    // Return hardcoded defaults only as a last resort to prevent total crash
    return {
      templates: {
        task_assignment: { name: 'new_task_assign', lang: 'en' },
        maintenance: { name: 'maintenance_task', lang: 'en' },
        delegation: { name: 'delegation_status', lang: 'en' },
        checklist: { name: 'checklist_assignment_v2', lang: 'en' },
        transfer: { name: 'task_transferred', lang: 'en' },
        overdue: { name: 'task_overdue_summary_v1', lang: 'en' }
      },
      admin: {
        notification_number: process.env.WHATSAPP_ADMIN_NUMBER || '917772999905'
      }
    };
  }
};


/**
 * Format phone number for WhatsApp Business API
 * Meta requires: [Country Code][Number] with NO leading + or 00.
 */
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;

  // Remove all non-numeric characters (spaces, dashes, +, etc.)
  let phone = String(phoneNumber).replace(/\D/g, '');

  // If number starts with 0, remove it and assume India (91)
  if (phone.startsWith('0')) {
    phone = '91' + phone.substring(1);
  }

  // If number is exactly 10 digits, add India country code (91)
  if (phone.length === 10) {
    phone = '91' + phone;
  }

  return phone;
};

/**
 * Format date to readable format (YYYY-MM-DD HH:mm:ss)
 * Converts ISO format like "2025-12-30T09:00:00" to "2025-12-30 09:00:00"
 */
/**
 * Format date to readable format (DD/MM/YYYY)
 */
export const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';

  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;

    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    // Return clean DD/MM/YYYY format
    return `${day}/${month}/${year}`;
  } catch (e) {
    return dateStr;
  }
};

/**
 * Send a simple text message via WhatsApp Cloud API
 * NOTE: This requires the recipient to have sent a message to the business in the last 24 hours.
 * For notifications outside this window, use sendWhatsAppTemplate.
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {string} message - Message text
 * @returns {Promise<object>} - API response
 */
export const sendWhatsAppMessage = async (phoneNumber, message) => {
  try {
    // Global Disconnect Check
    if (IS_WHATSAPP_DISCONNECTED) {
      console.log('🔇 WhatsApp service is currently DISCONNECTED. Message skipped.');
      return { success: true, message: 'WhatsApp service is temporarily disconnected' };
    }

    // Validate configuration
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
      console.error('❌ WhatsApp Cloud API configuration missing in .env');
      return { success: false, error: 'Configuration missing' };
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);
    if (!formattedPhone) {
      console.error('❌ Invalid phone number provided');
      return { success: false, error: 'Invalid phone number' };
    }

    console.log(`📱 Sending WhatsApp Text Message to: ${formattedPhone}`);

    const response = await axios.post(
      WHATSAPP_BASE_URL,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: formattedPhone,
        type: "text",
        text: {
          preview_url: true,
          body: message
        }
      },
      {
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN.trim()}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    console.log('✅ WhatsApp text message sent successfully');
    return { success: true, data: response.data };

  } catch (error) {
    console.error('❌ WhatsApp text message send error:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Fetch templates from Meta and sync with local whatsapp_templates_library
 * This runs on startup and updates the library table.
 */
export const fetchAndSyncWhatsAppTemplates = async () => {
  try {
    if (!WHATSAPP_WABA_ID || !WHATSAPP_ACCESS_TOKEN) {
      console.warn('⚠️ WhatsApp Sync skipped: WABA_ID or ACCESS_TOKEN missing');
      return;
    }

    const url = `https://graph.facebook.com/${WHATSAPP_VERSION}/${WHATSAPP_WABA_ID}/message_templates?limit=100`;

    console.log('🔄 Syncing WhatsApp templates from Meta...');
    const response = await axios.get(url, {
      headers: { "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN.trim()}` }
    });

    if (response.data && response.data.data) {
      const templates = response.data.data;

      for (const tmpl of templates) {
        // Upsert into library
        await pool.query(
          `INSERT INTO whatsapp_templates_library 
           (template_name, language_code, category, status, components, last_synced)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (template_name, language_code) 
           DO UPDATE SET 
             category = EXCLUDED.category,
             status = EXCLUDED.status,
             components = EXCLUDED.components,
             last_synced = CURRENT_TIMESTAMP`,
          [tmpl.name, tmpl.language, tmpl.category, tmpl.status, JSON.stringify(tmpl.components)]
        );
      }

      console.log(`✅ WhatsApp Sync Complete: ${templates.length} templates discovered/updated.`);

      // Debug specific template structure for the user
      console.log('🔍 WhatsApp Template Structure Inventory:');
      templates.forEach(t => {
        const body = t.components.find(c => c.type === 'BODY');
        const paramCount = (body?.text?.match(/{{[0-9]+}}/g) || []).length;
        console.log(`   - [${t.name}] (${t.language}): ${paramCount} params | Text: ${body?.text?.substring(0, 50)}...`);
      });

      // Auto-update mapping languages if they exist in the library
      await autoFixTemplateLanguages();
    }
  } catch (error) {
    console.error('❌ WhatsApp Sync Error:', error.response?.data || error.message);
  }
};

/**
 * Automatically update system_settings languages if a template name is found 
 * in the library but with a different language code.
 */
const autoFixTemplateLanguages = async () => {
  try {
    // This is a helper to ensure that if a user has 'en_US' in settings but only 'en' exists on Meta,
    // we don't need to manually fix it if we can find the template.
    // For now, we'll keep it simple and just log if there's a mismatch.
    const config = await getWhatsAppDynamicConfig();
    const actions = ['task_assignment', 'maintenance', 'delegation', 'checklist'];

    for (const action of actions) {
      const { name, lang } = config.templates[action];
      const result = await pool.query(
        "SELECT language_code FROM whatsapp_templates_library WHERE template_name = $1",
        [name]
      );

      if (result.rows.length > 0) {
        const actualLangs = result.rows.map(r => r.language_code);
        if (!actualLangs.includes(lang)) {
          const correctLang = actualLangs[0]; // Take the first available language from Meta
          console.log(`🔧 Auto-fixing WhatsApp language for [${action}]: ${lang} -> ${correctLang}`);

          await pool.query(
            "UPDATE system_settings SET setting_value = $1, updated_at = CURRENT_TIMESTAMP WHERE setting_key = $2",
            [correctLang, `whatsapp_${action}_lang`]
          );
        }
      }
    }
  } catch (e) {
    console.error('❌ Error during auto-fix check:', e.message);
  }
};

// Initial sync on startup
fetchAndSyncWhatsAppTemplates();

/**
 * Send WhatsApp Template via WhatsApp Cloud API
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {string} templateName - Name of the template (approved in Meta)
 * @param {Array} components - Template parameters (parameters for body, header, etc.)
 * @param {string} languageCode - Language code (default: en_US)
 * @returns {Promise<object>} - API response
 */
export const sendWhatsAppTemplate = async (phoneNumber, templateName, components = [], languageCode = null) => {
  try {
    // If languageCode is not provided, use global default
    const finalLang = languageCode || process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en';

    // Global Disconnect Check
    if (IS_WHATSAPP_DISCONNECTED) {
      console.log('🔇 WhatsApp service is currently DISCONNECTED. Template skipped.');
      return { success: true, message: 'WhatsApp service is temporarily disconnected' };
    }

    // Validate configuration
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN || !WHATSAPP_WABA_ID) {
      console.error('❌ WhatsApp Cloud API configuration missing in .env');
      return { success: false, error: 'Configuration missing' };
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);
    if (!formattedPhone) {
      console.error('❌ Invalid phone number provided');
      return { success: false, error: 'Invalid phone number' };
    }

    console.log(`📱 Sending WhatsApp Template [${templateName}] to: ${formattedPhone}`);

    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: formattedPhone,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: finalLang
        },
        components: components
      }
    };

    // Phase 2: Validate structure before sending
    validateTemplateComponents(templateName, components);

    console.log('📡 SENDING PAYLOAD TO META:', JSON.stringify(payload, null, 2));

    const response = await axios.post(
      WHATSAPP_BASE_URL,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${WHATSAPP_ACCESS_TOKEN.trim()}`,
          "Content-Type": "application/json"
        },
        timeout: 20000
      }
    );

    // Detailed success logging for tracking silent delivery issues
    console.log('✅ WhatsApp Template Accepted by Meta:', {
      wa_id: response.data.contacts?.[0]?.wa_id,
      message_id: response.data.messages?.[0]?.id,
      status: 'Accepted for delivery'
    });

    // Phase 3: Log the message for webhook tracking
    try {
      const msgId = response.data.messages?.[0]?.id;
      if (msgId) {
        await pool.query(
          `INSERT INTO whatsapp_message_logs 
           (message_id, recipient_number, template_name, status) 
           VALUES ($1, $2, $3, $4)`,
          [msgId, formattedPhone, templateName, 'sent']
        );
      }
    } catch (logError) {
      console.warn('⚠️ Warning: Failed to log WhatsApp message to DB:', logError.message);
      // We don't throw here to avoid failing the actual notification if logging fails
    }

    return { success: true, data: response.data };

  } catch (error) {
    const errorData = error.response?.data?.error || {};
    console.error('❌ WhatsApp Template Send Error:', {
      message: errorData.message || error.message,
      code: errorData.code,
      type: errorData.type,
      details: errorData.error_data?.details
    });
    return { success: false, error: errorData };
  }
};

/**
 * Helper to validate component structure before sending
 */
const validateTemplateComponents = (templateName, components) => {
  if (!components || components.length === 0) {
    console.warn(`⚠️ Warning: Sending template [${templateName}] with NO components.`);
    return;
  }

  const body = components.find(c => c.type === 'body');
  if (!body || !body.parameters || body.parameters.length === 0) {
    console.warn(`⚠️ Warning: Template [${templateName}] might be missing BODY parameters.`);
  }
};

/**
 * Send task assignment notification via WhatsApp Template
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {object} taskDetails - Task details object
 */
export const sendTaskAssignmentNotification = async (phoneNumber, taskDetails) => {
  const { doerName, taskId, givenBy, description, dueDate, division, department } = taskDetails;

  // App link for task completion
  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [new_task_assign]:
   * Params: 1.Name, 2.Desc, 3.Deadline, 4.AssignedBy, 5.Dept, 6.Division, 7.ID, 8.Link
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(doerName || 'Team Member') },
        { type: "text", text: String(description || 'N/A') },
        { type: "text", text: String(formatDate(dueDate)) },
        { type: "text", text: String(givenBy || 'N/A') },
        { type: "text", text: String(department || 'N/A') },
        { type: "text", text: String(division || 'N/A') },
        { type: "text", text: String(taskId || 'N/A') },
        { type: "text", text: String(appLink) }
      ]
    }
  ];

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.task_assignment;

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};

/**
 * Send maintenance assignment notification via WhatsApp Template
 */
export const sendMaintenanceAssignmentNotification = async (phoneNumber, taskDetails) => {
  const { doerName, taskId, givenBy, description, dueDate, machineName, partName, partArea, division, department } = taskDetails;

  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [maintenance_task_v2]:
   * Params: 1.Machine, 2.Part, 3.Area, 4.Division, 5.Dept, 6.ID, 7.AssignedBy, 8.Desc, 9.Deadline, 10.Link
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(doerName || 'Team Member') },
        { type: "text", text: description || 'N/A' },
        { type: "text", text: formatDate(dueDate) },
        { type: "text", text: machineName || 'N/A' },
        { type: "text", text: partName || 'N/A' },
        { type: "text", text: partArea || 'N/A' },
        { type: "text", text: givenBy || 'N/A' },
        { type: "text", text: String(department || 'N/A') },
        { type: "text", text: String(division || 'N/A') },
        { type: "text", text: String(taskId || 'N/A') },
        { type: "text", text: appLink }
      ]
    }
  ];

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.maintenance;

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};

/**
 * Send task transfer notification via WhatsApp Template
 * @param {string|number} phoneNumber - Recipient phone number (The person receiving the task)
 * @param {object} taskDetails - Task details object
 */
export const sendTaskTransferNotification = async (phoneNumber, taskDetails) => {
  const { recipientName, taskId, transferredFrom, description, dueDate, division, department } = taskDetails;

  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [task_transfer_v1]:
   * Params: 1.Name, 2.ID, 3.TransferredFrom, 4.Division, 5.Dept, 6.Desc, 7.Deadline, 8.Link
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(recipientName || 'Team Member') },
        { type: "text", text: String(description || 'N/A') },
        { type: "text", text: String(formatDate(dueDate)) },
        { type: "text", text: String(transferredFrom || 'N/A') },
        { type: "text", text: String(department || 'N/A') },
        { type: "text", text: String(division || 'N/A') },
        { type: "text", text: String(taskId || 'N/A') },
        { type: "text", text: String(appLink) }
      ]
    }
  ];

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.transfer;

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};

/**
 * Send delegation task status update notification via WhatsApp Template
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {object} taskDetails - Details of the task being updated
 * @param {string} updateType - Type of update ('done', 'partial_done', 'extend')
 */
export const sendDelegationStatusUpdateNotification = async (phoneNumber, taskDetails, updateType) => {
  const { name, task_id, task_description, remarks, division, department } = taskDetails;

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.delegation;

  let statusText = 'Updated';
  if (updateType === 'done') statusText = 'Completed';
  else if (updateType === 'extend') statusText = 'Extended';

  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [delegation_status_v2]:
   * Params: 1.StatusHeader, 2.User, 3.Desc, 4.Remarks, 5.Status, 6.Division, 7.Dept, 8.ID, 9.Link
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: statusText.toUpperCase() },
        { type: "text", text: name || 'N/A' },
        { type: "text", text: task_description || 'N/A' },
        { type: "text", text: remarks || 'N/A' },
        { type: "text", text: statusText },
        { type: "text", text: division || 'N/A' },
        { type: "text", text: department || 'N/A' },
        { type: "text", text: String(task_id || 'N/A') },
        { type: "text", text: appLink }
      ]
    }
  ];

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};

/**
 * Send dedicated checklist assignment notification via WhatsApp Template
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {object} checklistDetails - Checklist details object
 */
export const sendChecklistAssignmentNotification = async (phoneNumber, checklistDetails) => {
  const { doerName, checklistName, assignedBy, department, date, division } = checklistDetails;

  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [checklist_assignment]: (Check your actual name in Meta)
   * Body: "Hello {{1}}, you have been assigned a checklist: {{2}} for {{3}}. Assigned by: {{4}}, Dept: {{5}}, Division: {{6}}. Link: {{7}}"
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(doerName || 'Team Member') },
        { type: "text", text: String(checklistName || 'N/A') },
        { type: "text", text: String(formatDate(date)) },
        { type: "text", text: String(assignedBy || 'N/A') },
        { type: "text", text: String(department || 'N/A') },
        { type: "text", text: String(division || 'N/A') },
        { type: "text", text: String(appLink) }
      ]
    }
  ];

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.checklist;

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};

/**
 * Send task overdue alert via WhatsApp Template
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {object} taskDetails - Task details object
 */
export const sendTaskOverdueNotification = async (phoneNumber, taskDetails) => {
  const { doerName, taskId, givenBy, description, dueDate, division, department } = taskDetails;

  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [task_overdue_v1]:
   * Params: 1.Name, 2.ID, 3.AssignedBy, 4.Division, 5.Department, 6.Description, 7.Deadline, 8.Link
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(doerName || 'Team Member') },
        { type: "text", text: String(taskId || 'N/A') },
        { type: "text", text: String(givenBy || 'N/A') },
        { type: "text", text: String(division || 'N/A') },
        { type: "text", text: String(department || 'N/A') },
        { type: "text", text: String(description || 'N/A') },
        { type: "text", text: String(formatDate(dueDate)) },
        { type: "text", text: String(appLink) }
      ]
    }
  ];

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.overdue;

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};

/**
 * Send a bulk overdue task summary via WhatsApp Template
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {string} userName - Employee name
 * @param {Array} tasks - Array of task objects { taskId, description, dueDate }
 */
export const sendTaskOverdueSummaryNotification = async (phoneNumber, userName, tasks) => {
  if (!tasks || tasks.length === 0) return;

  const appLink = 'https://checklist-frontend-nu.vercel.app';
  
  // Build the summary string (bulled list)
  // WhatsApp has a limit on parameter length (~1024 chars), so we truncate if needed
  let summaryText = '';
  tasks.forEach((t, index) => {
    const line = `• #${t.taskId}: ${t.description?.substring(0, 40) || 'N/A'} (Due: ${formatDate(t.dueDate)}) `;
    if ((summaryText + line).length < 900) { // Keep buffer for safety
      summaryText += line;
    }
  });

  if (tasks.length > (summaryText.match(/•/g) || []).length) {
    summaryText += `... and ${tasks.length - (summaryText.match(/•/g) || []).length} more tasks.`;
  }

  /**
   * EXPECTED META STRUCTURE [task_overdue_summary_v1]:
   * Params: 1.UserName, 2.TaskCount, 3.SummaryList, 4.PortalLink
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(userName || 'Team Member') },
        { type: "text", text: String(tasks.length) },
        { type: "text", text: String(summaryText.trim()) },
        { type: "text", text: String(appLink) }
      ]
    }
  ];

  const config = await getWhatsAppDynamicConfig();
  const template = config.templates.overdue;

  return await sendWhatsAppTemplate(phoneNumber, template.name, components, template.lang);
};


/**
 * Send delegation completion alert to the admin/giver
 */
export const sendDelegationCompletionToAdmin = async (phoneNumber, taskDetails) => {
  const { name, task_id, task_description, division, department } = taskDetails;
  const appLink = 'https://checklist-frontend-nu.vercel.app';

  /**
   * EXPECTED META STRUCTURE [delegation_task_completed_admin]:
   * Params: 1.AdminName, 2.DoerName, 3.TaskDesc, 4.TaskID, 5.Division, 6.Dept, 7.Link
   */
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: 'Admin' }, // Generic or look up
        { type: "text", text: name || 'Team Member' },
        { type: "text", text: task_description || 'N/A' },
        { type: "text", text: String(task_id || 'N/A') },
        { type: "text", text: division || 'N/A' },
        { type: "text", text: department || 'N/A' },
        { type: "text", text: appLink }
      ]
    }
  ];

  return await sendWhatsAppTemplate(phoneNumber, 'delegation_task_completed_admin', components, 'en');
};

/**
 * [OLD VERSION] Send daily management summary report
 * Commented out to migrate to new 16-parameter template.
 */
/*
export const sendDailyManagementSummary = async (phoneNumber, stats) => {
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: stats.period },
        { type: "text", text: String(stats.checklist.total) },
        { type: "text", text: String(stats.checklist.done) },
        { type: "text", text: String(stats.checklist.pending) },
        { type: "text", text: String(stats.checklist.overdue) },
        { type: "text", text: String(stats.delegation.total) },
        { type: "text", text: String(stats.delegation.done) },
        { type: "text", text: String(stats.delegation.pending) },
        { type: "text", text: String(stats.delegation.overdue) },
        { type: "text", text: String(stats.maintenance.total) },
        { type: "text", text: String(stats.maintenance.done) },
        { type: "text", text: String(stats.maintenance.pending) },
        { type: "text", text: String(stats.maintenance.overdue) }
      ]
    }
  ];

  return await sendWhatsAppTemplate(phoneNumber, 'daily_management_summary', components, 'en');
};
*/

/**
 * Send daily management summary report (Updated 16-parameter version)
 * Expects stats: { period, checklist, delegation, maintenance }
 * Each module stats should have: { total, done, pending, overdue, onTimeScore }
 */
export const sendDailyManagementSummary = async (phoneNumber, stats) => {
  const components = [
    {
      type: "body",
      parameters: [
        { type: "text", text: stats.period },          // {{1}}
        { type: "text", text: stats.checklistStr },    // {{2}}
        { type: "text", text: stats.delegationStr },   // {{3}}
        { type: "text", text: stats.maintenanceStr }   // {{4}}
      ]
    }
  ];

  return await sendWhatsAppTemplate(phoneNumber, 'daily_summary_v2', components, 'en');
};

export default {
  sendWhatsAppMessage,
  sendWhatsAppTemplate,
  sendTaskAssignmentNotification,
  sendMaintenanceAssignmentNotification,
  sendTaskTransferNotification,
  sendDelegationStatusUpdateNotification,
  sendChecklistAssignmentNotification,
  sendTaskOverdueNotification,
  sendTaskOverdueSummaryNotification,
  sendDelegationCompletionToAdmin,
  sendDailyManagementSummary
};


