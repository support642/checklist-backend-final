import {
  getAllUsersService,
  createUserService,
  updateUserService,
  deleteUserService,
  getCurrentPermissionsService
} from "../../services/doc-services/userServices.js";

import pool from "../../config/db.js";

// GET all users
export async function getAllUsers(req, res) {
  try {
    const users = await getAllUsersService();
    res.json(users);
  } catch (err) {
    console.error("User fetch error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

// CREATE user
export async function createUser(req, res) {
  try {
    const { username, name, email, password, role } = req.body;

    // Check duplicate
    const exists = await pool.query(
      "SELECT * FROM users WHERE user_name=$1",
      [username]
    );
    if (exists.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const user = await createUserService({
      username,
      name,
      email,
      password,
      role
    });

    res.json({ success: true, user });
  } catch (err) {
    console.error("User create error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

// UPDATE user
export async function updateUser(req, res) {
  try {
    const username = req.params.username;

    const updated = await updateUserService({
      identifier: username,
      ...req.body
    });

    if (!updated)
      return res.status(404).json({ success: false, error: "User not found" });

    res.json({ success: true, user: updated });
  } catch (err) {
    console.error("User update error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

// DELETE user
export async function deleteUser(req, res) {
  try {
    const username = req.params.username;

    await deleteUserService(username);

    res.json({ success: true });
  } catch (err) {
    console.error("User delete error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}

// auth/me endpoint, it'll return logged in user's current fresh system & page acccess

export const getCurrentPermissions = async (req, res) => {
  try {
    const permissions = await getCurrentPermissionsService(req.user.username);
    return res.status(200).json({
      message: "Permissions fetched successfully", permissions });
  }
  catch(error) {
    return res.status(error.statusCode || 500).json({
      message: error.message || "Something went wrong"
    });
  }
};