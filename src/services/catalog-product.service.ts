import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { isValidObjectId, Types } from 'mongoose'

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

/** Toute la copie de travail (non supprimée), pour l'atelier d'édition. */
export async function listAllCatalogProducts(): Promise<
  Array<{ id: string; csvData: Record<string, unknown> }>
> {
  await connectToDatabase()
  const products = await CatalogProduct.find({ isDeleted: false })
    .sort({ _id: 1 })
    .select('csvData')
    .lean()
  return products.map((product) => ({
    id: String(product._id),
    csvData: (product.csvData ?? {}) as Record<string, unknown>,
  }))
}

/** Écrit des cellules. Une valeur vide devient null (jamais 0), jamais inventée. */
export async function updateCatalogProductCells(
  id: string,
  cells: Record<string, string | null>,
): Promise<void> {
  if (!isValidObjectId(id)) throw new Error('Identifiant de produit invalide.')
  await connectToDatabase()
  const set: Record<string, string | null> = {}
  for (const [column, value] of Object.entries(cells)) {
    set[`csvData.${column}`] = value === null || value === '' ? null : value
  }
  if (Object.keys(set).length) {
    await CatalogProduct.updateOne({ _id: new Types.ObjectId(id) }, { $set: set })
  }
}

/** Crée un article dans la copie de travail à partir de cellules. */
export async function createCatalogProduct(
  templateId: string,
  csvData: Record<string, string | null>,
): Promise<string> {
  if (!isValidObjectId(templateId)) throw new Error('Identifiant de template invalide.')
  await connectToDatabase()
  const normalized: Record<string, string | null> = {}
  for (const [column, value] of Object.entries(csvData)) {
    normalized[column] = value === null || value === '' ? null : value
  }
  const doc = await CatalogProduct.create({
    templateId: new Types.ObjectId(templateId),
    csvData: normalized,
    originalCsvData: null,
    isDeleted: false,
  })
  return String(doc._id)
}

/** Suppression douce (E4) : l'article reste diffable comme « supprimé ». */
export async function softDeleteCatalogProduct(id: string): Promise<void> {
  if (!isValidObjectId(id)) throw new Error('Identifiant de produit invalide.')
  await connectToDatabase()
  await CatalogProduct.updateOne({ _id: new Types.ObjectId(id) }, { $set: { isDeleted: true } })
}
