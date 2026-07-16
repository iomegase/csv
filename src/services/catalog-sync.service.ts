import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { detectIdentityMapping, nameSupplierKey, normalizeMatchValue } from '@/lib/catalog-columns'
import type { ParsedCsv } from '@/services/csv-parser.service'

export type MatchKey = 'shopcaisseId' | 'reference' | 'barcode' | 'nameSupplier'

export interface CatalogSyncSummary {
  created: number
  updated: number
  ambiguous: Array<{ row: number; matchedBy: MatchKey; candidateIds: string[] }>
  /** Produits du catalogue absents du CSV. Jamais supprimés ni marqués (D2). */
  missingFromCsv: string[]
  errors: Array<{ row: number; message: string }>
}

const BATCH_SIZE = 500

interface IndexedProduct {
  _id: Types.ObjectId
  shopcaisseId: string | null
  reference: string | null
  barcode: string | null
  name: string | null
  supplier: string | null
}

/**
 * Aligne le catalogue sur les lignes d'un CSV.
 *
 * Volontairement hors transaction : un CSV de plusieurs milliers de lignes
 * dépasserait la limite de 16 Mo de l'oplog transactionnel et le délai de 60 s
 * par défaut. Les écritures sont idempotentes, donc l'opération est relançable
 * après échec partiel.
 */
export async function syncCatalogFromCsv(
  templateId: string,
  parsed: ParsedCsv,
): Promise<CatalogSyncSummary> {
  await connectToDatabase()

  const mapping = detectIdentityMapping(parsed.columns)
  const summary: CatalogSyncSummary = {
    created: 0,
    updated: 0,
    ambiguous: [],
    missingFromCsv: [],
    errors: [],
  }

  // Le catalogue est chargé et indexé en mémoire une fois : une requête par
  // ligne serait ruineuse sur plusieurs milliers de produits.
  const existing = (await CatalogProduct.find({ isDeleted: false })
    .select('shopcaisseId reference barcode name supplier')
    .lean()) as unknown as IndexedProduct[]

  const indexes: Record<MatchKey, Map<string, Types.ObjectId[]>> = {
    shopcaisseId: new Map(),
    reference: new Map(),
    barcode: new Map(),
    nameSupplier: new Map(),
  }

  for (const product of existing) {
    addToIndex(indexes.shopcaisseId, normalizeMatchValue(product.shopcaisseId), product._id)
    addToIndex(indexes.reference, normalizeMatchValue(product.reference), product._id)
    addToIndex(indexes.barcode, normalizeMatchValue(product.barcode), product._id)
    addToIndex(indexes.nameSupplier, nameSupplierKey(product.name, product.supplier), product._id)
  }

  const seen = new Set<string>()
  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  parsed.rows.forEach((row, rowIndex) => {
    try {
      const identity = {
        shopcaisseId: readCell(row, mapping.shopcaisseId),
        reference: readCell(row, mapping.reference),
        barcode: readCell(row, mapping.barcode),
        name: readCell(row, mapping.name),
        supplier: readCell(row, mapping.supplier),
      }

      const csvData = Object.fromEntries(
        parsed.columns.map((column) => [column, normalizeCsvValue(row[column])]),
      )

      const match = findMatch(indexes, identity)

      if (match.status === 'ambiguous') {
        summary.ambiguous.push({
          row: rowIndex,
          matchedBy: match.matchedBy,
          candidateIds: match.candidateIds.map(String),
        })
      }

      if (match.status === 'matched') {
        seen.add(String(match.id))
        operations.push({
          updateOne: {
            filter: { _id: match.id },
            update: {
              $set: {
                templateId: new Types.ObjectId(templateId),
                ...identity,
                csvData,
              },
              // originalCsvData n'est écrit qu'à la création (D3) : $setOnInsert
              // ne s'applique pas ici puisque le document existe déjà.
            },
          },
        })
        summary.updated += 1
        return
      }

      // Ambigu ou sans correspondance : nouveau produit. Jamais de fusion (D4).
      operations.push({
        insertOne: {
          document: {
            templateId: new Types.ObjectId(templateId),
            ...identity,
            csvData,
            originalCsvData: csvData,
            isDeleted: false,
          },
        },
      })
      summary.created += 1
    } catch (error) {
      summary.errors.push({
        row: rowIndex,
        message: error instanceof Error ? error.message : 'Ligne illisible.',
      })
    }
  })

  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    await CatalogProduct.bulkWrite(operations.slice(index, index + BATCH_SIZE), { ordered: false })
  }

  summary.missingFromCsv = existing
    .filter((product) => !seen.has(String(product._id)))
    .map((product) => String(product._id))

  return summary
}

function addToIndex(index: Map<string, Types.ObjectId[]>, key: string, id: Types.ObjectId) {
  // Une valeur vide n'identifie personne : deux produits sans code-barres ne
  // sont pas le même produit.
  if (!key) return
  const bucket = index.get(key)
  if (bucket) bucket.push(id)
  else index.set(key, [id])
}

type MatchOutcome =
  | { status: 'matched'; id: Types.ObjectId; matchedBy: MatchKey }
  | { status: 'ambiguous'; matchedBy: MatchKey; candidateIds: Types.ObjectId[] }
  | { status: 'new' }

function findMatch(
  indexes: Record<MatchKey, Map<string, Types.ObjectId[]>>,
  identity: {
    shopcaisseId: string | null
    reference: string | null
    barcode: string | null
    name: string | null
    supplier: string | null
  },
): MatchOutcome {
  const candidates: Array<[MatchKey, string]> = [
    ['shopcaisseId', normalizeMatchValue(identity.shopcaisseId)],
    ['reference', normalizeMatchValue(identity.reference)],
    ['barcode', normalizeMatchValue(identity.barcode)],
    ['nameSupplier', nameSupplierKey(identity.name, identity.supplier)],
  ]

  for (const [matchedBy, key] of candidates) {
    if (!key) continue

    const bucket = indexes[matchedBy].get(key)
    if (!bucket?.length) continue

    // Plusieurs candidats : on ne choisit pas à la place de l'utilisateur.
    if (bucket.length > 1) return { status: 'ambiguous', matchedBy, candidateIds: bucket }

    return { status: 'matched', id: bucket[0], matchedBy }
  }

  return { status: 'new' }
}

function readCell(row: Record<string, string>, column: string): string | null {
  if (!column) return null
  const value = row[column]
  return value === undefined || value === null || value.trim() === '' ? null : value.trim()
}

/** Une valeur absente vaut null, jamais 0 ni « N/A ». */
function normalizeCsvValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return value as string
}
