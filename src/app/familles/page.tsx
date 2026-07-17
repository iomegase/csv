import { COL } from '@/lib/shopcaisse-columns'
import { countCatalogValues } from '@/services/catalog-facets.service'
import { FacetList } from '@/components/catalog/FacetList'

// Le catalogue change à chaque import : aucun cache.
export const dynamic = 'force-dynamic'

export default async function FamillesPage() {
  const entries = await countCatalogValues(COL.famille)

  return (
    <FacetList
      title="Familles"
      description="Toutes les familles renseignées dans le tableau maître."
      valueLabel="Famille"
      entries={entries}
    />
  )
}
