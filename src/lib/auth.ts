import { cookies } from 'next/headers'
import { jwtVerify, SignJWT } from 'jose'

const SESSION_COOKIE = 'bl_session'
const SESSION_TTL_DAYS = 7

function getSecretKey() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set')
  }
  return new TextEncoder().encode(secret)
}

export interface AuthTokenPayload {
  sub: string
  email: string
  role: string
  name?: string | null
}

export async function signAuthToken(payload: AuthTokenPayload) {
  const secret = getSecretKey()
  return new SignJWT({
    email: payload.email,
    role: payload.role,
    name: payload.name ?? null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_DAYS}d`)
    .sign(secret)
}

export async function verifyAuthToken(token: string) {
  const secret = getSecretKey()
  const { payload } = await jwtVerify(token, secret)
  return payload
}

export async function setAuthCookie(token: string) {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * SESSION_TTL_DAYS,
  })
}

export async function clearAuthCookie() {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
}

export async function readAuthCookie() {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE)?.value
}

export const authCookieName = SESSION_COOKIE
