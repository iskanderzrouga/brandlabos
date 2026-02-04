import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token = searchParams.get('token')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const next = searchParams.get('next') ?? '/studio'

  // If Supabase returned an error, pass it to login
  if (error) {
    console.error('Auth callback error:', error, errorDescription)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(errorDescription || error)}`)
  }

  const supabase = await createClient()

  // Handle PKCE flow (code exchange)
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (!exchangeError) {
      if (type === 'recovery' || type === 'invite') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('Code exchange error:', exchangeError)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(exchangeError.message)}`)
  }

  // Handle token-based verification (email links like invite, recovery)
  if (token || tokenHash) {
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: tokenHash || token!,
      type: type === 'invite' ? 'invite' : type === 'recovery' ? 'recovery' : 'email',
    })
    if (!verifyError) {
      if (type === 'recovery' || type === 'invite') {
        return NextResponse.redirect(`${origin}/reset-password`)
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
    console.error('Token verify error:', verifyError)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(verifyError.message)}`)
  }

  // No code or token provided
  return NextResponse.redirect(`${origin}/login?error=No authentication code provided`)
}
