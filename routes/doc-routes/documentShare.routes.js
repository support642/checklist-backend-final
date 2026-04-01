import express from "express";
import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";
import { documentShare } from "../../controllers/doc-controller/documentShare.controller.js";

const router = express.Router();

router.post("/send", authMiddleware, documentShare);

export default router;
