import pool from '../config/db.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Meta Webhook Verification (GET Handler)
 * Meta sends a GET request with a hub.verify_token and hub.challenge
 * to ensure the server is valid.
 */
export const verifyWebhook = async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    // You should set this in your .env
    const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'botivate_secret_token';

    if (mode === 'subscribe' && token === verifyToken) {
        console.log('✅ WhatsApp Webhook Verified successfully');
        return res.status(200).send(challenge);
    } else {
        console.error('❌ WhatsApp Webhook Verification FAILED');
        return res.sendStatus(403);
    }
};

/**
 * Handle incoming WhatsApp Notifications (POST Handler)
 * This processes status updates (sent, delivered, read, failed)
 * and messages from users.
 */
export const handleWebhook = async (req, res) => {
    try {
        const body = req.body;

        console.log(body,"webhook ")

        // Ensure this is a WhatsApp notification
        if (body.object !== 'whatsapp_business_account') {
            return res.sendStatus(404);
        }

        const entries = body.entry;
        if (!entries || entries.length === 0) return res.sendStatus(200);

        for (const entry of entries) {
            const changes = entry.changes;
            if (!changes || changes.length === 0) continue;

            for (const change of changes) {
                const value = change.value;
                
                // Case 1: Status Updates (sent, delivered, read, failed)
                if (value.statuses && value.statuses.length > 0) {
                    for (const statusObj of value.statuses) {
                        const messageId = statusObj.id;
                        const status = statusObj.status;
                        const recipientId = statusObj.recipient_id;
                        const errors = statusObj.errors;

                        console.log(`📩 WhatsApp Status Update: [${messageId}] -> ${status}`);

                        // Update the log in our database
                        await pool.query(
                            `UPDATE whatsapp_message_logs 
                             SET status = $1, 
                                 error_details = $2, 
                                 updated_at = CURRENT_TIMESTAMP 
                             WHERE message_id = $3`,
                            [status, errors ? JSON.stringify(errors) : null, messageId]
                        );
                    }
                }

                // Case 2: Incoming Messages (Optional - for future use)
                if (value.messages && value.messages.length > 0) {
                    for (const msg of value.messages) {
                        console.log(`💬 Incoming message from ${msg.from}: ${msg.text?.body || '[Media/Other]'}`);
                        // You could implement auto-replies or save these to a chat table here
                    }
                }
            }
        }

        res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
        console.error('❌ Webhook Processing Error:', error.message);
        res.status(200).send('EVENT_RECEIVED'); // Always return 200 to Meta to avoid retries
    }
};

export default {
    verifyWebhook,
    handleWebhook
};
