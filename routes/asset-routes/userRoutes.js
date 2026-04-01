import express from 'express';
import { getAssetUsers } from '../../controllers/asset-controller/userController.js';

const router = express.Router();

router.get('/', getAssetUsers);

export default router;
