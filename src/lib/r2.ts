import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getR2Config() {
  const endpoint = process.env.R2_ENDPOINT
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  const region = process.env.R2_REGION || 'auto'

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    throw new Error('Missing R2 env vars (R2_ENDPOINT/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)')
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket, region }
}

let cachedClient: S3Client | null = null
let cachedBucket: string | null = null

export function getR2Bucket() {
  const { bucket } = getR2Config()
  return bucket
}

export function getR2Client() {
  if (cachedClient) return cachedClient
  const { endpoint, accessKeyId, secretAccessKey, region, bucket } = getR2Config()
  cachedBucket = bucket
  cachedClient = new S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
  return cachedClient
}

export async function signR2GetObjectUrl(key: string, expiresInSeconds = 90) {
  const client = getR2Client()
  const bucket = cachedBucket || getR2Bucket()
  const command = new GetObjectCommand({ Bucket: bucket, Key: key })
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds })
}

