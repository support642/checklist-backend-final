import { Router } from "express";
import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";
import { getAllUsers, updateUserAccess, getUserAccess } from "../../controllers/doc-controller/settingsController.js";
import { adminMiddleware } from "../../middleware/doc-middleware/adminMiddleware.js";

const router = Router();

// Get all users with access settings
router.get("/users", authMiddleware, adminMiddleware, getAllUsers);

// Get single user access settings
router.get("/users/:username", authMiddleware, adminMiddleware, getUserAccess);

// Update user access settings
router.put("/users/:username/access", authMiddleware, adminMiddleware, updateUserAccess);

export default router;
