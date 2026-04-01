import {
    createPaymentFms,
    getAllPaymentFms,
    getPaymentFmsById,
    updatePaymentFms,
    deletePaymentFms,
    getLatestUniqueNo,
    // Stage 1: Approval
    getApprovalPending,
    getApprovalHistory,
    processApproval,
    // Stage 2: Make Payment
    getMakePaymentPending,
    getMakePaymentHistory,
    processMakePayment,
    // Stage 3: Tally Entry
    getTallyEntryPending,
    getTallyEntryHistory,
    processTallyEntry
} from "../../services/doc-services/payment-fms-service.js";

// Create a new payment FMS request
export const create = async (req, res) => {
    try {
        const newData = await createPaymentFms(req.body);
        res.json({ success: true, data: newData });
    } catch (err) {
        console.error("❌ Create Payment FMS Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error", details: err.message });
    }
};

// Get all payment FMS records
export const getAll = async (req, res) => {
    try {
        const data = await getAllPaymentFms();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Payment FMS Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// Get payment FMS by ID
export const getById = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await getPaymentFmsById(id);
        if (!data) {
            return res.status(404).json({ success: false, error: "Record not found" });
        }
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Payment FMS by ID Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// ==================== STAGE 1: APPROVAL ====================
export const approvalPending = async (req, res) => {
    try {
        const data = await getApprovalPending();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Approval Pending Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

export const approvalHistory = async (req, res) => {
    try {
        const data = await getApprovalHistory();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Approval History Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

export const approvalProcess = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, stageRemarks } = req.body;
        const data = await processApproval(id, status, stageRemarks);
        if (!data) {
            return res.status(404).json({ success: false, error: "Record not found" });
        }
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Process Approval Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// ==================== STAGE 2: MAKE PAYMENT ====================
export const makePaymentPending = async (req, res) => {
    try {
        const data = await getMakePaymentPending();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Make Payment Pending Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

export const makePaymentHistory = async (req, res) => {
    try {
        const data = await getMakePaymentHistory();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Make Payment History Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

export const makePaymentProcess = async (req, res) => {
    try {
        const { id } = req.params;
        const { paymentType } = req.body;
        const data = await processMakePayment(id, paymentType);
        if (!data) {
            return res.status(404).json({ success: false, error: "Record not found" });
        }
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Process Make Payment Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// ==================== STAGE 3: TALLY ENTRY ====================
export const tallyEntryPending = async (req, res) => {
    try {
        const data = await getTallyEntryPending();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Tally Entry Pending Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

export const tallyEntryHistory = async (req, res) => {
    try {
        const data = await getTallyEntryHistory();
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Fetch Tally Entry History Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

export const tallyEntryProcess = async (req, res) => {
    try {
        const { ids } = req.body; // Array of IDs
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: "IDs array is required" });
        }
        const data = await processTallyEntry(ids);
        res.json({ success: true, data, message: `${data.length} entries processed successfully` });
    } catch (err) {
        console.error("❌ Process Tally Entry Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// ==================== GENERAL FUNCTIONS ====================
// Update payment FMS record
export const update = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await updatePaymentFms(id, req.body);
        if (!data) {
            return res.status(404).json({ success: false, error: "Record not found" });
        }
        res.json({ success: true, data });
    } catch (err) {
        console.error("❌ Update Payment FMS Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// Delete payment FMS record
export const remove = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await deletePaymentFms(id);
        if (!data) {
            return res.status(404).json({ success: false, error: "Record not found" });
        }
        res.json({ success: true, message: "Record deleted successfully", data });
    } catch (err) {
        console.error("❌ Delete Payment FMS Error:", err.message);
        res.status(500).json({ success: false, error: "Internal Server Error" });
    }
};

// Generate unique number
export const generateUniqueNo = async (req, res) => {
    try {
        const last = await getLatestUniqueNo();

        let next = "REQ-0001";

        if (last) {
            const numericPart = parseInt(last.replace("REQ-", ""));
            next = `REQ-${String(numericPart + 1).padStart(4, "0")}`;
        }

        res.json({ success: true, uniqueNo: next });
    } catch (err) {
        console.error("❌ Generate Unique No Error:", err.message);
        res.status(500).json({ success: false, error: "Failed to generate unique number" });
    }
};
