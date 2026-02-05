import { NextResponse } from 'next/server'
import { sql } from '@/lib/db'
import { requireAuth } from '@/lib/require-auth'
import { deleteR2Object } from '@/lib/r2'

type Params = { params: Promise<{ id: string }> }

export async function DELETE(_request: Request, { params }: Params) {
  const user = await requireAuth()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  try {
    const rows = await sql`
      SELECT id, file_id
      FROM research_items
      WHERE id = ${id}
      LIMIT 1
    `
    const item = rows[0]
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await sql`
      DELETE FROM media_jobs
      WHERE type = 'ingest_research_file'
        AND input->>'research_item_id' = ${id}
        AND status IN ('queued', 'running')
    `

    await sql`
      DELETE FROM research_items
      WHERE id = ${id}
    `

    const fileId = item.file_id as string | null
    if (fileId) {
      const refCountRows = await sql`
        SELECT COUNT(*)::int AS count
        FROM research_items
        WHERE file_id = ${fileId}
      `
      const refCount = Number(refCountRows[0]?.count || 0)

      if (refCount === 0) {
        const fileRows = await sql`
          SELECT id, r2_key
          FROM research_files
          WHERE id = ${fileId}
          LIMIT 1
        `
        const file = fileRows[0]
        if (file) {
          await sql`
            DELETE FROM research_files
            WHERE id = ${fileId}
          `
          if (file.r2_key) {
            try {
              await deleteR2Object(file.r2_key as string)
            } catch (err) {
              console.warn('Failed to delete research file from R2:', err)
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete research item error:', error)
    return NextResponse.json({ error: 'Failed to delete research item' }, { status: 500 })
  }
}
