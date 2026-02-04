'use client'

import Link from 'next/link'

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-bold text-zinc-900">Password reset</h1>
        <p className="text-zinc-500 mt-3">
          Password resets are handled by your admin. Contact them for a new password.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center justify-center mt-6 px-4 py-2 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800"
        >
          Back to login
        </Link>
      </div>
    </div>
  )
}
