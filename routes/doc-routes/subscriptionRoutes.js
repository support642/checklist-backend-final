import express from "express";
import {
  createSubscription,
  fetchSubscriptions,
  generateSubscriptionNo,
  updateSubscription
} from "../../controllers/doc-controller/subscriptionController.js";

const router = express.Router();

router.post("/create", createSubscription);
router.get("/all", fetchSubscriptions);
router.get("/generate-number", generateSubscriptionNo);
router.put("/update/:id", updateSubscription);

export default router;
