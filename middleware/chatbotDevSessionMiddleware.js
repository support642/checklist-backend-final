import pool from "../config/chatbotDb.js";

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const chatbotDevSessionMiddleware = async (req, res, next) => {
    const sessionId = req.headers["x-session-id"];

    if (!sessionId || !UUID_REGEX.test(sessionId)) {
        return res.status(401).json({
            error: "Session ID missing or invalid.",
            force_logout: true
        });
    }

    try {
        const { rows } = await pool.query(
            `SELECT username
             FROM sessions
             WHERE session_id = $1
               AND is_active = TRUE
             LIMIT 1`,
            [sessionId]
        );

        if (rows.length === 0) {
            return res.status(401).json({
                error: "Session invalid or expired.",
                force_logout: true
            });
        }

        req.user = {
            username: rows[0].username
        };

        next();
    } catch (error) {
        console.error("Chatbot development session error:", error);

        return res.status(500).json({
            error: "Unable to validate development session."
        });
    }
};

export default chatbotDevSessionMiddleware;
