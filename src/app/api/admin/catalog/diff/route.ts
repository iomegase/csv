import { NextResponse } from 'next/server'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'

export async function GET() {
  try {
    const diff = await diffCatalogAgainstSource()
    return NextResponse.json({ diff })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Comparaison impossible.'
    const status = /template/i.test(message) ? 404 : 500
    return NextResponse.json({ error: 'diff_failed', message }, { status })
  }
}
