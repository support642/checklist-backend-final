import express from 'express';
import { getRepairsByProduct, addRepair } from '../../controllers/asset-controller/repairController.js';

const router = express.Router();

router.get('/product/:id', getRepairsByProduct);
router.post('/product/:id', addRepair);

export default router;
