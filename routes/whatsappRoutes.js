import express from 'express';
import whatsappController from '../controllers/whatsappController.js';

const router = express.Router();

/**
 * @route   GET /api/v1/whatsapp/webhook
 * @desc    Handshake verification for Meta
 */
router.get('/webhook', whatsappController.verifyWebhook);

/**
 * @route   POST /api/v1/whatsapp/webhook
 * @desc    Receive status updates and messages from Meta
 */
router.post('/webhook', whatsappController.handleWebhook);

export default router;
