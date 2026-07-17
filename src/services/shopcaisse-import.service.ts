import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { COL, MASTER_COLUMNS, type MasterRow } from '@/lib/shopcaisse-columns'
import { buildIdentityIndex, matchRow, type IdentityRule } from '@/lib/shopcaisse-identity'
import { CatalogProduct } from '@/models/CatalogProduct'
import type { ParsedCsv } from '@/services/csv-parser.service'
import {
  ensureMasterTemplate,
  toMasterRow,
  withMovement,
} from '@/services/shopcaisse-master.service'

export interface ImportSummary {
  created: number
  updated: number
  /** Lignes du fichier (0-based) dont la correspondance était ambiguë : ni fusionnées, ni créées. */
  ambiguous: Array<{ row: number; rule: IdentityRule }>
  errors: Array<{ row: number; message: string }>
}

const BATCH_SIZE = 500

interface ExistingEntry {
  _id: Types.ObjectId
  row: MasterRow
}

/**
 * Aligne le tableau maître sur `export-produits.csv`.
 *
 * Hors transaction, comme `syncCatalogFromCsv` : un fichier de plusieurs
 * milliers de lignes dépasserait la limite de 16 Mo de l'oplog transactionnel.
 * Les écritures sont idempotentes, donc l'import est relançable.
 */
export async function importProductsIntoMaster(parsed: ParsedCsv): Promise<ImportSummary> {
  await connectToDatabase()
  const templateId = await ensureMasterTemplate()

  const summary: ImportSummary = { created: 0, updated: 0, ambiguous: [], errors: [] }

  const existing = await loadExisting()
  const index = buildIdentityIndex(existing.map((entry) => ({ row: entry.row, item: entry })))

  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  parsed.rows.forEach((source, rowIndex) => {
    try {
      const incoming = toMasterRow(source)
      const match = matchRow(index, incoming)

      if (match.status === 'ambiguous') {
        // On ne choisit pas à la place de l'utilisateur, et on ne crée pas non
        // plus une ligne de plus : ce serait fabriquer un troisième doublon.
        summary.ambiguous.push({ row: rowIndex, rule: match.rule })
        return
      }

      if (match.status === 'matched') {
        const merged = mergeProductRow(match.item.row, incoming)
        operations.push({
          updateOne: {
            filter: { _id: match.item._id },
            update: { $set: { templateId: new Types.ObjectId(templateId), ...writeFields(merged) } },
          },
        })
        summary.updated += 1
        return
      }

      const row = withMovement(incoming)
      operations.push({
        insertOne: {
          document: {
            templateId: new Types.ObjectId(templateId),
            ...writeFields(row),
            // Écrit à la création seulement : c'est le socle de comparaison.
            originalCsvData: row,
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

  await flush(operations)
  return summary
}

/**
 * Fusionne une ligne importée dans la ligne maître existante.
 *
 * Les trois colonnes de stock sont internes : le fichier produits ne les porte
 * pas, et les écraser effacerait un travail de saisie.
 */
function mergeProductRow(existing: MasterRow, incoming: MasterRow): MasterRow {
  const merged: MasterRow = { ...existing }
  for (const column of MASTER_COLUMNS) {
    if (column === COL.stockActuel || column === COL.stockSouhaite || column === COL.mouvementStock) {
      continue
    }
    merged[column] = incoming[column]
  }
  return withMovement(merged)
}

/**
 * Les champs d'identité sont dupliqués hors de csvData pour l'indexation
 * MongoDB (convention du modèle existant) ; csvData reste la valeur de référence.
 */
function writeFields(row: MasterRow) {
  return {
    shopcaisseId: row[COL.identifiant],
    reference: row[COL.reference],
    barcode: row[COL.codeBarre],
    name: row[COL.nom],
    supplier: row[COL.fournisseur],
    csvData: row,
    isDeleted: row[COL.supprime] === '1',
  }
}

async function loadExisting(): Promise<ExistingEntry[]> {
  // Le maître est chargé et indexé en mémoire une fois : une requête par ligne
  // serait ruineuse sur plusieurs milliers de produits.
  const products = await CatalogProduct.find({}).sort({ _id: 1 }).select('csvData').lean()
  return products.map((product) => ({
    _id: product._id as Types.ObjectId,
    row: toMasterRow((product.csvData ?? {}) as Record<string, unknown>),
  }))
}

async function flush(operations: Parameters<typeof CatalogProduct.bulkWrite>[0]): Promise<void> {
  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    await CatalogProduct.bulkWrite(operations.slice(index, index + BATCH_SIZE), { ordered: false })
  }
}
