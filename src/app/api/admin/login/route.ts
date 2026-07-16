import { NextResponse } from 'next/server'
import { loginSchema } from '@/lib/validations/admin.schema'
import { ADMIN_COOKIE, constantTimeEqual, signSession } from '@/lib/admin-auth'

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  const adminPassword = process.env.ADMIN_PASSWORD
  const secret = process.env.SESSION_SECRET
  if (!adminPassword || !secret) {
    return NextResponse.json(
      { error: 'server_misconfigured', message: 'ADMIN_PASSWORD ou SESSION_SECRET manquant.' },
      { status: 500 },
    )
  }

  // Comparaison à temps constant : ne pas révéler la longueur par le timing.
  if (!constantTimeEqual(parsed.data.password, adminPassword)) {
    return NextResponse.json({ error: 'invalid_credentials', message: 'Mot de passe incorrect.' }, { status: 401 })
  }

  const token = await signSession(secret)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  })
  return response
}
