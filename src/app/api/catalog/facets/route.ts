import { NextResponse } from 'next/server'
import { COL } from '@/lib/shopcaisse-columns'
import { countCatalogValues } from '@/services/catalog-facets.service'

/** Familles et fournisseurs déjà enregistrés, pour peupler les selects d'import. */
export async function GET() {
  try {
    const [families, suppliers] = await Promise.all([
      countCatalogValues(COL.famille),
      countCatalogValues(COL.fournisseur),
    ])
    return NextResponse.json({
      families: families.map((entry) => entry.value),
      suppliers: suppliers.map((entry) => entry.value),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    return NextResponse.json({ error: 'facets_failed', message }, { status: 500 })
  }
}
