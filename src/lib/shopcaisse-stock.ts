import { COL } from '@/lib/shopcaisse-columns'

export type StockCell =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'invalid'; raw: string }

export type Movement =
  | { kind: 'empty' }
  | { kind: 'value'; value: number; text: string }
  | { kind: 'invalid'; column: string; raw: string }

/** Un nombre entier ou décimal, point ou virgule, signe optionnel. Rien d'autre. */
const STOCK_PATTERN = /^-?\d+(?:[.,]\d+)?$/

/**
 * Lit une cellule de stock.
 *
 * Volontairement strict, contrairement à `parseLocalizedNumber` : celle-ci
 * nettoie les caractères parasites et lirait « 5x » comme 5. Sur une quantité,
 * ce serait inventer une valeur là où la consigne demande une erreur.
 */
export function readStockCell(value: unknown): StockCell {
  if (value === null || value === undefined) return { kind: 'empty' }

  const raw = String(value)
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'empty' }

  if (!STOCK_PATTERN.test(trimmed)) return { kind: 'invalid', raw }

  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed)) return { kind: 'invalid', raw }

  return { kind: 'number', value: parsed }
}

/**
 * Mouvement stock = Stock souhaité − Stock actuel.
 *
 * Vide dès qu'une des deux valeurs manque : sans les deux, la différence
 * n'existe pas, et la remplacer par 0 affirmerait « aucun mouvement » alors
 * qu'on ne sait rien.
 */
export function computeMovement(current: unknown, target: unknown): Movement {
  const currentCell = readStockCell(current)
  if (currentCell.kind === 'invalid') {
    return { kind: 'invalid', column: COL.stockActuel, raw: currentCell.raw }
  }

  const targetCell = readStockCell(target)
  if (targetCell.kind === 'invalid') {
    return { kind: 'invalid', column: COL.stockSouhaite, raw: targetCell.raw }
  }

  if (currentCell.kind === 'empty' || targetCell.kind === 'empty') return { kind: 'empty' }

  const value = roundQuantity(targetCell.value - currentCell.value)
  return { kind: 'value', value, text: formatStockNumber(value) }
}

/**
 * 8.1 − 5.2 vaut 2.9000000000000004 en flottant. Trois décimales couvrent
 * largement une quantité de stock et coupent ce bruit avant qu'il n'atteigne
 * le CSV.
 */
function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Pas de décimales inutiles : ShopCaisse accepte « 3 » aussi bien que « 3.00 ». */
export function formatStockNumber(value: number): string {
  return String(roundQuantity(value))
}
