import * as documentService from "../../../services/doc-services/document-services/document-service.js";
import { uploadDocumentImage } from "../../../middleware/s3Upload.js";
import { sendDocumentShareEmail } from "../../../services/emailService.js";
import { documentShareService } from "../../../services/doc-services/documentShare.service.js";

// Create document
export async function createDocument(req, res) {
    try {
        const docData = { ...req.body };

        // If image is base64, upload to S3 first
        if (docData.image && docData.image.startsWith('data:')) {
            try {
                const s3Url = await uploadDocumentImage(docData.image, docData.document_name);
                docData.image = s3Url;
            } catch (uploadErr) {
                console.error("S3 Upload Error:", uploadErr);
                // Continue without image if upload fails
                docData.image = null;
            }
        }

        const document = await documentService.createDocument(docData);
        res.status(201).json({ success: true, document });
    } catch (err) {
        console.error("Create Document Error:", err);
        res.status(500).json({ error: "Failed to create document", details: err.message });
    }
}

// Create multiple documents
export async function createMultipleDocuments(req, res) {
    try {
        const { documents } = req.body;

        if (!Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ error: "Please provide an array of documents" });
        }

        const createdDocuments = [];
        for (const doc of documents) {
            const docData = { ...doc };

            // If image is base64, upload to S3 first
            if (docData.image && docData.image.startsWith('data:')) {
                try {
                    const s3Url = await uploadDocumentImage(docData.image, docData.document_name);
                    docData.image = s3Url;
                } catch (uploadErr) {
                    console.error("S3 Upload Error for document:", docData.document_name, uploadErr);
                    // Continue without image if upload fails
                    docData.image = null;
                }
            }

            const created = await documentService.createDocument(docData);
            createdDocuments.push(created);
        }

        res.status(201).json({
            success: true,
            message: `${createdDocuments.length} document(s) created successfully`,
            documents: createdDocuments
        });
    } catch (err) {
        console.error("Create Multiple Documents Error:", err);
        res.status(500).json({ error: "Failed to create documents", details: err.message });
    }
}

// Get all documents
export async function getAllDocuments(req, res) {
    try {
        const documents = await documentService.getAllDocuments();
        res.json({ success: true, documents });
    } catch (err) {
        console.error("Get Documents Error:", err);
        res.status(500).json({ error: "Failed to fetch documents" });
    }
}

// Get document by ID
export async function getDocumentById(req, res) {
    try {
        const { id } = req.params;
        const document = await documentService.getDocumentById(id);

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        res.json({ success: true, document });
    } catch (err) {
        console.error("Get Document Error:", err);
        res.status(500).json({ error: "Failed to fetch document" });
    }
}

// Update document
export async function updateDocument(req, res) {
    if(!["super_admin", "admin", "div_admin"].includes((req.user.role || "").toLowerCase())) {
        return res.status(403).json({
            message: "Access denied"
        });
    }
    try {
        const { id } = req.params;
        const document = await documentService.updateDocument(id, req.body);

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        res.json({ success: true, document });
    } catch (err) {
        console.error("Update Document Error:", err);
        res.status(500).json({ error: "Failed to update document" });
    }
}

// Delete document (soft delete)-- "OBSOLETE"
// export async function deleteDocument(req, res) {
//     try {
//         const { id } = req.params;
//         const document = await documentService.deleteDocument(id);

//         if (!document) {
//             return res.status(404).json({ error: "Document not found" });
//         }

//         res.json({ success: true, message: "Document deleted successfully" });
//     } catch (err) {
//         console.error("Delete Document Error:", err);
//         res.status(500).json({ error: "Failed to delete document" });
//     }
// }

// Get documents by category
export async function getDocumentsByCategory(req, res) {
    try {
        const { category } = req.params;
        const documents = await documentService.getDocumentsByCategory(category);
        res.json({ success: true, documents });
    } catch (err) {
        console.error("Get Documents by Category Error:", err);
        res.status(500).json({ error: "Failed to fetch documents" });
    }
}

// Get documents needing renewal
export async function getDocumentsNeedingRenewal(req, res) {
    try {
        const documents = await documentService.getDocumentsNeedingRenewal();
        console.log("Renewal documents", documents);
        res.json({ success: true, documents });
    } catch (err) {
        console.error("Get Renewal Documents Error:", err);
        res.status(500).json({ error: "Failed to fetch documents" });
    }
}

// Get document stats
export async function getDocumentStats(req, res) {
    try {
        const stats = await documentService.getDocumentStats();
        res.json({ success: true, stats });
    } catch (err) {
        console.error("Get Document Stats Error:", err);
        res.status(500).json({ error: "Failed to fetch document stats" });
    }
}

// Share document via email/WhatsApp
export async function shareDocumentEmail(req, res) {
    try {
        const { recipientName, recipientEmail, recipientPhone, message, documentId } = req.body;

        if ((!recipientEmail && !recipientPhone) || !documentId) {
            return res.status(400).json({ error: "Recipient contact and document ID are required" });
        }

        // Fetch document details
        const document = await documentService.getDocumentById(documentId);

        if (!document) {
            return res.status(404).json({ error: "Document not found" });
        }

        const shareResults = { email: null, whatsapp: null };

        // 📧 Send the email
        if (recipientEmail) {
            try {
                const emailResult = await sendDocumentShareEmail(recipientEmail, {
                    recipientName: recipientName || "User",
                    documentName: document.document_name,
                    message: message || "Please check this document.",
                    documentUrl: document.image // This is the S3 URL
                });
                shareResults.email = emailResult.success;
            } catch (err) {
                console.error("Email Share Error:", err);
                shareResults.email = false;
            }
        }

        // 📱 Send WhatsApp
        if (recipientPhone) {
            try {
                // Clean phone number
                let cleanPhone = recipientPhone.replace(/[\s\-\+]/g, "");
                if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

                const docDetails = {
                    documentType: document.document_type || '',
                    category: document.category || '',
                    companyName: document.person_name || document.company_department || '',
                    needsRenewal: document.need_renewal === 'yes' ? 'Yes' : 'No',
                    renewalDate: document.renewal_date || '-',
                };

                const waResult = await documentShareService(
                    cleanPhone,
                    document.document_name,
                    document.image || "",
                    message || `Hello, sharing "${document.document_name}"`,
                    docDetails
                );
                shareResults.whatsapp = true;
            } catch (err) {
                console.error("WhatsApp Share Error:", err);
                shareResults.whatsapp = false;
            }
        }

        res.json({ 
            success: true, 
            message: "Sharing processed", 
            results: shareResults 
        });
    } catch (err) {
        console.error("Share Document Email Error:", err);
        res.status(500).json({ error: "Failed to share document via email", details: err.message });
    }
}
