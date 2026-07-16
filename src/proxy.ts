import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_COOKIE, verifySession } from '@/lib/admin-auth'

// Exemptés de la garde : la page et la route de connexion, sinon boucle.
const PUBLIC_PATHS = ['/admin/login', '/api/admin/login']

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next()
  }

  const secret = process.env.SESSION_SECRET
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  const valid = Boolean(secret) && (await verifySession(secret as string, token))

  if (valid) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized', message: 'Connexion admin requise.' }, { status: 401 })
  }

  const loginUrl = new URL('/admin/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
