import { sql } from '@/lib/db'
import { clearAuthCookie, readAuthCookie, verifyAuthToken } from '@/lib/auth'

export interface AuthenticatedUser {
  id: string
  email: string
  name?: string | null
  role?: string
}

/**
 * Server-side auth helper for route handlers.
 * Returns the active user row, or null if unauthenticated/invalid.
 */
export async function requireAuth(): Promise<AuthenticatedUser | null> {
  const token = await readAuthCookie()
  if (!token) return null

  try {
    const payload = await verifyAuthToken(token)
    const userId = payload.sub as string | undefined
    if (!userId) {
      await clearAuthCookie()
      return null
    }

    const rows = await sql`
      SELECT id, email, name, role, is_active
      FROM app_users
      WHERE id = ${userId}
      LIMIT 1
    `
    const user = rows[0]
    if (!user || !user.is_active) {
      await clearAuthCookie()
      return null
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    }
  } catch (error) {
    console.error('requireAuth error:', error)
    await clearAuthCookie()
    return null
  }
}

