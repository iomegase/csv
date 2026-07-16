import Link from 'next/link'
import { getActiveTemplate } from '@/services/csv-template.service'
import { getCatalogColumnKeys, listCatalogProducts } from '@/services/catalog-product.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'
import { CatalogSummary } from '@/components/catalog/CatalogSummary'
import { CatalogProductsTable } from '@/components/catalog/CatalogProductsTable'
import { ExportCatalogButton } from '@/components/catalog/ExportCatalogButton'

// Le catalogue change à chaque synchronisation : aucun cache.
export const dynamic = 'force-dynamic'

export default async function CataloguePage() {
  const template = await getActiveTemplate()

  if (!template) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-slate-600">{NO_ACTIVE_TEMPLATE_MESSAGE}</p>
          <Link
            href="/tous-les-produits"
            className="mt-6 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Importer un CSV
          </Link>
        </div>
      </main>
    )
  }

  const [{ products, total }, catalogKeys] = await Promise.all([
    listCatalogProducts({ page: 1, pageSize: 100 }),
    getCatalogColumnKeys(),
  ])

  const columns = [...template.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => column.name)

  // Colonnes réclamées par le template mais absentes du catalogue : le cas
  // survient après une activation forcée (D6).
  const missingColumns = catalogKeys.length
    ? columns.filter((column) => !catalogKeys.includes(column))
    : []

  return (
    <main className="min-h-screen space-y-6 p-4 md:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Catalogue</h1>
          <ExportCatalogButton />
        </div>

        <CatalogSummary
          templateName={template.name}
          templateUpdatedAt={String(template.updatedAt)}
          productCount={total}
          missingColumns={missingColumns}
        />

        <CatalogProductsTable columns={columns} products={products} />
      </div>
    </main>
  )
}
