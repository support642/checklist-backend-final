import axios from "axios";

/**
 * Send a WhatsApp message with document details via WhatsApp Cloud API
 * @param {string} phone - Recipient phone number (with country code)
 * @param {string} documentName - Name of the document
 * @param {string} documentUrl - URL of the document
 * @param {string} message - Custom message from user
 * @param {object} docDetails - Additional document details (type, category, name, renewal, renewalDate)
 */

export const documentShareService = async (phone, documentName, documentUrl, message, docDetails = {}) => {
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

    /**
     * META STRUCTURE [document_share_v1]:
     * Params: 1.DocName, 2.Type, 3.Category, 4.Division, 5.Dept, 6.SharedBy/Company, 7.Renewal, 8.RenewalDate, 9.Message, 10.Link
     */
    const { sendWhatsAppTemplate, formatDate } = await import("../whatsappService.js");
    
    // Format the renewal date if it exists
    const formattedRenewalDate = docDetails.renewalDate ? formatDate(docDetails.renewalDate) : '-';

    const components = [
        {
            type: "body",
            parameters: [
                { type: "text", text: documentName || '-' },
                { type: "text", text: message || '📄 Document Shared' },
                { type: "text", text: docDetails.companyName || '-' },
                { type: "text", text: formattedRenewalDate },
                { type: "text", text: docDetails.department || '-' },
                { type: "text", text: docDetails.division || '-' },
                { type: "text", text: docDetails.documentType || '-' },
                { type: "text", text: docDetails.category || '-' },
                { type: "text", text: docDetails.needsRenewal || 'No' },
                { type: "text", text: shortUrl || '-' }
            ]
        }
    ];

    return await sendWhatsAppTemplate(phone, 'document_share_v1', components, 'en');
};