export const employeeTools = [
    {
        type: "function",
        function: {
            name: "get_my_tasks",
            description:
                "Retrieve the authenticated employee's assigned tasks. Use this when the employee asks about their tasks, pending work, or completed work.",
            parameters: {
                type: "object",
                properties: {
                    status: {
                        type: "string",
                        enum: ["all", "pending", "completed", "other"],
                        description: "Task status filter."
                    }
                },
                required: ["status"],
                additionalProperties: false
            }
        }
    },

    {
        type: "function",
        function: {
            name: "get_my_work_history",
            description:
                "Retrieve the authenticated employee's previously submitted daily work reports. Use date for a specific date. Use start_date and end_date together for a date range, such as the last 7 days. If no date or range is specified, retrieve recent work history. Never provide null values. Do not combine a specific date with a date range.",
            parameters: {
                type: "object",
                properties: {
                    date: {
                        type: "string",
                        description:
                            "Optional specific date in YYYY-MM-DD format."
                    },
                    start_date: {
                        type: "string",
                        description:
                            "Optional inclusive start date in YYYY-MM-DD format. Must be provided together with end_date."
                    },
                    end_date: {
                        type: "string",
                        description:
                            "Optional inclusive end date in YYYY-MM-DD format. Must be provided together with start_date."
                    }
                },
                required: [],
                additionalProperties: false
            }
        }
    },

    {
        type: "function",
        function: {
            name: "submit_my_work_report",
            description:
                "PREPARE a daily work report for the authenticated employee. Call this tool when the employee asks to prepare, submit, or record a work report. Collect work_details, status, and duration. This tool ONLY prepares a pending report and generates a confirmation token. It DOES NOT insert anything into the database. After calling this tool, present the report details and ask the employee for explicit confirmation. Never claim the report has been submitted. Actual database insertion happens separately through the backend confirmation API.",
            parameters: {
                type: "object",
                properties: {
                    work_details: {
                        type: "string",
                        description: "Description of work performed."
                    },
                    status: {
                        type: "string",
                        enum: ["Completed", "In Progress", "Pending"],
                        description: "Employee-reported work status."
                    },
                    duration: {
                        type: "string",
                        description: "Time spent on the work, such as 2 hours."
                    }
                },
                required: [
                    "work_details",
                    "status",
                    "duration"
                ],
                additionalProperties: false
            }
        }
    }
];

// =====================================================================
// ADMIN (READ-ONLY) DATA TOOLS
// Available only to super_admin / div_admin / admin. Executed by
// chatbotDataService.js on a read-only database connection.
// =====================================================================

const dateRangeProps = {
    start_date: {
        type: "string",
        description:
            "Inclusive start date, YYYY-MM-DD. Default: first day of the current month. For 'today' use today's date; for 'last 7 days / past week' use today minus 6 days."
    },
    end_date: {
        type: "string",
        description: "Inclusive end date, YYYY-MM-DD. Default: today."
    }
};

const taskTypeProp = {
    task_type: {
        type: "string",
        enum: ["all", "checklist", "delegation", "maintenance"],
        description: "Which task system to read. Default 'all'."
    }
};

const orgFilterProps = {
    department: {
        type: "string",
        description: "Optional exact department name (use list_departments if unsure of the spelling)."
    },
    unit: {
        type: "string",
        description: "Optional unit / company name, e.g. 'RAMA UDYOG' (super admin only)."
    },
    division: {
        type: "string",
        description: "Optional division name (super admin only)."
    }
};

export const adminTools = [
    {
        type: "function",
        function: {
            name: "get_task_summary",
            description:
                "Get task COUNTS (total, completed, pending, overdue, due_today, not_done, completion rate) for the whole organisation, a department, or one employee, over a date range. Use for questions like 'total tasks kitne hain', 'kitne complete hue', 'Rahul ke kitne pending hain'.",
            parameters: {
                type: "object",
                properties: {
                    ...taskTypeProp,
                    ...dateRangeProps,
                    employee_name: {
                        type: "string",
                        description: "Optional employee name (full or partial)."
                    },
                    ...orgFilterProps
                },
                required: [],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "get_employee_wise_summary",
            description:
                "Get task counts PER EMPLOYEE, ranked. Use for 'kis employee ke sabse zyada pending/overdue hain', 'top performers', 'department ke employees ka status'.",
            parameters: {
                type: "object",
                properties: {
                    ...taskTypeProp,
                    ...dateRangeProps,
                    ...orgFilterProps,
                    sort_by: {
                        type: "string",
                        enum: ["pending", "overdue", "completed", "total", "completion_rate"],
                        description: "Ranking field. Default 'pending'."
                    },
                    limit: {
                        type: "integer",
                        description: "Number of employees to return (1-50). Default 15."
                    }
                },
                required: [],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_tasks",
            description:
                "List INDIVIDUAL tasks (description, employee, date, status). Use when the user wants to see which tasks, e.g. 'Rahul ke pending tasks dikhao', 'aaj ke overdue tasks'.",
            parameters: {
                type: "object",
                properties: {
                    ...taskTypeProp,
                    ...dateRangeProps,
                    employee_name: {
                        type: "string",
                        description: "Optional employee name (full or partial)."
                    },
                    ...orgFilterProps,
                    status: {
                        type: "string",
                        enum: ["all", "pending", "overdue", "due_today", "completed", "not_done"],
                        description: "Task status filter. Default 'pending'."
                    },
                    limit: {
                        type: "integer",
                        description: "Max tasks to return (1-50). Default 20."
                    }
                },
                required: [],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "find_employees",
            description:
                "Search employees by (partial) name and/or department. Use to resolve which employee the user means or to list a department's staff.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Part of the employee's name."
                    },
                    department: {
                        type: "string",
                        description: "Optional exact department name."
                    },
                    limit: {
                        type: "integer",
                        description: "Rows to return (default 50, max 100)."
                    }
                },
                required: [],
                additionalProperties: false
            }
        }
    },
    {
        type: "function",
        function: {
            name: "list_departments",
            description:
                "List departments (with unit, division and active employee count) the user can access.",
            parameters: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false
            }
        }
    }
];

export const ADMIN_TOOL_NAMES = adminTools.map((tool) => tool.function.name);
