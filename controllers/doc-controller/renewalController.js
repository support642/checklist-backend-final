import {
    fetchPendingRenewals,
    fetchRenewalHistory,
    insertRenewal,
    updateSubscriptionForRenewal
} from "../../services/doc-services/renewalServices.js";

/* ---------------- GET PENDING RENEWALS ---------------- */
export async function getPendingRenewals(req, res) {
    try {
        const pending = await fetchPendingRenewals();
        console.log("Pending renewals", pending)
        res.json(pending);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to fetch pending renewals" });
    }
}

/* ---------------- GET RENEWAL HISTORY ---------------- */
export async function getRenewalHistory(req, res) {
    try {
        const history = await fetchRenewalHistory();
        res.json(history);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch renewal history" });
    }
}

/* ---------------- SUBMIT RENEWAL ---------------- */
export async function submitRenewal(req, res) {
    try {
        const {
            subscription_no,
            renewal_status,
            approved_by,
            price,
            company_name,
            subscriber_name,
            subscription_name,
            frequency,
            end_date
        } = req.body;

        // Generate renewal number
        const renewal_no = `REN-${Date.now().toString().slice(-6)}`;

        // Update subscription table
        await updateSubscriptionForRenewal({
            subscription_no,
            actual_1: new Date(),
            renewal_status,
            price,
            company_name,
            subscriber_name,
            subscription_name,
            frequency,
            end_date
        });

        // Insert into subscription_renewals
        const saved = await insertRenewal({
            renewal_no,
            subscription_no,
            renewal_status,
            approved_by,
            price
        });

        res.json({ success: true, data: saved });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to submit renewal" });
    }
}
