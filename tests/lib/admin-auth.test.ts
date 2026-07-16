import { describe, expect, it } from 'vitest'
import { signSession, verifySession, constantTimeEqual } from '@/lib/admin-auth'

const SECRET = 'secret-de-test-123'

describe('admin-auth', () => {
  it('valide un jeton fraîchement signé', async () => {
    const token = await signSession(SECRET)
    expect(await verifySession(SECRET, token)).toBe(true)
  })

  it('rejette un jeton signé avec un autre secret', async () => {
    const token = await signSession(SECRET)
    expect(await verifySession('autre-secret', token)).toBe(false)
  })

  it('rejette un jeton falsifié', async () => {
    const token = await signSession(SECRET)
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa')
    expect(await verifySession(SECRET, tampered)).toBe(false)
  })

  it('rejette un jeton expiré', async () => {
    const token = await signSession(SECRET, -1000) // déjà expiré
    expect(await verifySession(SECRET, token)).toBe(false)
  })

  it('rejette un jeton absent ou mal formé', async () => {
    expect(await verifySession(SECRET, undefined)).toBe(false)
    expect(await verifySession(SECRET, '')).toBe(false)
    expect(await verifySession(SECRET, 'pasunjeton')).toBe(false)
  })

  it('constantTimeEqual compare correctement', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })
})
