import express from "express";
import { 
  submitWorkingDate, 
  getWorkingDateHistoryList, 
  getEmployeeHistoryDetail,
  updateWorkingDate,
  deleteWorkingDate
} from "../controllers/workingDateHistoryController.js";
import { sessionMiddleware } from "../middleware/sessionMiddleware.js";

const router = express.Router();

// All working date history routes require an active session
router.use(sessionMiddleware);

router.post("/submit", submitWorkingDate);
router.get("/list", getWorkingDateHistoryList);
router.get("/detail/:targetUsername", getEmployeeHistoryDetail);
router.put("/update/:id", updateWorkingDate);
router.delete("/delete/:id", deleteWorkingDate);

export default router;
