import express from "express";
import { getAllSubscriptions } from "../../controllers/doc-controller/mySubscriptionContorller.js";
import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";

const router = express.Router();

// GET /api/subscriptions
router.get("/", authMiddleware, getAllSubscriptions);

export default router;
