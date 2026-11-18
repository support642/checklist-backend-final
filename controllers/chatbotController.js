import {
    getEmployeeTasks,
    getEmployeeWorkHistory,
    submitEmployeeWorkReport
} from "../services/chatbotService.js";

import {
    getAdminWorkReports,
    getAdminDashboardSummary,
    getDepartmentWiseAnalytics,
    getAdminTaskAnalytics,
    getEmployeeWiseTaskAnalytics,
    getAdminWorkReportsByDateRange
} from "../services/chatbotAdminService.js";


// ==========================================
// 1. EMPLOYEE: Retrieve assigned tasks
// ==========================================

export const getMyTasks = async (req, res) => {
    try {
        const username = req.user?.username;

        if (!username) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const statusFilter = req.query.status || "all";

        const allowedStatuses = [
            "all", "pending", "completed", "other"
        ];

        if (!allowedStatuses.includes(statusFilter)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status filter."
            });
        }

        const result = await getEmployeeTasks(username, statusFilter);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Chatbot Controller Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Unable to retrieve your tasks."
        });
    }
};


// ==========================================
// 2. EMPLOYEE: Retrieve work history
// ==========================================

export const getMyWorkHistory = async (req, res) => {
    try {
        const username = req.user?.username;

        if (!username) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const date = req.query.date || null;

        if (date !== null) {
            const isValidFormat = /^\d{4}-\d{2}-\d{2}$/.test(date);

            const parsedDate = new Date(`${date}T00:00:00.000Z`);

            const isValidDate =
                !Number.isNaN(parsedDate.getTime()) &&
                parsedDate.toISOString().slice(0, 10) === date;

            if (!isValidFormat || !isValidDate) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid date. Use YYYY-MM-DD format."
                });
            }
        }

        const result = await getEmployeeWorkHistory(username, date);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Work History Controller Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Unable to retrieve your work history."
        });
    }
};


// ==========================================
// 3. EMPLOYEE: Submit daily work report
// ==========================================

export const submitMyWorkReport = async (req, res) => {
    try {
        const username = req.user?.username;

        if (!username) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        const {
            work_details,
            status,
            duration
        } = req.body;

        if (
            typeof work_details !== "string" ||
            !work_details.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Work details are required."
            });
        }

        if (work_details.trim().length > 5000) {
            return res.status(400).json({
                success: false,
                message: "Work details cannot exceed 5000 characters."
            });
        }

        const allowedStatuses = [
            "Completed",
            "In Progress",
            "Pending"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid status."
            });
        }

        if (
            typeof duration !== "string" ||
            !duration.trim() ||
            duration.trim().length > 50
        ) {
            return res.status(400).json({
                success: false,
                message: "A valid duration is required."
            });
        }

        const result = await submitEmployeeWorkReport(
            username,
            work_details.trim(),
            status,
            duration.trim()
        );

        return res.status(201).json({
            success: true,
            message: "Daily work report submitted successfully.",
            data: result
        });

    } catch (error) {
        console.error("Work Report Submission Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.statusCode
                ? error.message
                : "Unable to submit your work report."
        });
    }
};


// ==========================================
// 4. ADMIN: Retrieve employee work reports
// ==========================================

export const getAdminReports = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(403).json({
                success: false,
                message: "Admin authorization required."
            });
        }

        const result = await getAdminWorkReports(req.admin);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Admin Reports Controller Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message ||
                "Unable to retrieve admin reports."
        });
    }
};


// ==========================================
// 5. ADMIN: Dashboard summary
// ==========================================

export const getAdminDashboard = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(403).json({
                success: false,
                message: "Admin authorization required."
            });
        }

        const result = await getAdminDashboardSummary(req.admin);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Admin Dashboard Controller Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message ||
                "Unable to retrieve admin dashboard summary."
        });
    }
};


// ==========================================
// 6. ADMIN: Department-wise analytics
// ==========================================

export const getDepartmentAnalytics = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(403).json({
                success: false,
                message: "Admin authorization required."
            });
        }

        const result = await getDepartmentWiseAnalytics(req.admin);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Department Analytics Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message ||
                "Unable to retrieve department analytics."
        });
    }
};


// ==========================================
// 7. ADMIN: Consolidated task analytics
// ==========================================

export const getAdminTaskAnalyticsController = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(403).json({
                success: false,
                message: "Admin authorization required."
            });
        }

        const result = await getAdminTaskAnalytics(req.admin);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Admin Task Analytics Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message ||
                "Unable to retrieve task analytics."
        });
    }
};


// ==========================================
// 8. ADMIN: Employee-wise task analytics
// ==========================================

export const getEmployeeWiseTaskAnalyticsController = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(403).json({
                success: false,
                message: "Admin authorization required."
            });
        }

        const result = await getEmployeeWiseTaskAnalytics(req.admin);

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Employee-wise Task Analytics Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message ||
                "Unable to retrieve employee-wise task analytics."
        });
    }
};


// ==========================================
// 9. ADMIN: Date-range work reports
// ==========================================

export const getAdminWorkReportsByDateRangeController = async (req, res) => {
    try {
        if (!req.admin) {
            return res.status(403).json({
                success: false,
                message: "Admin authorization required."
            });
        }

        const {
            startDate,
            endDate,
            employee
        } = req.query;

        // Validate pagination parameters
        const parsePositiveInteger = (value, defaultValue) => {
            if (value === undefined) {
                return defaultValue;
            }

            if (
                typeof value !== "string" ||
                !/^\d+$/.test(value)
            ) {
                return null;
            }

            const parsed = Number(value);

            return (
                Number.isSafeInteger(parsed) &&
                parsed >= 1
            )
                ? parsed
                : null;
        };

        const page = parsePositiveInteger(req.query.page, 1);
        const limit = parsePositiveInteger(req.query.limit, 100);

        if (
            page === null ||
            limit === null ||
            limit > 500
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid pagination. Page must be positive and limit must be between 1 and 500."
            });
        }

        // Validate date format and actual calendar date
        const isValidDate = (value) => {
            if (
                typeof value !== "string" ||
                !/^\d{4}-\d{2}-\d{2}$/.test(value)
            ) {
                return false;
            }

            const parsed = new Date(`${value}T00:00:00.000Z`);

            return (
                !Number.isNaN(parsed.getTime()) &&
                parsed.toISOString().slice(0, 10) === value
            );
        };

        if (
            !isValidDate(startDate) ||
            !isValidDate(endDate)
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid startDate and endDate are required in YYYY-MM-DD format."
            });
        }

        if (startDate > endDate) {
            return res.status(400).json({
                success: false,
                message: "startDate cannot be later than endDate."
            });
        }

        // Validate optional employee filter
        if (
            employee !== undefined &&
            (
                typeof employee !== "string" ||
                !employee.trim()
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid employee filter."
            });
        }

        // Retrieve reports with pagination
        const result = await getAdminWorkReportsByDateRange(
            req.admin,
            {
                startDate,
                endDate,
                employeeUsername: employee?.trim() || null,
                page,
                limit
            }
        );

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error("Admin Date Range Reports Error:", error);

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message ||
                "Unable to retrieve date-range reports."
        });
    }
};


// ==========================================
// 10. COMPATIBILITY EXPORTS FOR CHATBOT ROUTES
// ==========================================

export const getAdminReport = getAdminReports;

export const getAdminWorkReportsController = getAdminReports;

export const getAdminDashboardSummaryController = getAdminDashboard;

export const getDepartmentWiseAnalyticsController = getDepartmentAnalytics;