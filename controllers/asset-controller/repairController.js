import RepairModel from '../../asset-model/repairModel.js';

export const getRepairsByProduct = async (req, res) => {
    try {
        const repairs = await RepairModel.getRepairsByProductId(req.params.id);
        res.status(200).json(repairs);
    } catch (error) {
        console.error('Error fetching repairs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const addRepair = async (req, res) => {
    try {
        const repair = await RepairModel.addRepairToProduct(req.params.id, req.body);
        res.status(201).json(repair);
    } catch (error) {
        console.error('Error adding repair:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
