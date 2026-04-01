import SpecModel from '../../asset-model/specModel.js';

export const getSpecsByProduct = async (req, res) => {
    try {
        const specs = await SpecModel.getSpecsByProductId(req.params.id);
        res.status(200).json(specs);
    } catch (error) {
        console.error('Error fetching specs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const addSpecs = async (req, res) => {
    try {
        const { specs } = req.body; 
        if (!specs || !Array.isArray(specs)) {
            return res.status(400).json({ error: 'Invalid specs format' });
        }
        
        const addedSpecs = await SpecModel.addSpecsToProduct(req.params.id, specs);
        res.status(201).json(addedSpecs);
    } catch (error) {
        console.error('Error adding specs:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
