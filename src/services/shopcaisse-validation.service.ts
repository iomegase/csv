import { COL, type MasterRow } from '@/lib/shopcaisse-columns'
import { findConflicts, type IdentityRule } from '@/lib/shopcaisse-identity'
import { readStockCell } from '@/lib/shopcaisse-stock'
import {
  buildProductRows,
  buildStockRows,
  checkAlignment,
  type AlignmentIssue,
} from '@/services/shopcaisse-export.service'
import { listMasterEntries, type MasterEntry } from '@/services/shopcaisse-master.service'

export interface ExportSummary {
  total: number
  existing: number
  newWithoutId: number
  deleted: number
  movementsPositive: number
  movementsNegative: number
  movementsZero: number
  movementsEmpty: number
  duplicates: number
  ambiguous: number
  productRowCount: number
  stockRowCount: number
  sameRowCount: boolean
  alignment: 'Conforme' | 'Erreur'
}

export interface RowIssue {
  /** Numéro de ligne 1-based du tableau maître, tel qu'il s'affiche à l'écran. */
  row: number
  id: string
  identifiant: string | null
  reference: string | null
  nom: string | null
  reason: string
  /** Règle d'identification qui a détecté le conflit ; null hors conflit. */
  rule: IdentityRule | null
  relatedRows: number[]
}

export interface MasterValidation {
  summary: ExportSummary
  blockers: RowIssue[]
  conflicts: RowIssue[]
  alignmentIssues: AlignmentIssue[]
  canExport: boolean
}

export async function validateMaster(): Promise<MasterValidation> {
  return validateMasterEntries(await listMasterEntries())
}

/**
 * Contrôle le tableau maître avant export.
 *
 * Pur et séparé de la lecture en base : c'est la partie qui porte les règles
 * métier, et elle doit pouvoir se tester ligne par ligne sans Mongo.
 */
export function validateMasterEntries(entries: MasterEntry[]): MasterValidation {
  const productRows = buildProductRows(entries)
  const stockRows = buildStockRows(entries)
  const alignmentIssues = checkAlignment(productRows, stockRows)

  const blockers = entries.flatMap((entry, index) => rowBlockers(entry, index))
  const conflicts = collectConflicts(entries)

  const summary: ExportSummary = {
    ...countRows(entries),
    duplicates: conflicts.filter((issue) => issue.rule === 'Identifiant' || issue.rule === 'Référence').length,
    ambiguous: conflicts.filter((issue) => issue.rule === 'Nom + Code barre').length,
    productRowCount: productRows.length,
    stockRowCount: stockRows.length,
    sameRowCount: productRows.length === stockRows.length,
    alignment: alignmentIssues.length ? 'Erreur' : 'Conforme',
  }

  return {
    summary,
    blockers,
    conflicts,
    alignmentIssues,
    canExport: !blockers.length && !conflicts.length && !alignmentIssues.length,
  }
}

function countRows(entries: MasterEntry[]) {
  const counts = {
    total: entries.length,
    existing: 0,
    newWithoutId: 0,
    deleted: 0,
    movementsPositive: 0,
    movementsNegative: 0,
    movementsZero: 0,
    movementsEmpty: 0,
  }

  for (const { row } of entries) {
    // Le compteur reste sur l'axe « sans Identifiant » — c'est ce que son nom
    // annonce — indépendamment du fait qu'un tel produit soit « nouveau » ou non.
    if (isBlank(row[COL.identifiant])) counts.newWithoutId += 1
    else counts.existing += 1
    if (row[COL.supprime] === '1') counts.deleted += 1

    const movement = readStockCell(row[COL.mouvementStock])
    if (movement.kind !== 'number') counts.movementsEmpty += 1
    else if (movement.value > 0) counts.movementsPositive += 1
    else if (movement.value < 0) counts.movementsNegative += 1
    else counts.movementsZero += 1
  }

  return counts
}

function isBlank(value: unknown): boolean {
  return !String(value ?? '').trim()
}

/**
 * Un produit est « nouveau » — inconnu de ShopCaisse — s'il n'a ni Identifiant
 * ni Référence. Un export ShopCaisse porte presque toujours une Référence même
 * quand l'Identifiant est vide (cf. export-produits.csv) : cette ligne-là est
 * donc déjà connue, et n'a pas à fournir de stock souhaité pour s'exporter.
 * Seul un produit sans aucune de ces deux clés doit être complété à la main.
 */
function isNewProduct(row: MasterRow): boolean {
  return isBlank(row[COL.identifiant]) && isBlank(row[COL.reference])
}

function rowBlockers(entry: MasterEntry, index: number): RowIssue[] {
  const { row } = entry
  const issues: string[] = []

  for (const column of [COL.stockActuel, COL.stockSouhaite]) {
    const cell = readStockCell(row[column])
    if (cell.kind === 'invalid') issues.push(`${column} non numérique : « ${cell.raw} ».`)
  }

  if (isNewProduct(row)) {
    if (!String(row[COL.nom] ?? '').trim()) issues.push('Nom obligatoire pour un nouveau produit.')
    if (!String(row[COL.reference] ?? '').trim()) {
      issues.push('Référence obligatoire pour un nouveau produit.')
    }

    // §4 : un produit qui n'existe pas encore côté caisse n'a d'intérêt à
    // l'import que s'il apporte du stock. Un mouvement nul ou négatif sur un
    // produit inconnu de ShopCaisse ne veut rien dire.
    const target = readStockCell(row[COL.stockSouhaite])
    if (target.kind !== 'number' || target.value <= 0) {
      issues.push('Stock souhaité obligatoire et strictement positif pour un nouveau produit.')
    }
  }

  return issues.map((reason) => ({ ...describe(entry, index), reason, rule: null, relatedRows: [] }))
}

function collectConflicts(entries: MasterEntry[]): RowIssue[] {
  return findConflicts(entries.map((entry) => entry.row)).map((conflict) => ({
    ...describe(entries[conflict.row], conflict.row),
    rule: conflict.rule,
    reason: `${conflict.rule} en conflit : « ${conflict.value} » désigne aussi la ou les lignes ${conflict.relatedRows
      .map((row) => row + 1)
      .join(', ')}. Résolvez le conflit à la main avant l’export.`,
    relatedRows: conflict.relatedRows.map((row) => row + 1),
  }))
}

function describe(entry: MasterEntry, index: number) {
  return {
    row: index + 1,
    id: entry.id,
    identifiant: entry.row[COL.identifiant] ?? null,
    reference: entry.row[COL.reference] ?? null,
    nom: entry.row[COL.nom] ?? null,
  }
}
