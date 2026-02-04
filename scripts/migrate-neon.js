const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const bcrypt = require('bcryptjs')
const { neon } = require('@netlify/neon')
const { createClient } = require('@supabase/supabase-js')

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  const envText = fs.readFileSync(envPath, 'utf8')
  envText.split('\n').forEach((line) => {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) return
    const [key, ...rest] = line.split('=')
    if (!process.env[key]) {
      process.env[key] = rest.join('=')
    }
  })
}

function decodeJwtPayload(token) {
  const parts = token.split('.')
  if (parts.length < 2) return null
  const payload = Buffer.from(parts[1], 'base64url').toString('utf8')
  try {
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function splitSqlStatements(sqlText) {
  const statements = []
  let current = ''
  let i = 0
  let inSingle = false
  let inDouble = false
  let inLineComment = false
  let inBlockComment = false
  let dollarTag = null

  while (i < sqlText.length) {
    const char = sqlText[i]
    const next = sqlText[i + 1]

    if (inLineComment) {
      current += char
      if (char === '\n') inLineComment = false
      i += 1
      continue
    }

    if (inBlockComment) {
      current += char
      if (char === '*' && next === '/') {
        current += next
        i += 2
        inBlockComment = false
        continue
      }
      i += 1
      continue
    }

    if (dollarTag) {
      if (sqlText.startsWith(dollarTag, i)) {
        current += dollarTag
        i += dollarTag.length
        dollarTag = null
        continue
      }
      current += char
      i += 1
      continue
    }

    if (inSingle) {
      current += char
      if (char === "'" && sqlText[i - 1] !== '\\') {
        inSingle = false
      }
      i += 1
      continue
    }

    if (inDouble) {
      current += char
      if (char === '"' && sqlText[i - 1] !== '\\') {
        inDouble = false
      }
      i += 1
      continue
    }

    if (char === '-' && next === '-') {
      inLineComment = true
      current += char
      i += 1
      continue
    }

    if (char === '/' && next === '*') {
      inBlockComment = true
      current += char
      i += 1
      continue
    }

    if (char === "'") {
      inSingle = true
      current += char
      i += 1
      continue
    }

    if (char === '"') {
      inDouble = true
      current += char
      i += 1
      continue
    }

    if (char === '$') {
      let j = i + 1
      while (j < sqlText.length && sqlText[j] !== '$' && /[A-Za-z0-9_]/.test(sqlText[j])) {
        j += 1
      }
      if (sqlText[j] === '$') {
        dollarTag = sqlText.slice(i, j + 1)
        current += dollarTag
        i = j + 1
        continue
      }
    }

    if (char === ';') {
      const statement = current.trim()
      if (statement) statements.push(statement)
      current = ''
      i += 1
      continue
    }

    current += char
    i += 1
  }

  const tail = current.trim()
  if (tail) statements.push(tail)
  return statements
}

async function applyMigrations(sql) {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations')
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()

  const existing = await sql.query("SELECT to_regclass('public.organizations') AS exists")
  if (existing[0]?.exists) {
    return
  }

  for (const file of files) {
    const fullPath = path.join(migrationsDir, file)
    const content = fs.readFileSync(fullPath, 'utf8')
    const statements = splitSqlStatements(content)
    for (const statement of statements) {
      await sql.query(statement)
    }
  }
}

async function fetchAll(supabase, table) {
  const batchSize = 1000
  let from = 0
  const rows = []

  while (true) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + batchSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < batchSize) break
    from += batchSize
  }

  return rows
}

