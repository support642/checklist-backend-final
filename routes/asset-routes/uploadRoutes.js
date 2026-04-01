import express from 'express';
import upload, { uploadToS3 } from '../../middleware/asset-middleware/upload.js';

const router = express.Router();

router.post('/', upload.array('files', 5), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }
        
        // Upload each file to S3 manually using the helper
        const uploadPromises = req.files.map(file => uploadToS3(file));
        const s3Urls = await Promise.all(uploadPromises);
        
        const urls = req.files.map((file, index) => {
            return {
                url: s3Urls[index],
                name: file.originalname
            };
        });
        
        res.status(200).json({ 
            message: 'Files uploaded successfully',
            urls: urls 
        });
    } catch (error) {
        console.error('Upload Error:', error);
        res.status(500).json({ error: 'Internal server error during upload' });
    }
});

export default router;
