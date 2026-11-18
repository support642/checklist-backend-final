import pool from "../config/chatbotDb.js";

// Verify that the authenticated employee has an admin role
const chatbotAdminMiddleware = async (req, res, next) => {
    try {
        // Step 1: Get authenticated username
        const username = req.user?.username;

        if (!username) {
            return res.status(401).json({
                success: false,
                message: "Authentication required."
            });
        }

        // Step 2: Verify employee account and role from database
        const query = `
            SELECT
                user_name,
                role,
                status,
                department,
                unit,
                division
            FROM users
            WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
            LIMIT 1;
        `;

        const { rows } = await pool.query(query, [username]);

        if (rows.length === 0 || rows[0].status !== "active") {
            return res.status(403).json({
                success: false,
                message: "Active employee account not found."
            });
        }

        // Step 3: Verify admin role
        const allowedRoles = [
            "admin",
            "div_admin",
            "super_admin"
        ];

        const employeeRole = String(rows[0].role || "").toLowerCase();

        if (!allowedRoles.includes(employeeRole)) {
            return res.status(403).json({
                success: false,
                message: "The AI assistant is available only for administrators."
            });
        }

        // Step 4: Attach trusted employee information
        req.admin = {
            username: rows[0].user_name,
            role: employeeRole,
            department: rows[0].department,
            unit: rows[0].unit,
            division: rows[0].division
        };

        next();

    } catch (error) {
        console.error("Chatbot Admin Authorization Error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to verify admin authorization."
        });
    }
};

export default chatbotAdminMiddleware;