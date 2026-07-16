export const ADMIN_COOKIE = 'admin_session'

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000 // 12 h

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return toBase64Url(new Uint8Array(signature))
}

/** Comparaison à temps constant, indépendante de la position du premier écart. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Jeton = `<expiration ms>.<HMAC(expiration)>`. Signé côté serveur, vérifiable
 * en edge. ttlMs négatif produit un jeton déjà expiré (utile aux tests).
 */
export async function signSession(secret: string, ttlMs: number = DEFAULT_TTL_MS): Promise<string> {
  const expiry = String(Date.now() + ttlMs)
  const signature = await hmac(secret, expiry)
  return `${expiry}.${signature}`
}

export async function verifySession(
  secret: string,
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false

  const expiry = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!/^\d+$/.test(expiry)) return false

  const expected = await hmac(secret, expiry)
  if (!constantTimeEqual(signature, expected)) return false

  return Number(expiry) > Date.now()
}
