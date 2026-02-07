import { NextRequest, NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { createPromptBlockSchema } from '@/lib/validations'
import { requireAuth } from '@/lib/require-auth'

// GET /api/prompt-blocks - List prompt blocks with filtering
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const scope = searchParams.get('scope')
    const scopeId = searchParams.get('scope_id')
    const activeOnly = searchParams.get('active_only') !== 'false' // Default true
    const userOverride = searchParams.get('user_override') === 'true'

    // When user_override is requested, fetch user-scoped blocks and merge
    let userId: string | null = null
    if (userOverride) {
      const user = await requireAuth()
      if (user) userId = user.id
    }

    let rows = await sql`
      SELECT *
      FROM prompt_blocks
      ORDER BY user_id DESC NULLS LAST, updated_at DESC NULLS LAST, version DESC, created_at DESC
    `

    if (type) {
      rows = rows.filter((row: any) => row.type === type)
    }

    if (scope) {
      rows = rows.filter((row: any) => row.scope === scope)
    }

    if (scopeId) {
      rows = rows.filter((row: any) => row.scope_id === scopeId)
    }

    // When not using user_override, only return global (non-user) blocks
    // When using user_override, return user's blocks + global blocks (user wins per key)
    if (!userOverride) {
      rows = rows.filter((row: any) => !row.user_id)
    } else if (userId) {
      rows = rows.filter((row: any) => !row.user_id || row.user_id === userId)
    }

    const getLogicalKey = (row: any) => {
      let metadata: any = row?.metadata
      if (typeof metadata === 'string') {
        try {
          metadata = JSON.parse(metadata)
        } catch {
          metadata = null
        }
      }
      const metadataKey =
        metadata && typeof metadata === 'object' && typeof metadata.key === 'string'
          ? metadata.key.trim()
          : ''
      return metadataKey || String(row?.type || '')
    }

    if (activeOnly) {
      const seen = new Set<string>()
      const deduped: any[] = []
      for (const row of rows as any[]) {
        if (!row?.is_active) continue
        const logicalKey = getLogicalKey(row)
        const scopeBucket = `${row?.scope || ''}:${row?.scope_id || ''}:${logicalKey}`
        if (seen.has(scopeBucket)) continue
        seen.add(scopeBucket)
        deduped.push(row)
      }
      rows = deduped
    }

    return NextResponse.json(rows)
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/prompt-blocks - Create a new prompt block
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('POST /api/prompt-blocks - received body:', JSON.stringify(body, null, 2))

    const validated = createPromptBlockSchema.safeParse(body)

    if (!validated.success) {
      console.error('Validation failed:', validated.error.flatten())
      return NextResponse.json(
        { error: 'Validation failed', details: validated.error.flatten() },
        { status: 400 }
      )
    }

    const scopeIdValue = validated.data.scope_id ?? null
    const userIdValue = validated.data.user_id ?? null
    const metadataKey =
      typeof validated.data.metadata?.key === 'string' ? validated.data.metadata.key : null

    if (metadataKey) {
      if (userIdValue) {
        await sql`
          UPDATE prompt_blocks
          SET is_active = false
          WHERE scope = ${validated.data.scope}
            AND COALESCE(scope_id::text, '') = COALESCE(${scopeIdValue}::text, '')
            AND user_id = ${userIdValue}
            AND (metadata->>'key') = ${metadataKey}
            AND is_active = true
        `
      } else if (scopeIdValue) {
        await sql`
          UPDATE prompt_blocks
          SET is_active = false
          WHERE scope = ${validated.data.scope}
            AND scope_id = ${scopeIdValue}
            AND user_id IS NULL
            AND (metadata->>'key') = ${metadataKey}
            AND is_active = true
        `
      } else {
        await sql`
          UPDATE prompt_blocks
          SET is_active = false
          WHERE scope = ${validated.data.scope}
            AND scope_id IS NULL
            AND user_id IS NULL
            AND (metadata->>'key') = ${metadataKey}
            AND is_active = true
        `
      }
    }

    const existingRows = await sql`
      SELECT version
      FROM prompt_blocks
      WHERE name = ${validated.data.name}
        AND type = ${validated.data.type}
        AND scope = ${validated.data.scope}
        AND COALESCE(scope_id::text, '') = COALESCE(${scopeIdValue}::text, '')
        AND COALESCE(user_id::text, '') = COALESCE(${userIdValue}::text, '')
      ORDER BY version DESC
      LIMIT 1
    `

    const existing = existingRows[0]
    const nextVersion = existing ? existing.version + 1 : 1

    if (existing) {
      await sql`
        UPDATE prompt_blocks
        SET is_active = false
        WHERE name = ${validated.data.name}
          AND type = ${validated.data.type}
          AND scope = ${validated.data.scope}
          AND COALESCE(scope_id::text, '') = COALESCE(${scopeIdValue}::text, '')
          AND COALESCE(user_id::text, '') = COALESCE(${userIdValue}::text, '')
      `
    }

    const rows = await sql`
      INSERT INTO prompt_blocks (
        name,
        type,
        scope,
        scope_id,
        user_id,
        content,
        version,
        is_active,
        metadata
      ) VALUES (
        ${validated.data.name},
        ${validated.data.type},
        ${validated.data.scope},
        ${scopeIdValue},
        ${userIdValue},
        ${validated.data.content},
        ${nextVersion},
        ${validated.data.is_active ?? true},
        ${validated.data.metadata ?? {}}
      )
      RETURNING *
    `

    return NextResponse.json(rows[0], { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
