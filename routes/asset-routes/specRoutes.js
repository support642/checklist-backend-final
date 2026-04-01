import express from 'express';
import { getSpecsByProduct, addSpecs } from '../../controllers/asset-controller/specController.js';

const router = express.Router();

router.get('/product/:id', getSpecsByProduct);
router.post('/product/:id', addSpecs);

export default router;
