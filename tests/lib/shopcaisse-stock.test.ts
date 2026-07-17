import { describe, expect, it } from 'vitest'
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement, formatStockNumber, readStockCell } from '@/lib/shopcaisse-stock'

describe('readStockCell', () => {
  it('lit un entier', () => {
    expect(readStockCell('5')).toEqual({ kind: 'number', value: 5 })
  })

  it('lit un décimal à point comme à virgule', () => {
    expect(readStockCell('2.00')).toEqual({ kind: 'number', value: 2 })
    expect(readStockCell('2,5')).toEqual({ kind: 'number', value: 2.5 })
  })

  it('lit un négatif', () => {
    expect(readStockCell('-3')).toEqual({ kind: 'number', value: -3 })
  })

  it("traite le vide, null et undefined comme vide — jamais comme zéro", () => {
    expect(readStockCell('')).toEqual({ kind: 'empty' })
    expect(readStockCell('   ')).toEqual({ kind: 'empty' })
    expect(readStockCell(null)).toEqual({ kind: 'empty' })
    expect(readStockCell(undefined)).toEqual({ kind: 'empty' })
  })

  it('lit zéro comme la valeur 0, et non comme du vide', () => {
    expect(readStockCell('0')).toEqual({ kind: 'number', value: 0 })
  })

  it('refuse une valeur non numérique', () => {
    expect(readStockCell('abc')).toEqual({ kind: 'invalid', raw: 'abc' })
    expect(readStockCell('5x')).toEqual({ kind: 'invalid', raw: '5x' })
    expect(readStockCell('12 pièces')).toEqual({ kind: 'invalid', raw: '12 pièces' })
  })
})

describe('computeMovement', () => {
  it('calcule un mouvement positif : 5 → 8 donne 3', () => {
    expect(computeMovement('5', '8')).toEqual({ kind: 'value', value: 3, text: '3' })
  })

  it('calcule un mouvement négatif : 8 → 5 donne -3', () => {
    expect(computeMovement('8', '5')).toEqual({ kind: 'value', value: -3, text: '-3' })
  })

  it('calcule un mouvement nul : 8 → 8 donne 0', () => {
    expect(computeMovement('8', '8')).toEqual({ kind: 'value', value: 0, text: '0' })
  })

  it('laisse le mouvement vide quand le stock actuel est vide', () => {
    expect(computeMovement('', '8')).toEqual({ kind: 'empty' })
  })

  it('laisse le mouvement vide quand le stock souhaité est vide', () => {
    expect(computeMovement('5', '')).toEqual({ kind: 'empty' })
  })

  it('laisse le mouvement vide quand les deux sont vides', () => {
    expect(computeMovement(null, null)).toEqual({ kind: 'empty' })
  })

  it("signale la colonne fautive quand une valeur n'est pas numérique", () => {
    expect(computeMovement('abc', '8')).toEqual({
      kind: 'invalid',
      column: COL.stockActuel,
      raw: 'abc',
    })
    expect(computeMovement('5', 'huit')).toEqual({
      kind: 'invalid',
      column: COL.stockSouhaite,
      raw: 'huit',
    })
  })

  it("ne laisse pas l'imprécision flottante fuiter dans le CSV", () => {
    expect(computeMovement('5.2', '8.1')).toEqual({ kind: 'value', value: 2.9, text: '2.9' })
  })
})

describe('formatStockNumber', () => {
  it("n'ajoute pas de décimales inutiles", () => {
    expect(formatStockNumber(3)).toBe('3')
    expect(formatStockNumber(0)).toBe('0')
    expect(formatStockNumber(-3)).toBe('-3')
    expect(formatStockNumber(2.5)).toBe('2.5')
  })
})
