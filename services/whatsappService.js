import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const MAYTAPI_BASE_URL = 'https://api.maytapi.com/api';
const PRODUCT_ID = process.env.MAYTAPI_PRODUCT_ID;
const PHONE_ID = process.env.MAYTAPI_PHONE_ID;
const API_TOKEN = process.env.MAYTAPI_API_TOKEN;

/**
 * GLOBAL TOGGLE TO DISCONNECT WHATSAPP SERVICE
 * Set to true to disable all outgoing WhatsApp messages.
 * Set to false to enable the service when Maytapi is configured.
 */
const IS_WHATSAPP_DISCONNECTED = true;

/**
 * Format phone number for WhatsApp
 * Ensures the number includes country code (defaults to India +91)
 */
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return null;
  
  // Convert to string and remove any spaces, dashes, or parentheses
  let phone = String(phoneNumber).replace(/[\s\-\(\)]/g, '');
  
  // If number starts with 0, replace with 91 (India)
  if (phone.startsWith('0')) {
    phone = '91' + phone.substring(1);
  }
  
  // If number doesn't have country code (less than 12 digits), add 91
  if (phone.length === 10) {
    phone = '91' + phone;
  }
  
  return phone;
};

/**
 * Format date to readable format (YYYY-MM-DD HH:mm:ss)
 * Converts ISO format like "2025-12-30T09:00:00" to "2025-12-30 09:00:00"
 */
const formatDate = (dateStr) => {
  if (!dateStr) return 'N/A';
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (e) {
    return dateStr;
  }
};

/**
 * Send WhatsApp message via Maytapi API
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {string} message - Message text to send
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
    if (!PRODUCT_ID || !PHONE_ID || !API_TOKEN) {
      console.error('❌ Maytapi configuration missing in .env');
      return { success: false, error: 'Configuration missing' };
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(phoneNumber);
    
    if (!formattedPhone) {
      console.error('❌ Invalid phone number provided');
      return { success: false, error: 'Invalid phone number' };
    }

    console.log(`📱 Sending WhatsApp to: ${formattedPhone}`);

   const response = await axios.post(
  `${MAYTAPI_BASE_URL}/${PRODUCT_ID}/${PHONE_ID}/sendMessage`,
  {
    to_number: formattedPhone,
    type: "text",
    message: message,
    preview_url: true      // 👈 THIS MAKES LINKS CLICKABLE
  },
  {
    headers: {
      "x-maytapi-key": API_TOKEN,
      "Content-Type": "application/json"
    },
    timeout: 10000
  }
);


    console.log('✅ WhatsApp message sent successfully');
    return { success: true, data: response.data };

  } catch (error) {
    console.error('❌ WhatsApp send error:', error.response?.data || error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Send task assignment notification via WhatsApp
 * @param {string|number} phoneNumber - Recipient phone number
 * @param {object} taskDetails - Task details object
 */
export const sendTaskAssignmentNotification = async (phoneNumber, taskDetails) => {
  const { doerName, taskId, givenBy, description, dueDate, frequency } = taskDetails;
  
  // Determine header based on frequency
  const isOneTime = frequency && frequency.toLowerCase() === 'onetime';
  const header = isOneTime 
    ? '🔔 REMINDER: DELEGATION TASK*' 
    : '🔔 REMINDER: CHECKLIST TASK*';
  
  // App link for task completion
  const appLink = 'https://checklist-frontend-nu.vercel.app';
  
  const message = `${header}

Dear ${doerName || 'Team Member'},

You have been assigned a new task. Please find the details below:

📌 Task ID: ${taskId || 'N/A'}
🧑‍💼 Allocated By: ${givenBy || 'N/A'}
📝 Task Description: ${description || 'N/A'}
⏳ Deadline: ${formatDate(dueDate)}

Closure Link:
${appLink}

Please make sure the task is completed before the deadline. For any assistance, feel free to reach out.

Best regards,
Rama Udyog Group.`;

  return await sendWhatsAppMessage(phoneNumber, message);
};

/**
 * Send delegation task status update notification to specific admin number
 * @param {object} taskDetails - Details of the task being updated
 * @param {string} updateType - Type of update ('done', 'partial_done', 'extend')
 */
export const sendDelegationStatusUpdateNotification = async (taskDetails, updateType) => {
  const { name, task_id, task_description, next_extend_date, reason } = taskDetails;
  
  const adminNumber = '9637655555';
  
  console.log(`[WhatsApp] Update Type: ${updateType}, Task ID: ${task_id}, Admin Number: ${adminNumber}`);
  console.log(`[WhatsApp] Name: ${name}, Next Extend Date: ${next_extend_date}`);
  
  let statusHeader = '📋 *DELEGATION TASK UPDATE*';
  let statusText = 'Updated';

  if (updateType === 'done') {
    statusHeader = '✅ *DELEGATION TASK COMPLETED*';
    statusText = 'Completed';
  } else if (updateType === 'partial_done') {
    statusHeader = '🟡 *DELEGATION TASK PARTIALLY DONE*';
    statusText = 'Partially Done';
  } else if (updateType === 'extend') {
    statusHeader = '📋 *DELEGATION TASK EXTENDED*';
    statusText = 'Extended';
  }

  const appLink = 'https://checklist-frontend-nu.vercel.app';
  
  const message = `${statusHeader}

Name: ${name || 'N/A'}
Task ID: ${task_id || 'N/A'}
Description: ${task_description || 'N/A'}
${updateType === 'extend' ? `Extend Date: ${formatDate(next_extend_date)}\n` : ''}Remarks: ${reason || 'N/A'}

📌 *Status:* Task marked as ${statusText}.

App Link:
${appLink}`;

  const result = await sendWhatsAppMessage(adminNumber, message);
  console.log(`[WhatsApp] Result for ${adminNumber}:`, JSON.stringify(result));
  return result;
};

export default { 
  sendWhatsAppMessage, 
  sendTaskAssignmentNotification, 
  sendDelegationStatusUpdateNotification 
};

