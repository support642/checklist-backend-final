import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import dotenv from "dotenv";

dotenv.config();

// Initialize dedicated S3 client for Working Date History
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

/**
 * Upload base64 image specifically for Working Date History module.
 * This is an isolated utility to prevent interference with other module upload logic.
 */
export const uploadDocumentImage = async (base64Data, fileName = null) => {
  if (!base64Data) return null;

  const bucketName = process.env.DOCUMENT_BUCKET_NAME || process.env.AWS_BUCKET_NAME;
  if (!bucketName) {
    throw new Error("S3 bucket name not configured.");
  }

  let buffer;
  let mimeType = 'image/png';
  let extension = 'png';

  // 1. Precise Base64 Parsing
  if (base64Data.startsWith('data:')) {
    const matches = base64Data.match(/^data:([A-Za-z-+\.]+\/[A-Za-z-+\.]+)(?:;charset=[^;]+)?(?:;base64)?,(.+)$/);
    if (matches && matches.length === 3) {
      mimeType = matches[1];
      buffer = Buffer.from(matches[2], 'base64');
      
      if (mimeType.includes('jpeg') || mimeType.includes('jpg')) extension = 'jpg';
      else if (mimeType.includes('png')) extension = 'png';
      else if (mimeType.includes('webp')) extension = 'webp';
      else if (mimeType.includes('gif')) extension = 'gif';
    } else {
      const parts = base64Data.split(';base64,');
      if (parts.length === 2) {
        buffer = Buffer.from(parts[1], 'base64');
        mimeType = parts[0].split(':')[1] || 'image/png';
      } else {
        buffer = Buffer.from(base64Data, 'base64');
      }
    }
  } else {
    buffer = Buffer.from(base64Data, 'base64');
  }

  // 2. Filename & Key construction
  const timestamp = Date.now();
  const sanitizedFileName = fileName ? fileName.replace(/\s+/g, '_') : `work_proof.${extension}`;
  const key = `working-date-history/${timestamp}_${sanitizedFileName}`;

  const params = {
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: mimeType,
  };

  try {
    // 3. Perform Upload
    const command = new PutObjectCommand(params);
    await s3.send(command);

    // 4. Region-Aware URL Construction
    const region = process.env.AWS_REGION || 'us-east-1';
    const isStandardRegion = region === 'us-east-1';
    
    if (isStandardRegion) {
      return `https://${bucketName}.s3.amazonaws.com/${key}`;
    } else {
      return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
    }
  } catch (error) {
    console.error("❌ WorkingDate S3 Error:", error.message);
    throw new Error(`Dedicated S3 Upload Failed: ${error.message}`);
  }
};
