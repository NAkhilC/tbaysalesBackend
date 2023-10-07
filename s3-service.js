const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const dotenv = require("dotenv");
dotenv.config();
const s3 = new S3Client({
  region: process.env.REGION,
  credentials: {
    accessKeyId: process.env.ACCESS_KEY_ID,
    secretAccessKey: process.env.SECRET_ACCESS_KEY,

  },
});

const uploadToS3 = async ({ file }, listingId) => {
  const key = `${process.env.IMAGES_PATH}/${listingId + file.originalname}`;
  const command = new PutObjectCommand({
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    Bucket: process.env.BUCKET,
  });

  try {
    await s3.send(command);
    return { key };
  } catch (error) {
    console.log(error);
    return { error };
  }
};

module.exports = { uploadToS3 };
