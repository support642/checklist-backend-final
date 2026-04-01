import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// 1. Initialize S3 client (AWS SDK v3)
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

// 2. Multer setup (store in memory)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// 3. Upload function to S3
const uploadToS3 = async (file) => {
  try {
    console.log("🚀 uploadToS3 called with:", {
      name: file.originalname,
      type: file.mimetype,
      size: file.buffer?.length
    });

    // Use either AWS_BUCKET_NAME or S3_BUCKET_NAME
    const bucketName = process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET_NAME;

    const params = {
      Bucket: bucketName,
      Key: `uploads/${Date.now()}_${file.originalname}`,
      Body: file.buffer,
      ContentType: file.mimetype,
    };

    const parallelUploads3 = new Upload({
      client: s3,
      params,
    });

    const result = await parallelUploads3.done();
    console.log("✅ Uploaded to S3:", result.Location || params.Key);

    return result.Location || `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${params.Key}`;
  } catch (err) {
    console.error("❌ Error uploading to S3:", err);
    throw err;
  }
};

// 4. Upload document image (base64) to S3
const uploadDocumentImage = async (base64Data, fileName = null) => {
  if (!base64Data) return null;

  // Determine bucket name - use DOCUMENT_BUCKET_NAME if available, otherwise AWS_BUCKET_NAME
  const bucketName = process.env.DOCUMENT_BUCKET_NAME || process.env.AWS_BUCKET_NAME || process.env.S3_BUCKET_NAME;

  if (!bucketName) {
    throw new Error("S3 bucket name not configured. Please set DOCUMENT_BUCKET_NAME in .env");
  }

  // Parse base64 data
  let buffer;
  let mimeType = 'image/png';
  let extension = 'png';

  if (base64Data.startsWith('data:')) {
    // Extract mime type and base64 content
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (matches && matches.length === 3) {
      mimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
      // Determine extension from mime type
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpg';
      else if (mimeType.includes('png')) extension = 'png';
      else if (mimeType.includes('pdf')) extension = 'pdf';
      else if (mimeType.includes('gif')) extension = 'gif';
      else if (mimeType.includes('webp')) extension = 'webp';
    } else {
      buffer = Buffer.from(base64Data, 'base64');
    }
  } else {
    buffer = Buffer.from(base64Data, 'base64');
  }

  // Generate unique filename
  const timestamp = Date.now();
  const uniqueName = fileName ? `${timestamp}_${fileName}` : `${timestamp}_document.${extension}`;
  const key = `documents/${uniqueName}`;

  const params = {
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  };

  try {
    const command = new PutObjectCommand(params);
    await s3.send(command);

    // Return the S3 URL
    return `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${key}`;
  } catch (error) {
    console.error("S3 Upload Error:", error);
    throw new Error("Failed to upload document image to S3");
  }
};

// Export middleware as default and helpers as members
upload.uploadToS3 = uploadToS3;
upload.uploadDocumentImage = uploadDocumentImage;

export { uploadToS3, uploadDocumentImage };
export default upload;
