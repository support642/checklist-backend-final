import {
    createPendingConfirmation
} from "./chatbotConfirmationService.js";

import {
    getEmployeeTasks,
    getEmployeeWorkHistory
} from "./chatbotService.js";


const isValidDate = (date) => {
    if (
        typeof date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(date)
    ) {
        return false;
    }

    const parsed = new Date(`${date}T00:00:00Z`);

    return (
        !Number.isNaN(parsed.getTime()) &&
        parsed.toISOString().slice(0, 10) === date
    );
};


export const executeEmployeeTool = async (
    toolName,
    args,
    username,
    options = {}
) => {
    if (!username) {
        throw new Error(
            "Authenticated employee identity is required."
        );
    }

    switch (toolName) {

        // =====================================
        // Retrieve employee tasks
        // =====================================

        case "get_my_tasks": {
            const status = args.status || "all";

            if (
                !["all", "pending", "completed", "other"].includes(status)
            ) {
                throw new Error("Invalid task status filter.");
            }

            return await getEmployeeTasks(username, status);
        }


        // =====================================
        // Retrieve employee work history
        // =====================================

        case "get_my_work_history": {
            const date = args.date || null;
            const startDate = args.start_date || null;
            const endDate = args.end_date || null;

            // Specific date and date range cannot be combined.

            if (date && (startDate || endDate)) {
                throw new Error(
                    "Provide either a specific date or a date range, not both."
                );
            }

            // Validate specific date.

            if (date && !isValidDate(date)) {
                throw new Error(
                    "Invalid date. Use YYYY-MM-DD."
                );
            }

            // Both date-range boundaries are mandatory.

            if (Boolean(startDate) !== Boolean(endDate)) {
                throw new Error(
                    "Both start_date and end_date are required."
                );
            }

            // Validate date range.

            if (startDate && endDate) {
                if (
                    !isValidDate(startDate) ||
                    !isValidDate(endDate)
                ) {
                    throw new Error(
                        "Invalid date range. Use YYYY-MM-DD."
                    );
                }

                if (startDate > endDate) {
                    throw new Error(
                        "Start date cannot be after end date."
                    );
                }

                return await getEmployeeWorkHistory(
                    username,
                    null,
                    {
                        startDate,
                        endDate
                    }
                );
            }

            // Backward-compatible specific-date or recent-history request.

            return await getEmployeeWorkHistory(
                username,
                date
            );
        }


        // =====================================
        // Prepare work report confirmation
        // =====================================

        case "submit_my_work_report": {
            const {
                work_details,
                status,
                duration
            } = args;

            if (
                typeof work_details !== "string" ||
                !work_details.trim() ||
                work_details.length > 5000
            ) {
                throw new Error(
                    "Invalid work report description."
                );
            }

            if (
                !["Completed", "In Progress", "Pending"].includes(status)
            ) {
                throw new Error(
                    "Invalid work report status."
                );
            }

            if (
                typeof duration !== "string" ||
                !duration.trim() ||
                duration.length > 50
            ) {
                throw new Error(
                    "Invalid work duration."
                );
            }

            // Persist confirmation in PostgreSQL.
            // No work report is inserted at this stage.

            const confirmation = await createPendingConfirmation(
                username,
                {
                    work_details: work_details.trim(),
                    status,
                    duration: duration.trim()
                }
            );

            return {
                success: true,
                requires_confirmation: true,
                message: "Work report prepared. Employee confirmation is required.",
                ...confirmation
            };
        }


        default:
            throw new Error(
                `Unsupported employee tool: ${toolName}`
            );
    }
};

// =====================================================================
// Admin read-only data tools
// =====================================================================

import {
    getTaskSummary,
    getEmployeeWiseSummary,
    listTasks,
    findEmployees,
    listDepartments
} from "./chatbotDataService.js";

const ADMIN_TOOL_HANDLERS = {
    get_task_summary: getTaskSummary,
    get_employee_wise_summary: getEmployeeWiseSummary,
    list_tasks: listTasks,
    find_employees: findEmployees,
    list_departments: listDepartments
};

export const executeAdminTool = async (toolName, args, profile) => {
    const handler = ADMIN_TOOL_HANDLERS[toolName];

    if (!handler) {
        throw new Error(`Unsupported admin tool: ${toolName}`);
    }

    return await handler(args || {}, profile);
};
