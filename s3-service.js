const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: "us-east-1",
  credentials: {
    accessKeyId: "AKIAW7EO5CI5BDGH7UNF",
    secretAccessKey: "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",
  },
});

const uploadToS3 = async ({ file }, listingId) => {
  const key = `saleImages/${listingId + file.originalname}`;
  const command = new PutObjectCommand({
    Key: key,
    Body: file.buffer,
    ContentType: file.mimetype,
    Bucket: "saleimages",
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
