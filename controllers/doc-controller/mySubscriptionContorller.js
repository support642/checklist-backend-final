import { getAllSubscriptionsService } from "../../services/doc-services/mySubscriptionServices.js";

// Status calculator exactly matching your frontend getStatus()
function computeStatus(row) {
  const today = new Date();
  const start = new Date(row.start_date);
  const end = new Date(row.end_date);

  if (end < today) return "Expired";
  if (start <= today && end >= today) return "Active";
  return "Upcoming";
}

export async function getAllSubscriptions(req, res) {
  try {
    const { name, role } = req.user; // Coming from JWT middleware

    const rows = await getAllSubscriptionsService(name, role);

    // Transform for frontend
    const formatted = rows.map((s) => ({
      subscriptionNo: s.subscription_no,
      companyName: s.company_name,
      startDate: s.start_date,
      endDate: s.end_date,
      price: s.price,
      subscriberName: s.subscriber_name,
      subscriptionName: s.subscription_name,
      status: computeStatus(s)
    }));

    res.json(formatted);
  } catch (err) {
    console.error("Error fetching subscriptions:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
