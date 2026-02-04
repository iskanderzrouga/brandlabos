import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Refresh session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected routes - redirect to login if not authenticated
  const isProtectedRoute =
    request.nextUrl.pathname.startsWith('/studio') ||
    request.nextUrl.pathname.startsWith('/admin')

  const isAdminRoute = request.nextUrl.pathname.startsWith('/admin')
  const isAuthRoute = request.nextUrl.pathname.startsWith('/login')

  if (isProtectedRoute && !user) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Redirect to studio if already logged in and trying to access login
  if (isAuthRoute && user) {
    const url = request.nextUrl.clone()
    url.pathname = '/studio'
    return NextResponse.redirect(url)
  }

  // Check admin access - only super_admin can access /admin routes
  if (isAdminRoute && user) {
    // Get user's app_users record
    const { data: appUser, error: appUserError } = await supabase
      .from('app_users')
      .select('role, auth_user_id')
      .eq('email', user.email)
      .single()

    // If table doesn't exist yet (migration not run), allow access for now
    if (appUserError) {
      // Could be table doesn't exist or user not found - check for table-related errors
      const isTableMissing =
        appUserError.code === '42P01' ||
        appUserError.message?.includes('relation') ||
        appUserError.message?.includes('does not exist')

      if (isTableMissing) {
        // Table doesn't exist - migration not run yet, allow access
        return supabaseResponse
      }

      // PGRST116 means no rows found - user not in app_users table
      if (appUserError.code === 'PGRST116') {
        const url = request.nextUrl.clone()
        url.pathname = '/studio'
        url.searchParams.set('error', 'no_access')
        return NextResponse.redirect(url)
      }
    }

    if (!appUser) {
      // User exists in auth but not in app_users - deny access
      const url = request.nextUrl.clone()
      url.pathname = '/studio'
      url.searchParams.set('error', 'no_access')
      return NextResponse.redirect(url)
    }

    // Update auth_user_id if it's still the placeholder
    if (appUser.auth_user_id === '00000000-0000-0000-0000-000000000000') {
      await supabase
        .from('app_users')
        .update({ auth_user_id: user.id })
        .eq('email', user.email)
    }

    // Only super_admin can access admin routes
    if (appUser.role !== 'super_admin') {
      const url = request.nextUrl.clone()
      url.pathname = '/studio'
      url.searchParams.set('error', 'admin_only')
      return NextResponse.redirect(url)
    }
  }

  // For protected non-admin routes, just sync the auth_user_id
  if (isProtectedRoute && !isAdminRoute && user) {
    const { data: appUser } = await supabase
      .from('app_users')
      .select('auth_user_id')
      .eq('email', user.email)
      .single()

    if (appUser && appUser.auth_user_id === '00000000-0000-0000-0000-000000000000') {
      await supabase
        .from('app_users')
        .update({ auth_user_id: user.id })
        .eq('email', user.email)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - api routes (they have their own auth)
     */
    '/((?!_next/static|_next/image|favicon.ico|api/).*)',
  ],
}