async function insertRows(sql, table, rows) {
  for (const row of rows) {
    if (table === 'organizations') {
      await sql.query(
        `INSERT INTO organizations (id, name, slug, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.name, row.slug, row.created_at, row.updated_at]
      )
    } else if (table === 'brands') {
      await sql.query(
        `INSERT INTO brands (id, organization_id, name, slug, voice_guidelines, logo_url, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.organization_id, row.name, row.slug, row.voice_guidelines, row.logo_url, row.metadata, row.created_at, row.updated_at]
      )
    } else if (table === 'products') {
      await sql.query(
        `INSERT INTO products (id, brand_id, name, slug, context, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.brand_id, row.name, row.slug, row.context, row.created_at, row.updated_at]
      )
    } else if (table === 'avatars') {
      await sql.query(
        `INSERT INTO avatars (id, product_id, name, content, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.product_id, row.name, row.content, row.is_active, row.created_at, row.updated_at]
      )
    } else if (table === 'pitches') {
      await sql.query(
        `INSERT INTO pitches (id, product_id, name, content, type, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.product_id, row.name, row.content, row.type, row.is_active, row.created_at, row.updated_at]
      )
    } else if (table === 'prompt_blocks') {
      await sql.query(
        `INSERT INTO prompt_blocks (id, name, type, scope, scope_id, content, version, is_active, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.name, row.type, row.scope, row.scope_id, row.content, row.version, row.is_active, row.metadata, row.created_at, row.updated_at]
      )
    } else if (table === 'generation_runs') {
      await sql.query(
        `INSERT INTO generation_runs (id, product_id, feature_type, status, config, assembled_prompt, raw_response, error_message, created_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id,
          row.product_id,
          row.feature_type,
          row.status,
          row.config,
          row.assembled_prompt,
          row.raw_response,
          row.error_message,
          row.created_at,
          row.completed_at,
        ]
      )
    } else if (table === 'assets') {
      await sql.query(
        `INSERT INTO assets (id, generation_run_id, type, content, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.generation_run_id, row.type, row.content, row.metadata, row.created_at]
      )
    } else if (table === 'app_users') {
      await sql.query(
        `INSERT INTO app_users (id, auth_user_id, email, name, role, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.auth_user_id, row.email, row.name, row.role, row.is_active, row.created_at, row.updated_at]
      )
    } else if (table === 'user_organization_access') {
      await sql.query(
        `INSERT INTO user_organization_access (id, user_id, organization_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.user_id, row.organization_id, row.created_at]
      )
    } else if (table === 'user_brand_access') {
      await sql.query(
        `INSERT INTO user_brand_access (id, user_id, brand_id, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.user_id, row.brand_id, row.created_at]
      )
    }
  }
}

async function migrateData(sql) {
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseKey) {
    console.log('SUPABASE_SERVICE_ROLE_KEY missing. Skipping data migration.')
    return { migrated: false, adminPassword: null }
  }

  let supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    const payload = decodeJwtPayload(supabaseKey)
    if (payload?.ref) {
      supabaseUrl = `https://${payload.ref}.supabase.co`
    }
  }

  if (!supabaseUrl) {
    console.log('SUPABASE_URL missing. Skipping data migration.')
    return { migrated: false, adminPassword: null }
  }

  const supabase = createClient(supabaseUrl, supabaseKey)

  const tableOrder = [
    'organizations',
    'brands',
    'products',
    'avatars',
    'pitches',
    'prompt_blocks',
    'generation_runs',
    'assets',
    'app_users',
    'user_organization_access',
    'user_brand_access',
  ]

  for (const table of tableOrder) {
    const rows = await fetchAll(supabase, table)
    await insertRows(sql, table, rows)
  }

  const users = await sql.query('SELECT id, email, role FROM app_users')
  const passwordRows = []
  let adminPassword = null

  for (const user of users) {
    const tempPassword = crypto.randomBytes(10).toString('base64url')
    const passwordHash = await bcrypt.hash(tempPassword, 10)
    await sql.query(
      'UPDATE app_users SET password_hash = $1, last_password_reset_at = NOW() WHERE id = $2',
      [passwordHash, user.id]
    )
    passwordRows.push({ email: user.email, password: tempPassword, role: user.role })
    if (user.role === 'super_admin' && !adminPassword) {
      adminPassword = tempPassword
    }
  }

  const csvLines = ['email,password,role', ...passwordRows.map((row) => `${row.email},${row.password},${row.role}`)]
  fs.writeFileSync(path.join(__dirname, '..', '.neon-passwords.csv'), csvLines.join('\n'))

  return { migrated: true, adminPassword }
}

async function main() {
  loadEnv()
  const neonUrl =
    process.env.NETLIFY_DATABASE_URL_UNPOOLED ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL

  if (!neonUrl) {
    throw new Error('Missing NETLIFY_DATABASE_URL_UNPOOLED/NETLIFY_DATABASE_URL/DATABASE_URL')
  }

  const sql = neon(neonUrl)

  await applyMigrations(sql)
  const result = await migrateData(sql)

  if (result.migrated && result.adminPassword) {
    console.log(`ADMIN_PASSWORD=${result.adminPassword}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
