import { isValidObjectId, Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { InvoiceImport } from '@/models/InvoiceImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getActiveTemplate } from '@/services/csv-template.service'
import { detectIdentityMapping, normalizeMatchValue } from '@/lib/catalog-columns'
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement, readStockCell } from '@/lib/shopcaisse-stock'
import type { InvoiceItem } from '@/models/InvoiceImport'

// Ordre de priorité de l'appariement (R1.2) : code-barres → référence → nom.
// Le nom est apparié SEUL (sans fournisseur) car, sur les données réelles, la
// facture ne porte ni référence ni code-barres — l'identité est dans le Nom.
type MatchKey = 'barcode' | 'reference' | 'name'

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
  csvData: Record<string, unknown> | null
}

interface NewGroup {
  qty: number
  reference: string | null
  barcode: string | null
  description: string | null
}

/**
 * Applique une facture validée au catalogue en AJOUTANT la quantité de chaque
 * ligne au stock du produit correspondant (facture = marchandise reçue, D1/R1.1).
 *
 * Appariement par identité réellement présente : code-barres → référence → nom
 * normalisé (R1.2). Aucune donnée n'est inventée (R1.3) : les champs absents
 * restent vides. Un nom absent crée un nouveau produit (R1.4/D2) ; plusieurs
 * candidats pour une même clé sont ambigus et jamais écrits (R1.5/D4).
 *
 * Les lignes visant le même produit sont agrégées avant écriture (R1.6), et le
 * stock existant est lu via `parseLocalizedNumber` — jamais par coercition
 * numérique brute qui détruirait « 1 200 » ou « 12,5 » (R1.7).
 *
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

  const identityColumns = detectIdentityMapping(columnNames)

  const summary: ApplyInvoiceSummary = { updated: 0, created: 0, ambiguous: [], skipped: [] }

  // Le catalogue est chargé et indexé une fois (csvData compris, pour lire le
  // stock existant en mémoire) : une requête par ligne serait ruineuse.
  const existing = (await CatalogProduct.find({ isDeleted: false })
    .select('reference barcode name csvData')
    .lean()) as unknown as IndexedProduct[]

  const byId = new Map(existing.map((product) => [String(product._id), product]))

  const indexes: Record<MatchKey, Map<string, Types.ObjectId[]>> = {
    barcode: new Map(),
    reference: new Map(),
    name: new Map(),
  }
  for (const product of existing) {
    addToIndex(indexes.barcode, normalizeMatchValue(product.barcode), product._id)
    addToIndex(indexes.reference, normalizeMatchValue(product.reference), product._id)
    addToIndex(indexes.name, normalizeMatchValue(product.name), product._id)
  }

  const templateObjectId = template._id as Types.ObjectId

  // Première passe : résolution + agrégation par produit cible (R1.6).
  const matchedAdds = new Map<string, number>()
  const newGroups = new Map<string, NewGroup>()

  invoice.items.forEach((item: InvoiceItem, rowIndex: number) => {
    const quantity = item.quantity
    if (quantity === null || quantity === undefined || Number.isNaN(quantity)) {
      summary.skipped.push({ row: rowIndex, reason: 'Quantité absente.' })
      return
    }

    const match = findMatch(indexes, {
      barcode: item.barcode,
      reference: item.supplierReference,
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
      const key = String(match.id)
      matchedAdds.set(key, (matchedAdds.get(key) ?? 0) + quantity)
      return
    }

    // Aucun match : nouveau produit, dédupliqué sur la première clé non vide.
    const nbc = normalizeMatchValue(item.barcode)
    const nref = normalizeMatchValue(item.supplierReference)
    const nnm = normalizeMatchValue(item.description)
    const dedupeKey = nbc ? `b:${nbc}` : nref ? `r:${nref}` : nnm ? `n:${nnm}` : `i:${rowIndex}`
    const group = newGroups.get(dedupeKey)
    if (group) group.qty += quantity
    else
      newGroups.set(dedupeKey, {
        qty: quantity,
        reference: item.supplierReference ?? null,
        barcode: item.barcode ?? null,
        description: item.description ?? null,
      })
  })

  // Seconde passe : une écriture par produit distinct.
  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  for (const [idStr, addQty] of matchedAdds) {
    const csv = byId.get(idStr)?.csvData ?? {}

    // La marchandise reçue augmente la CIBLE (Stock souhaité), pas le Stock actuel
    // (l'état connu de ShopCaisse). Le mouvement exporté vaut alors la quantité reçue.
    const souhaite = readStockCell(csv[COL.stockSouhaite])
    const actuel = readStockCell(csv[COL.stockActuel])
    const base = souhaite.kind === 'number' ? souhaite.value : actuel.kind === 'number' ? actuel.value : 0
    const newSouhaite = String(base + addQty)
    const movement = computeMovement(csv[COL.stockActuel], newSouhaite)
    const movementValue = movement.kind === 'value' ? movement.text : null

    operations.push({
      updateOne: {
        filter: { _id: new Types.ObjectId(idStr) },
        update: [
          {
            // $setField (clé littérale) : un nom de colonne avec espace ou point ne
            // doit pas être interprété comme un chemin pointé. On pose deux champs :
            // Stock souhaité, puis Mouvement stock recalculé par-dessus.
            $set: {
              csvData: {
                $setField: {
                  field: COL.mouvementStock,
                  input: { $setField: { field: COL.stockSouhaite, input: '$csvData', value: newSouhaite } },
                  value: movementValue,
                },
              },
              lastUpdatedFromInvoiceId: new Types.ObjectId(invoiceId),
            },
          },
        ],
      },
    })
    summary.updated += 1
  }

  for (const group of newGroups.values()) {
    const csvData: Record<string, string> = {}
    if (identityColumns.reference && group.reference) csvData[identityColumns.reference] = group.reference
    if (identityColumns.barcode && group.barcode) csvData[identityColumns.barcode] = group.barcode
    if (identityColumns.name && group.description) csvData[identityColumns.name] = group.description

    // Famille et fournisseur saisis à l'import : une facture ne les porte pas.
    if (invoice.defaultFamily) csvData[COL.famille] = invoice.defaultFamily
    if (invoice.defaultSupplier) csvData[COL.fournisseur] = invoice.defaultSupplier

    // ShopCaisse ne connaît pas encore ce produit : Stock actuel = 0 (factuel, pas
    // inventé), Stock souhaité = quantité reçue, d'où un Mouvement = quantité.
    const movement = computeMovement('0', String(group.qty))
    csvData[COL.stockActuel] = '0'
    csvData[COL.stockSouhaite] = String(group.qty)
    csvData[COL.mouvementStock] = movement.kind === 'value' ? movement.text : String(group.qty)

    operations.push({
      insertOne: {
        document: {
          templateId: templateObjectId,
          reference: group.reference,
          barcode: group.barcode,
          name: group.description,
          supplier: null,
          csvData,
          originalCsvData: csvData,
          createdFromInvoiceId: new Types.ObjectId(invoiceId),
          isDeleted: false,
        },
      },
    })
    summary.created += 1
  }

  if (operations.length) {
    await CatalogProduct.bulkWrite(operations, { ordered: false })
  }

  invoice.appliedToCatalogAt = new Date()
  await invoice.save()

  return summary
}

function addToIndex(index: Map<string, Types.ObjectId[]>, key: string, id: Types.ObjectId) {
  // Une valeur vide n'identifie personne.
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
  identity: { barcode: string | null; reference: string | null; name: string | null },
): MatchOutcome {
  const candidates: Array<[MatchKey, string]> = [
    ['barcode', normalizeMatchValue(identity.barcode)],
    ['reference', normalizeMatchValue(identity.reference)],
    ['name', normalizeMatchValue(identity.name)],
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
