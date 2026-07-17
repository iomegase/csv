import { COL } from '@/lib/shopcaisse-columns'
import { countCatalogValues } from '@/services/catalog-facets.service'
import { FacetList } from '@/components/catalog/FacetList'

// Le catalogue change à chaque import : aucun cache.
export const dynamic = 'force-dynamic'

export default async function FournisseursPage() {
  const entries = await countCatalogValues(COL.fournisseur)

  return (
    <FacetList
      title="Fournisseurs"
      description="Tous les fournisseurs renseignés dans le tableau maître."
      valueLabel="Fournisseur"
      entries={entries}
    />
  )
}
