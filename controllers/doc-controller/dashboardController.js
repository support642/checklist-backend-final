import {
  getAllSubscriptionsService,
  getMySubscriptionsService,
  getDashboardStatsService
} from "../../services/doc-services/dashboardService.js";

export async function getAllSubscriptions(req, res) {
  try {
    const data = await getAllSubscriptionsService();
    res.json(data);
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getMySubscriptions(req, res) {
  try {
    const subscriberName = req.user.name;
    const data = await getMySubscriptionsService(subscriberName);
    res.json(data);
  } catch (err) {
    console.log("Error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
}

export async function getDashboardStats(req, res) {
  try {
    const subscriberName = req.user.name;
    const role = req.user.role;

    const data = await getDashboardStatsService(subscriberName, role);
    res.json(data);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Internal error" });
  }
}


export async function getDashboardNames(req, res) {
  try {
    const data = await getDashboardNamesService();
    res.json(data);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Internal error" });
  }
}
