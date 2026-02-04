import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const { origin } = new URL(request.url)
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent('Login is handled by your admin.')}`)
}
