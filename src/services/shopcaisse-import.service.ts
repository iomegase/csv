import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { COL, MASTER_COLUMNS, type MasterRow } from '@/lib/shopcaisse-columns'
import {
  buildIdentityIndex,
  identityKeys,
  IDENTITY_RULES,
  matchRow,
  type IdentityRule,
} from '@/lib/shopcaisse-identity'
import { readStockCell } from '@/lib/shopcaisse-stock'
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

  // L'index ci-dessus est un instantané du maître pris AVANT la boucle et
  // jamais rafraîchi : deux lignes du fichier qui désignent le même produit
  // (existant ou nouveau) y sont invisibles l'une à l'autre. On suit donc
  // séparément, pendant cette passe, ce qui a déjà été touché ou inséré.
  const updatedIds = new Set<string>()
  const insertedKeys = new Map<IdentityRule, Map<string, number>>(
    IDENTITY_RULES.map((rule) => [rule, new Map<string, number>()]),
  )
  const flaggedAsCollisionSource = new Set<number>()

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
        const id = String(match.item._id)
        if (updatedIds.has(id)) {
          // Une ligne précédente de cette même passe a déjà mis à jour ce
          // produit. Un second updateOne sur le même _id, appliqué en mode
          // non ordonné, rendrait le résultat final dépendant de l'ordre
          // d'exécution du driver Mongo : on n'écrit rien et on signale.
          summary.ambiguous.push({ row: rowIndex, rule: match.rule })
          return
        }
        updatedIds.add(id)

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

      // Ligne « nouvelle » au regard du maître : reste à vérifier qu'elle ne
      // désigne pas le même produit qu'une ligne déjà insérée plus tôt dans
      // cette passe (le maître, lui, ne changera qu'après la boucle).
      const collision = findPassCollision(insertedKeys, incoming)
      if (collision) {
        if (!flaggedAsCollisionSource.has(collision.row)) {
          summary.ambiguous.push({ row: collision.row, rule: collision.rule })
          flaggedAsCollisionSource.add(collision.row)
        }
        summary.ambiguous.push({ row: rowIndex, rule: collision.rule })
      }
      registerPassKeys(insertedKeys, incoming, rowIndex)

      // Décision du pilote pour ce lot : on ne perd aucune ligne du fichier,
      // même signalée comme ambiguë — la tâche 8 bloquera l'export tant que
      // l'ambiguïté n'est pas tranchée manuellement.
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
 * Cherche, parmi les clés déjà insérées pendant CETTE passe, une collision
 * avec `row`. Reprend l'ordre de priorité de `identityKeys` (Identifiant →
 * Référence → Nom + Code barre) : la première clé en collision détermine la
 * règle signalée, comme `matchRow` le fait déjà pour le maître.
 */
function findPassCollision(
  insertedKeys: Map<IdentityRule, Map<string, number>>,
  row: MasterRow,
): { rule: IdentityRule; row: number } | null {
  for (const { rule, key } of identityKeys(row)) {
    const firstRow = insertedKeys.get(rule)!.get(key)
    if (firstRow !== undefined) return { rule, row: firstRow }
  }
  return null
}

/**
 * Enregistre les clés d'identité de `row` comme « déjà insérées » dans cette
 * passe. La première ligne à poser une clé en reste propriétaire : les
 * collisions suivantes pointent toutes vers elle, pas vers la dernière venue.
 */
function registerPassKeys(
  insertedKeys: Map<IdentityRule, Map<string, number>>,
  row: MasterRow,
  rowIndex: number,
): void {
  for (const { rule, key } of identityKeys(row)) {
    const bucket = insertedKeys.get(rule)!
    if (!bucket.has(key)) bucket.set(key, rowIndex)
  }
}

/**
 * Range les quantités d'un fichier stock ShopCaisse dans `Stock actuel`.
 *
 * `Stock actuel` et non `Stock souhaité` : le fichier décrit l'état connu de la
 * caisse, pas la cible voulue par l'utilisateur. L'écrire dans `Stock souhaité`
 * réduirait tous les mouvements à zéro.
 *
 * Ce fichier ne crée jamais de produit : une ligne sans famille, sans prix et
 * sans TVA ne décrit pas un article exportable.
 */
export async function importStockIntoMaster(parsed: ParsedCsv): Promise<ImportSummary> {
  await connectToDatabase()
  const templateId = await ensureMasterTemplate()

  const summary: ImportSummary = { created: 0, updated: 0, ambiguous: [], errors: [] }

  const existing = await loadExisting()
  const index = buildIdentityIndex(existing.map((entry) => ({ row: entry.row, item: entry })))

  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  parsed.rows.forEach((source, rowIndex) => {
    const incoming = toMasterRow(source)
    const match = matchRow(index, incoming)

    if (match.status === 'ambiguous') {
      summary.ambiguous.push({ row: rowIndex, rule: match.rule })
      return
    }

    if (match.status === 'new') {
      summary.errors.push({
        row: rowIndex,
        message: `Produit introuvable dans le tableau maître : ${describeRow(incoming)}. Importez d’abord le fichier produits.`,
      })
      return
    }

    const quantity = readStockCell(source[COL.quantite])
    if (quantity.kind === 'invalid') {
      summary.errors.push({ row: rowIndex, message: `Quantité non numérique : « ${quantity.raw} ».` })
      return
    }

    const row = withMovement({
      ...match.item.row,
      [COL.stockActuel]: quantity.kind === 'empty' ? null : String(quantity.value),
    })

    operations.push({
      updateOne: {
        filter: { _id: match.item._id },
        update: { $set: { templateId: new Types.ObjectId(templateId), ...writeFields(row) } },
      },
    })
    summary.updated += 1
  })

  await flush(operations)
  return summary
}

/** De quoi que l'utilisateur reconnaisse la ligne fautive dans son fichier. */
function describeRow(row: MasterRow): string {
  return row[COL.identifiant] ?? row[COL.reference] ?? row[COL.nom] ?? '(ligne sans identifiant)'
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
