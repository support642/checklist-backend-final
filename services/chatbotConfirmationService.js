import {
    randomBytes,
    createHash
} from "crypto";

import pool from "../config/chatbotDb.js";

const CONFIRMATION_EXPIRY_SECONDS = 300;

const hashToken = (token) => {
    return createHash("sha256")
        .update(token)
        .digest("hex");
};

const createServiceError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};


// ==========================================
// 1. Create persistent pending confirmation
// ==========================================

export const createPendingConfirmation = async (
    username,
    report
) => {
    if (
        !username ||
        !report ||
        typeof report.work_details !== "string" ||
        typeof report.status !== "string" ||
        typeof report.duration !== "string"
    ) {
        throw createServiceError(
            "Valid employee and report details are required."
        );
    }

    const workDetails = report.work_details.trim();
    const duration = report.duration.trim();

    if (
        !workDetails ||
        workDetails.length > 5000 ||
        !duration ||
        duration.length > 50 ||
        !["Completed", "In Progress", "Pending"].includes(report.status)
    ) {
        throw createServiceError(
            "Invalid work report information."
        );
    }

    // Resolve canonical employee identity.
    const employeeResult = await pool.query(
        `
        SELECT user_name
        FROM users
        WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
          AND status::text = 'active'
        LIMIT 1;
        `,
        [username]
    );

    if (employeeResult.rows.length === 0) {
        throw createServiceError(
            "Active employee account not found.",
            403
        );
    }

    const canonicalUsername = employeeResult.rows[0].user_name;

    // Generate a cryptographically secure token.
    const confirmationToken = randomBytes(32).toString("hex");

    // Only the hash is persisted.
    const tokenHash = hashToken(confirmationToken);

    const result = await pool.query(
        `
        INSERT INTO chatbot_report_confirmations (
            token_hash,
            username,
            work_details,
            report_status,
            duration,
            expires_at
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            CURRENT_TIMESTAMP + INTERVAL '5 minutes'
        )
        RETURNING id;
        `,
        [
            tokenHash,
            canonicalUsername,
            workDetails,
            report.status,
            duration
        ]
    );

    return {
        confirmation_token: confirmationToken,
        expires_in_seconds: CONFIRMATION_EXPIRY_SECONDS,
        report: {
            work_details: workDetails,
            status: report.status,
            duration
        }
    };
};


// ==========================================
// 2. Confirm and submit report atomically
// ==========================================

export const confirmPendingConfirmation = async (
    confirmationToken,
    username
) => {
    if (
        typeof confirmationToken !== "string" ||
        !confirmationToken.trim() ||
        !username
    ) {
        throw createServiceError(
            "Confirmation token and authenticated employee are required."
        );
    }

    const token = confirmationToken.trim();

    // Expected format: 32 cryptographically random bytes.
    if (!/^[a-f0-9]{64}$/i.test(token)) {
        throw createServiceError(
            "Invalid confirmation token."
        );
    }

    const tokenHash = hashToken(token);

    const client = await pool.connect();

    let transactionStarted = false;

    try {
        await client.query("BEGIN");
        transactionStarted = true;

        // --------------------------------------
        // Lock confirmation record.
        // Serializes concurrent confirmation attempts.
        // --------------------------------------

        const confirmationResult = await client.query(
            `
            SELECT
                id,
                username,
                work_details,
                report_status,
                duration,
                status,
                expires_at,
                report_id
            FROM chatbot_report_confirmations
            WHERE token_hash = $1
            FOR UPDATE;
            `,
            [tokenHash]
        );

        if (confirmationResult.rows.length === 0) {
            throw createServiceError(
                "Invalid confirmation token."
            );
        }

        const confirmation = confirmationResult.rows[0];

        // --------------------------------------
        // Verify employee ownership.
        // --------------------------------------

        if (
            confirmation.username.toLowerCase() !==
            username.toLowerCase()
        ) {
            throw createServiceError(
                "You are not authorized to confirm this report.",
                403
            );
        }

        // --------------------------------------
        // Handle retry after successful submission.
        // --------------------------------------

        if (confirmation.status === "consumed") {
            const existingReport = await client.query(
                `
                SELECT
                    id,
                    work_datetime,
                    user_name,
                    employee_id,
                    work_details,
                    status,
                    duration,
                    department,
                    unit,
                    division
                FROM working_date_history
                WHERE id = $1
                  AND LOWER(TRIM(user_name)) = LOWER(TRIM($2))
                LIMIT 1;
                `,
                [
                    confirmation.report_id,
                    confirmation.username
                ]
            );

            if (existingReport.rows.length === 0) {
                throw new Error(
                    "Confirmation was consumed, but its original report could not be found."
                );
            }

            await client.query("COMMIT");
            transactionStarted = false;

            return {
                report: existingReport.rows[0],
                alreadySubmitted: true
            };
        }

        // --------------------------------------
        // Check expiry using database time.
        // --------------------------------------

        const expiryResult = await client.query(
            `
            SELECT expires_at <= CURRENT_TIMESTAMP AS expired
            FROM chatbot_report_confirmations
            WHERE id = $1;
            `,
            [confirmation.id]
        );

        if (expiryResult.rows[0].expired) {
            throw createServiceError(
                "Confirmation expired. Please prepare the report again."
            );
        }

        // --------------------------------------
        // Resolve active employee inside transaction.
        // --------------------------------------

        const employeeResult = await client.query(
            `
            SELECT
                user_name,
                employee_id,
                department,
                unit,
                division
            FROM users
            WHERE LOWER(TRIM(user_name)) = LOWER(TRIM($1))
              AND status::text = 'active'
            LIMIT 1;
            `,
            [confirmation.username]
        );

        if (employeeResult.rows.length === 0) {
            throw createServiceError(
                "Active employee account not found.",
                403
            );
        }

        const employee = employeeResult.rows[0];

        // --------------------------------------
        // Insert work report.
        // --------------------------------------

        const reportResult = await client.query(
            `
            INSERT INTO working_date_history (
                work_datetime,
                user_name,
                employee_id,
                work_details,
                status,
                duration,
                department,
                unit,
                division
            )
            VALUES (
                CURRENT_TIMESTAMP,
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8
            )
            RETURNING
                id,
                work_datetime,
                user_name,
                employee_id,
                work_details,
                status,
                duration,
                department,
                unit,
                division;
            `,
            [
                employee.user_name,
                employee.employee_id,
                confirmation.work_details,
                confirmation.report_status,
                confirmation.duration,
                employee.department,
                employee.unit,
                employee.division
            ]
        );

        const submittedReport = reportResult.rows[0];

        // --------------------------------------
        // Consume token and associate report.
        // --------------------------------------

        await client.query(
            `
            UPDATE chatbot_report_confirmations
            SET
                status = 'consumed',
                consumed_at = CURRENT_TIMESTAMP,
                report_id = $1
            WHERE id = $2
              AND status = 'pending';
            `,
            [
                submittedReport.id,
                confirmation.id
            ]
        );

        // --------------------------------------
        // Commit both operations together.
        // --------------------------------------

        await client.query("COMMIT");
        transactionStarted = false;

        return {
            report: submittedReport,
            alreadySubmitted: false
        };

    } catch (error) {

        if (transactionStarted) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error(
                    "Confirmation transaction rollback failed:",
                    rollbackError.message
                );
            }
        }

        throw error;

    } finally {
        client.release();
    }
};