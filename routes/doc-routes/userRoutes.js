import express from "express";
import {
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  getCurrentPermissions
} from "../../controllers/doc-controller/userController.js";

import { authMiddleware } from "../../middleware/doc-middleware/authMiddleware.js";

const router = express.Router();

// Admin only
router.get("/", authMiddleware, getAllUsers);
router.get("/auth/me", authMiddleware, getCurrentPermissions)
router.post("/create", authMiddleware, createUser);
router.put("/update/:username", authMiddleware, updateUser);
router.delete("/delete/:username", authMiddleware, deleteUser);

export default router;