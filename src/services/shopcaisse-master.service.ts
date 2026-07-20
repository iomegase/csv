import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { normalizeHeader } from '@/lib/product-views'
import {
  COL,
  MASTER_COLUMNS,
  isMasterColumn,
  makeEmptyMasterRow,
  toStockVisualisationRow,
  type MasterRow,
  type StockVisualisationRow,
} from '@/lib/shopcaisse-columns'
import { computeMovement } from '@/lib/shopcaisse-stock'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvTemplate } from '@/models/CsvTemplate'
import { activateTemplate } from '@/services/csv-template.service'

export const MASTER_TEMPLATE_NAME = 'Tableau maître ShopCaisse'

export interface MasterEntry {
  id: string
  row: MasterRow
  stockRow?: StockVisualisationRow | null
}

const TRUTHY_SUPPRIME = new Set(['1', 'oui', 'true', 'vrai'])

/**
 * `Supprimé` est le seul champ où un vide devient 0.
 *
 * La règle est explicite dans la consigne (§5) : ShopCaisse n'accepte que du
 * binaire dans cette colonne, et « ni Oui ni Non » n'existe pas — un produit
 * qu'on n'a pas marqué est un produit qu'on conserve.
 */
export function normalizeSupprime(value: unknown): '0' | '1' {
  if (value === null || value === undefined) return '0'
  return TRUTHY_SUPPRIME.has(String(value).trim().toLocaleLowerCase('fr')) ? '1' : '0'
}

/** Index des colonnes maître par intitulé normalisé, construit une seule fois. */
const MASTER_BY_NORMALIZED = new Map(
  MASTER_COLUMNS.map((column) => [normalizeHeader(column), column]),
)

/**
 * Range des valeurs quelconques dans les 22 colonnes maître.
 *
 * L'appariement se fait d'abord par intitulé exact — c'est le contrat
 * ShopCaisse —, puis par intitulé normalisé, ce qui rattrape un ancien
 * catalogue dont les en-têtes divergeaient par la casse ou les accents. Une
 * colonne inconnue du maître est écartée : elle n'a pas de place dans le
 * schéma figé, et l'inventer casserait les exports.
 */
export function toMasterRow(source: Record<string, unknown>): MasterRow {
  const row = makeEmptyMasterRow()

  for (const [key, value] of Object.entries(source)) {
    const column = isMasterColumn(key) ? key : MASTER_BY_NORMALIZED.get(normalizeHeader(key))
    if (!column) continue
    row[column] = emptyToNull(value)
  }

  row[COL.supprime] = normalizeSupprime(row[COL.supprime])
  return row
}

/** Une valeur absente vaut null, jamais 0 ni « N/A ». */
function emptyToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text === '' ? null : text
}

/**
 * Recalcule `Mouvement stock`.
 *
 * Une valeur illisible laisse le mouvement vide plutôt que de jeter : le
 * signalement à l'utilisateur est le travail de la validation avant export,
 * qui voit toute la ligne et peut la nommer.
 */
export function withMovement(row: MasterRow): MasterRow {
  const movement = computeMovement(row[COL.stockActuel], row[COL.stockSouhaite])
  return { ...row, [COL.mouvementStock]: movement.kind === 'value' ? movement.text : null }
}

/**
 * Garantit un template actif portant exactement le schéma maître.
 *
 * La migration précède l'activation, comme dans `from-import` : le contrôle de
 * colonnes d'`activateTemplate` compare aux clés réellement présentes dans le
 * catalogue, qui doivent donc déjà porter les 22 colonnes.
 */
export async function ensureMasterTemplate(): Promise<string> {
  await connectToDatabase()

  const active = await CsvTemplate.findOne({ isActive: true }).lean()
  if (active && isMasterTemplate(active.columns.map((column) => column.name))) {
    await migrateCatalogToMaster(String(active._id))
    return String(active._id)
  }

  const template = await CsvTemplate.create({
    name: MASTER_TEMPLATE_NAME,
    sourceFileName: 'export-produits.csv',
    columns: MASTER_COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    encoding: 'utf-8',
    isActive: false,
  })

  const templateId = String(template._id)
  await migrateCatalogToMaster(templateId)
  await activateTemplate(templateId)

  return templateId
}

function isMasterTemplate(columns: string[]): boolean {
  return columns.length === MASTER_COLUMNS.length && columns.every((name, i) => name === MASTER_COLUMNS[i])
}

/**
 * Réécrit chaque produit dans le schéma maître, sans perte.
 *
 * `originalCsvData` migre avec `csvData` : les comparer sur des schémas
 * différents ferait apparaître tout le catalogue comme modifié.
 */
async function migrateCatalogToMaster(templateId: string): Promise<void> {
  const products = await CatalogProduct.find({}).select('csvData originalCsvData isDeleted').lean()

  const operations = products.map((product) => {
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    const original = product.originalCsvData as Record<string, unknown> | null

    const row = withMovement(toMasterRow(csvData))
    // Le champ isDeleted portait la suppression avant l'introduction de la
    // colonne : il fait foi quand la colonne est absente.
    if (product.isDeleted) row[COL.supprime] = '1'

    return {
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            templateId: new Types.ObjectId(templateId),
            csvData: row,
            originalCsvData: original ? withMovement(toMasterRow(original)) : null,
            isDeleted: row[COL.supprime] === '1',
          },
        },
      },
    }
  })

  if (operations.length) await CatalogProduct.bulkWrite(operations, { ordered: false })
}

/**
 * Toutes les lignes maître, supprimées comprises.
 *
 * L'ordre `_id` croissant est l'ordre de création, et c'est lui qui garantit
 * que les deux exports décrivent le même produit à chaque index.
 */
export async function listMasterEntries(): Promise<MasterEntry[]> {
  await connectToDatabase()

  const products = await CatalogProduct.find({}).sort({ _id: 1 }).select('csvData shopcaisseStockData').lean()

  return products.map((product) => ({
    id: String(product._id),
    row: toMasterRow((product.csvData ?? {}) as Record<string, unknown>),
    stockRow: product.shopcaisseStockData
      ? toStockVisualisationRow(product.shopcaisseStockData as Record<string, unknown>)
      : null,
  }))
}
