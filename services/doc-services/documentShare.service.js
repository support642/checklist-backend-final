import axios from "axios";

/**
 * Send a WhatsApp message with document details via Maytapi
 * @param {string} phone - Recipient phone number (with country code)
 * @param {string} documentName - Name of the document
 * @param {string} documentUrl - URL of the document
 * @param {string} message - Custom message from user
 * @param {object} docDetails - Additional document details (type, category, name, renewal, renewalDate)
 */

export const documentShareService = async (phone, documentName, documentUrl, message, docDetails = {}) => {
    const productId = process.env.WHATSAPP_PRODUCT_ID;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const apiToken = process.env.WHATSAPP_API_TOKEN;

    if (!productId || !phoneId || !apiToken) {
        throw new Error("Maytapi credentials not configured. Check WHATSAPP_PRODUCT_ID, WHATSAPP_PHONE_ID, and WHATSAPP_API_TOKEN in .env");
    }

    const apiUrl = `https://api.maytapi.com/api/${productId}/${phoneId}/sendMessage`;
    const headers = {
        "x-maytapi-key": apiToken,
        "Content-Type": "application/json",
    };

    // Build template message with document details
    const templateLines = [
        message || `📄 *Document Shared*`,
        ``,
        `📋 *Document Name:* ${documentName}`,
        `📂 *Document Type:* ${docDetails.documentType || '-'}`,
        `🏷️ *Category:* ${docDetails.category || '-'}`,
        `👤 *Name:* ${docDetails.companyName || '-'}`,
        `🔄 *Renewal:* ${docDetails.needsRenewal || 'No'}`,
        `📅 *Renewal Date:* ${docDetails.renewalDate || '-'}`,
    ];

    // Shorten document URL so WhatsApp auto-links it
    let shortUrl = '';
    if (documentUrl) {
        try {
            const shortened = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(documentUrl)}`);
            shortUrl = shortened.data;
        } catch {
            shortUrl = documentUrl; // fallback to original URL
        }
    }

    // Add document URL on its own line if available
    if (shortUrl) {
        templateLines.push(``, shortUrl);
    }

    const textMessage = templateLines.join('\n');

    const response = await axios.post(apiUrl, {
        to_number: phone,
        type: "text",
        message: textMessage,
    }, { headers });

    return response.data;
};