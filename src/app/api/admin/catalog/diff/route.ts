import { NextResponse } from 'next/server'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'
import { validateMaster } from '@/services/shopcaisse-validation.service'

export async function GET() {
  try {
    // Les deux lectures alimentent la même page : la comparaison à l'original
    // d'un côté, l'état d'export du maître de l'autre.
    const [diff, validation] = await Promise.all([diffCatalogAgainstSource(), validateMaster()])
    return NextResponse.json({ diff, validation })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Comparaison impossible.'
    const status = /template/i.test(message) ? 404 : 500
    return NextResponse.json({ error: 'diff_failed', message }, { status })
  }
}
