import { generateAIResponse } from "../services/chatbotAIService.js";

import {
    getRequesterProfile,
    runExport,
    ADMIN_ROLES
} from "../services/chatbotDataService.js";


// ==========================================
// Export chat results (PDF / Excel data) - READ-ONLY
// ==========================================

export const exportChatData = async (req, res) => {
    try {
        const profile = await getRequesterProfile(req.user?.username);

        if (!profile || !ADMIN_ROLES.includes(profile.role)) {
            return res.status(403).json({
                success: false,
                message: "Administrator access required."
            });
        }

        const { type, filters } = req.body || {};

        if (
            !["tasks", "employee_summary", "employees"].includes(type) ||
            !filters ||
            typeof filters !== "object"
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid export type and filters are required."
            });
        }

        const result = await runExport(type, filters, profile);

        if (!result?.success) {
            return res.status(400).json({
                success: false,
                message: result?.message || "Unable to prepare export."
            });
        }

        return res.status(200).json({ success: true, data: result });

    } catch (error) {
        console.error("Chat Export Error:", error.message);

        return res.status(error.statusCode || 400).json({
            success: false,
            message: error.message || "Unable to prepare export."
        });
    }
};


import {
    confirmPendingConfirmation
} from "../services/chatbotConfirmationService.js";


// ==========================================
// AI Chat API
// ==========================================

export const handleChatMessage = async (req, res) => {
    try {
        const username = req.user?.username;

        if (!username) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const { messages } = req.body || {};

        if (!Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Conversation messages are required."
            });
        }

        if (messages.length > 20) {
            return res.status(400).json({
                success: false,
                message: "Maximum 20 conversation messages allowed."
            });
        }

        const validMessages = [];

        for (const message of messages) {
            if (
                !message ||
                !["user", "assistant"].includes(message.role) ||
                typeof message.content !== "string" ||
                !message.content.trim() ||
                message.content.length > 5000
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid conversation message."
                });
            }

            validMessages.push({
                role: message.role,
                content: message.content.trim()
            });
        }

        if (
            validMessages[validMessages.length - 1].role !== "user"
        ) {
            return res.status(400).json({
                success: false,
                message: "The latest message must be from the user."
            });
        }

        // Last downloadable list from the chat (re-validated and re-scoped on export).
        const { previous_export } = req.body || {};
        const previousExport =
            previous_export &&
            typeof previous_export === "object" &&
            ["tasks", "employee_summary", "employees"].includes(previous_export.type) &&
            previous_export.filters &&
            typeof previous_export.filters === "object"
                ? {
                    type: previous_export.type,
                    filters: previous_export.filters,
                    total: Number(previous_export.total) || 0
                }
                : null;

        const result = await generateAIResponse(
            validMessages,
            username,
            { previousExport }
        );

        return res.status(200).json({
            success: true,
            message: "AI response generated successfully.",
            data: {
                reply: result.reply,
                pending_confirmation: result.pendingConfirmation,
                export_request: result.exportRequest || null
            }
        });

    } catch (error) {
        console.error("Chat API Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to process your message."
        });
    }
};


// ==========================================
// Confirm and Submit Work Report
// ==========================================

export const confirmWorkReport = async (req, res) => {
    try {
        const username = req.user?.username;

        if (!username) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const { confirmation_token } = req.body || {};

        if (
            typeof confirmation_token !== "string" ||
            !confirmation_token.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Confirmation token is required."
            });
        }

        const result = await confirmPendingConfirmation(
            confirmation_token.trim(),
            username
        );

        return res.status(
            result.alreadySubmitted ? 200 : 201
        ).json({
            success: true,
            message: result.alreadySubmitted
                ? "This work report was already submitted successfully."
                : "Work report submitted successfully.",
            data: {
                report: result.report,
                already_submitted: result.alreadySubmitted
            }
        });

    } catch (error) {
        console.error(
            "Work Report Confirmation Error:",
            error.message
        );

        const statusCode = error.statusCode || 500;

        return res.status(statusCode).json({
            success: false,
            message: statusCode === 500
                ? "Unable to submit work report. Please try again."
                : error.message
        });
    }
};
