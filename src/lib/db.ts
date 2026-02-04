import { neon } from '@netlify/neon'

const connectionString =
  process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('Missing database connection string')
}

export const sql = neon(connectionString)
