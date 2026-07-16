import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'

export interface CatalogProductSummary {
  id: string
  csvData: Record<string, unknown>
}

const COLUMN_SAMPLE_SIZE = 100

export async function listCatalogProducts(options: { page: number; pageSize: number }) {
  await connectToDatabase()

  const page = Math.max(1, options.page)
  const pageSize = Math.min(500, Math.max(1, options.pageSize))

  const [products, total] = await Promise.all([
    CatalogProduct.find({ isDeleted: false })
      .sort({ _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select('csvData')
      .lean(),
    CatalogProduct.countDocuments({ isDeleted: false }),
  ])

  return {
    products: products.map((product) => ({
      id: String(product._id),
      csvData: (product.csvData ?? {}) as Record<string, unknown>,
    })),
    total,
    page,
    pageSize,
  }
}

/**
 * Clés réellement présentes dans csvData, échantillonnées sur le catalogue.
 * Sert à repérer les colonnes qu'un template actif réclame mais que le
 * catalogue ne porte pas (D6).
 */
export async function getCatalogColumnKeys(): Promise<string[]> {
  await connectToDatabase()

  const sample = await CatalogProduct.find({ isDeleted: false })
    .limit(COLUMN_SAMPLE_SIZE)
    .select('csvData')
    .lean()

  const keys = new Set<string>()
  for (const product of sample) {
    for (const key of Object.keys((product.csvData ?? {}) as Record<string, unknown>)) {
      keys.add(key)
    }
  }

  return [...keys]
}
