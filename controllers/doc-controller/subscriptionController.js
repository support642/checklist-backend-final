import {
  insertSubscription,
  getAllSubscriptions,
  getLatestSubscriptionNumber,
  updateSubscriptionById
} from "../../services/doc-services/subscriptionServices.js";

export const createSubscription = async (req, res) => {
  try {
    const newData = await insertSubscription(req.body);
    res.json({ success: true, data: newData });
  } catch (err) {
    console.error("❌ Insert Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const fetchSubscriptions = async (req, res) => {
  try {
    const data = await getAllSubscriptions();
    res.json(data);
  } catch (err) {
    console.error("❌ Fetch Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const generateSubscriptionNo = async (req, res) => {
  try {
    const last = await getLatestSubscriptionNumber();

    let next = "SUB-0001";

    if (last) {
      const numericPart = parseInt(last.replace("SUB-", ""));
      next = `SUB-${String(numericPart + 1).padStart(4, "0")}`;
    }

    res.json({ subscriptionNo: next });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Failed to generate subscription number" });
  }
};

export const updateSubscription = async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;

  try {
    const updatedData = await updateSubscriptionById(id, updateData);
    
    if (!updatedData) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    res.json({ success: true, data: updatedData });
  } catch (err) {
    console.error("❌ Update Error:", err.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};