import { documentShareService } from "../../services/doc-services/documentShare.service.js";

export const documentShare = async (req, res) => {
    try {
        const { phone, documentName, documentUrl, documentType, category, companyName, needsRenewal, renewalDate, message } = req.body;

        if (!phone || !documentName) {
            return res.status(400).json({
                success: false,
                error: "Phone number and document name are required",
            });
        }

        // Clean phone number: remove spaces, dashes, plus sign
        let cleanPhone = phone.replace(/[\s\-\+]/g, "");

        // If 10-digit Indian number, prepend country code
        if (cleanPhone.length === 10) {
            cleanPhone = `91${cleanPhone}`;
        }

        // Build document details object
        const docDetails = {
            documentType: documentType || '',
            category: category || '',
            companyName: companyName || '',
            needsRenewal: needsRenewal || 'No',
            renewalDate: renewalDate || '',
        };

        const result = await documentShareService(cleanPhone, documentName, documentUrl || "", message, docDetails);

        return res.status(200).json({
            success: true,
            message: "Document shared via WhatsApp successfully",
            data: result,
        });
    } catch (error) {
        console.error("WhatsApp share error:", error?.response?.data || error.message);
        return res.status(500).json({
            success: false,
            error: "Failed to send WhatsApp message",
            details: error?.response?.data?.error?.message || error.message,
        });
    }
};