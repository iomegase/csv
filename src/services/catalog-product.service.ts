import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement, readStockCell } from '@/lib/shopcaisse-stock'
import { parseLocalizedNumber } from '@/lib/product-views'
import { normalizeSupprime } from '@/services/shopcaisse-master.service'
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

  // Plus de filtre isDeleted : une ligne marquée « Supprimé » reste dans le
  // tableau maître et dans les deux exports — c'est ce marquage que ShopCaisse
  // doit lire pour supprimer l'article de son côté.
  const [products, total] = await Promise.all([
    CatalogProduct.find({})
      .sort({ _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select('csvData')
      .lean(),
    CatalogProduct.countDocuments({}),
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

/** Tout le tableau maître, ligne supprimée comprise (décision L5-3). */
export async function listAllCatalogProducts(): Promise<
  Array<{ id: string; csvData: Record<string, unknown> }>
> {
  await connectToDatabase()
  const products = await CatalogProduct.find({}).sort({ _id: 1 }).select('csvData').lean()
  return products.map((product) => ({
    id: String(product._id),
    csvData: (product.csvData ?? {}) as Record<string, unknown>,
  }))
}

/** Renseignées par l'application, jamais par l'utilisateur. */
const READ_ONLY_COLUMNS: readonly string[] = [COL.identifiant, COL.mouvementStock]

/**
 * Écrit des cellules du tableau maître.
 *
 * Lit le document avant d'écrire : `Mouvement stock` dépend des deux colonnes
 * de stock, et la modification n'en porte qu'une. Sans relecture, on
 * recalculerait le mouvement contre une valeur inconnue.
 *
 * Une valeur vide devient null (jamais 0), jamais inventée.
 */
export async function updateCatalogProductCells(
  id: string,
  cells: Record<string, string | null>,
): Promise<void> {
  if (!isValidObjectId(id)) throw new Error('Identifiant de produit invalide.')
  if (!Object.keys(cells).length) return

  for (const column of Object.keys(cells)) {
    // L'Identifiant est délivré par ShopCaisse ; le mouvement est un calcul.
    // Les laisser écrire produirait un fichier que la caisse rejetterait.
    if (READ_ONLY_COLUMNS.includes(column)) throw new Error(`Colonne en lecture seule : ${column}.`)
  }

  await connectToDatabase()

  const product = await CatalogProduct.findById(id).select('csvData').lean()
  if (!product) throw new Error('Produit introuvable.')

  const current = (product.csvData ?? {}) as Record<string, unknown>
  const set: Record<string, string | null | boolean> = {}
  const next = { ...current } as Record<string, string | null>

  for (const [column, value] of Object.entries(cells)) {
    const normalized =
      column === COL.supprime ? normalizeSupprime(value) : value === null || value === '' ? null : value
    set[`csvData.${column}`] = normalized
    next[column] = normalized
  }

  for (const column of [COL.stockActuel, COL.stockSouhaite]) {
    if (!(column in cells)) continue
    const cell = readStockCell(next[column])
    // On refuse avant d'écrire : une quantité illisible en base contaminerait
    // le mouvement et donc le fichier stock.
    if (cell.kind === 'invalid') throw new Error(`${column} non numérique : « ${cell.raw} ».`)
  }

  if (COL.stockActuel in cells || COL.stockSouhaite in cells) {
    const movement = computeMovement(next[COL.stockActuel], next[COL.stockSouhaite])
    set[`csvData.${COL.mouvementStock}`] = movement.kind === 'value' ? movement.text : null
  }

  // isDeleted suit la colonne : la page Comparer classe « supprimés » sur ce
  // champ, et les deux doivent raconter la même histoire (décision L5-3).
  if (COL.supprime in cells) set.isDeleted = next[COL.supprime] === '1'

  await CatalogProduct.updateOne({ _id: new Types.ObjectId(id) }, { $set: set })
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

export type BulkAction =
  | { type: 'family'; value: string }
  | { type: 'supplier'; value: string }
  | { type: 'ttcFromHt'; coefficient: number }

/**
 * Édition en masse d'une sélection de produits.
 *
 * - `family` / `supplier` : pose la même valeur sur tout le lot.
 * - `ttcFromHt` : calcule le Prix TTC = Prix d'achat (HT) × coefficient, produit
 *   par produit (chaque HT diffère). Un produit sans HT lisible est ignoré.
 *
 * On écrit toujours via `$setField` (clé littérale) : les intitulés portent des
 * espaces (et le prix TTC un tiret), qu'un chemin pointé scinderait.
 */
export async function bulkUpdateProducts(ids: string[], action: BulkAction): Promise<{ updated: number }> {
  await connectToDatabase()
  const objectIds = ids.filter((id) => isValidObjectId(id)).map((id) => new Types.ObjectId(id))
  if (!objectIds.length) return { updated: 0 }

  if (action.type === 'family' || action.type === 'supplier') {
    const column = action.type === 'family' ? COL.famille : COL.fournisseur
    const res = await CatalogProduct.updateMany(
      { _id: { $in: objectIds } },
      [{ $set: { csvData: { $setField: { field: column, input: '$csvData', value: action.value } } } }],
      { updatePipeline: true },
    )
    return { updated: res.modifiedCount }
  }

  // ttcFromHt : chaque produit a son propre HT, donc une écriture par produit.
  const products = await CatalogProduct.find({ _id: { $in: objectIds } }).select('csvData').lean()
  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []
  for (const product of products) {
    const csv = (product.csvData ?? {}) as Record<string, unknown>
    const ht = parseLocalizedNumber(String(csv[COL.prixAchat] ?? ''))
    if (ht === null) continue
    const ttc = (ht * action.coefficient).toFixed(2)
    operations.push({
      updateOne: {
        filter: { _id: product._id },
        update: [{ $set: { csvData: { $setField: { field: COL.prixTtc, input: '$csvData', value: ttc } } } }],
      },
    })
  }
  if (operations.length) await CatalogProduct.bulkWrite(operations, { ordered: false })
  return { updated: operations.length }
}
