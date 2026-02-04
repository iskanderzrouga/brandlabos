import { NextResponse, type NextRequest } from 'next/server'
import { jwtVerify } from 'jose'

const COOKIE_NAME = 'bl_session'

function getSecretKey() {
  const secret = process.env.AUTH_SECRET
  if (!secret) {
    throw new Error('AUTH_SECRET is not set')
  }
  return new TextEncoder().encode(secret)
}

function isAuthRoute(pathname: string) {
  return pathname.startsWith('/login') || pathname.startsWith('/reset-password')
}

function isProtectedRoute(pathname: string) {
  return pathname.startsWith('/studio') || pathname.startsWith('/admin') || pathname.startsWith('/api')
}

function isAdminRoute(pathname: string) {
  return pathname.startsWith('/admin')
}

function isAuthApi(pathname: string) {
  return pathname.startsWith('/api/auth')
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get(COOKIE_NAME)?.value

  if (isAuthApi(pathname)) {
    return NextResponse.next()
  }

  if (!token) {
    if (isProtectedRoute(pathname)) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    return NextResponse.next()
  }

  try {
    const secret = getSecretKey()
    const { payload } = await jwtVerify(token, secret)
    const role = payload.role as string | undefined

    if (isAuthRoute(pathname)) {
      const url = request.nextUrl.clone()
      url.pathname = '/studio'
      return NextResponse.redirect(url)
    }

    if (isAdminRoute(pathname) && role !== 'super_admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/studio'
      url.searchParams.set('error', 'admin_only')
      return NextResponse.redirect(url)
    }

    return NextResponse.next()
  } catch (error) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
