import pool from "../../config/db.js";

// Get all users with access settings
export async function getAllUsers(req, res) {
    try {
        const result = await pool.query(
            `SELECT user_name, email_id, role, department, subscription_access_system, status 
       FROM users 
       ORDER BY user_name`
        );

        const users = result.rows.map(user => {
            const access = user.subscription_access_system || { systems: [], pages: [] };
            return {
                ...user,
                username: user.user_name,
                systemAccess: access.systems || [],
                pageAccess: access.pages || []
            };
        });

        return res.json({ users });
    } catch (err) {
        console.error("Get Users Error:", err);
        res.status(500).json({ error: "Failed to fetch users" });
    }
}

// Update user access settings
export async function updateUserAccess(req, res) {
    try {
        const { username } = req.params;
        const { systems, pages } = req.body;

        const accessObj = {
            systems: Array.isArray(systems) ? systems : [],
            pages: Array.isArray(pages) ? pages : []
        };

        const result = await pool.query(
            `UPDATE users 
             SET subscription_access_system = $1 
             WHERE user_name = $2 
             RETURNING user_name, subscription_access_system`,
            [JSON.stringify(accessObj), username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error("Update User Access Error:", err);
        res.status(500).json({ error: "Failed to update user access" });
    }
}

// Get single user access settings
export async function getUserAccess(req, res) {
    try {
        const { username } = req.params;
        const result = await pool.query(
            `SELECT user_name, email_id, role, department, subscription_access_system FROM users WHERE user_name = $1`,
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "User not found" });
        }

        const user = result.rows[0];
        const access = user.subscription_access_system || { systems: [], pages: [] };

        res.json({
            user: {
                ...user,
                username: user.user_name,
                systemAccess: access.systems || [],
                pageAccess: access.pages || []
            }
        });
    } catch (err) {
        console.error("Get User Access Error:", err);
        res.status(500).json({ error: "Failed to fetch user access" });
    }
}
