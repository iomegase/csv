import { isValidObjectId, Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { InvoiceImport } from '@/models/InvoiceImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getActiveTemplate } from '@/services/csv-template.service'
import { detectColumnMapping } from '@/lib/product-views'
import { detectIdentityMapping, normalizeMatchValue, nameSupplierKey } from '@/lib/catalog-columns'
import type { InvoiceItem } from '@/models/InvoiceImport'

type MatchKey = 'reference' | 'barcode' | 'nameSupplier'

export interface ApplyInvoiceSummary {
  updated: number
  created: number
  ambiguous: Array<{ row: number; matchedBy: MatchKey; candidateIds: string[] }>
  skipped: Array<{ row: number; reason: string }>
}

interface IndexedProduct {
  _id: Types.ObjectId
  reference: string | null
  barcode: string | null
  name: string | null
  supplier: string | null
}

/**
 * Applique une facture validée au catalogue en AJOUTANT la quantité de chaque
 * ligne au stock du produit correspondant (facture = marchandise reçue, D1).
 * Un produit inconnu est créé (D2) ; un cas ambigu n'est jamais écrit (D4).
 * Hors transaction : `appliedToCatalogAt` garantit qu'on n'applique qu'une fois.
 */
export async function applyInvoiceToCatalog(invoiceId: string): Promise<ApplyInvoiceSummary> {
  if (!isValidObjectId(invoiceId)) throw new Error('Identifiant de facture invalide.')
  await connectToDatabase()

  const invoice = await InvoiceImport.findById(invoiceId)
  if (!invoice) throw new Error('Facture introuvable.')
  if (!invoice.validatedAt) throw new Error('Facture non validée.')
  if (invoice.appliedToCatalogAt) throw new Error('Facture déjà appliquée au catalogue.')

  const template = await getActiveTemplate()
  if (!template) throw new Error('Aucun template actif.')

  const columnNames = [...template.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => column.name)
  const stockColumn = detectColumnMapping(columnNames).stock
  if (!stockColumn) {
    throw new Error('Le template actif n’a pas de colonne quantité/stock reconnaissable.')
  }

  const identityColumns = detectIdentityMapping(columnNames)

  const summary: ApplyInvoiceSummary = { updated: 0, created: 0, ambiguous: [], skipped: [] }

  const existing = (await CatalogProduct.find({ isDeleted: false })
    .select('reference barcode name supplier')
    .lean()) as unknown as IndexedProduct[]

  const indexes: Record<MatchKey, Map<string, Types.ObjectId[]>> = {
    reference: new Map(),
    barcode: new Map(),
    nameSupplier: new Map(),
  }
  for (const product of existing) {
    addToIndex(indexes.reference, normalizeMatchValue(product.reference), product._id)
    addToIndex(indexes.barcode, normalizeMatchValue(product.barcode), product._id)
    addToIndex(indexes.nameSupplier, nameSupplierKey(product.name, product.supplier), product._id)
  }

  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []
  const templateObjectId = template._id as Types.ObjectId

  invoice.items.forEach((item: InvoiceItem, rowIndex: number) => {
    const quantity = item.quantity
    if (quantity === null || quantity === undefined || Number.isNaN(quantity)) {
      summary.skipped.push({ row: rowIndex, reason: 'Quantité absente.' })
      return
    }

    const match = findMatch(indexes, {
      reference: item.supplierReference,
      barcode: item.barcode,
      name: item.description,
    })

    if (match.status === 'ambiguous') {
      summary.ambiguous.push({
        row: rowIndex,
        matchedBy: match.matchedBy,
        candidateIds: match.candidateIds.map(String),
      })
      return
    }

    if (match.status === 'matched') {
      operations.push({
        updateOne: {
          filter: { _id: match.id },
          update: [
            {
              $set: {
                [`csvData.${stockColumn}`]: {
                  $toString: {
                    $add: [currentStockExpression(stockColumn), quantity],
                  },
                },
                lastUpdatedFromInvoiceId: new Types.ObjectId(invoiceId),
              },
            },
          ],
        },
      })
      summary.updated += 1
      return
    }

    // Aucun match : création à partir des colonnes d'identité du template.
    const csvData: Record<string, string> = {}
    if (identityColumns.reference && item.supplierReference) csvData[identityColumns.reference] = item.supplierReference
    if (identityColumns.barcode && item.barcode) csvData[identityColumns.barcode] = item.barcode
    if (identityColumns.name && item.description) csvData[identityColumns.name] = item.description
    csvData[stockColumn] = String(quantity)

    operations.push({
      insertOne: {
        document: {
          templateId: templateObjectId,
          reference: item.supplierReference ?? null,
          barcode: item.barcode ?? null,
          name: item.description ?? null,
          supplier: null,
          csvData,
          originalCsvData: csvData,
          createdFromInvoiceId: new Types.ObjectId(invoiceId),
          isDeleted: false,
        },
      },
    })
    summary.created += 1
  })

  if (operations.length) {
    await CatalogProduct.bulkWrite(operations, { ordered: false })
  }

  invoice.appliedToCatalogAt = new Date()
  await invoice.save()

  return summary
}

/**
 * Expression d'agrégation : stock actuel converti en nombre. Une cellule vide,
 * absente ou illisible vaut 0 (jamais null dans une somme). `$getField` (et non
 * `$csvData.<col>`) car un nom de colonne peut contenir des espaces.
 */
function currentStockExpression(stockColumn: string) {
  return {
    $convert: {
      input: { $getField: { field: stockColumn, input: '$csvData' } },
      to: 'double',
      onError: 0,
      onNull: 0,
    },
  }
}

function addToIndex(index: Map<string, Types.ObjectId[]>, key: string, id: Types.ObjectId) {
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
  identity: { reference: string | null; barcode: string | null; name: string | null },
): MatchOutcome {
  const candidates: Array<[MatchKey, string]> = [
    ['reference', normalizeMatchValue(identity.reference)],
    ['barcode', normalizeMatchValue(identity.barcode)],
    // Pas de fournisseur au niveau ligne de facture : nom seul ne suffit pas à
    // fabriquer une clé nameSupplier, donc ce candidat reste vide en pratique.
    ['nameSupplier', nameSupplierKey(identity.name, null)],
  ]

  for (const [matchedBy, key] of candidates) {
    if (!key) continue
    const bucket = indexes[matchedBy].get(key)
    if (!bucket?.length) continue
    if (bucket.length > 1) return { status: 'ambiguous', matchedBy, candidateIds: bucket }
    return { status: 'matched', id: bucket[0], matchedBy }
  }

  return { status: 'new' }
}
