import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MASTER_COLUMNS,
  PRODUCT_COLUMNS,
  STOCK_COLUMNS,
  STOCK_INTERNAL_COLUMNS,
  makeEmptyMasterRow,
} from '@/lib/shopcaisse-columns'

const FIXTURES = join(process.cwd(), 'tests/fixtures/shopcaisse')

/** En-tête réel du fichier, BOM retiré, sans dépendre du parseur. */
function headerOf(fileName: string): string[] {
  const text = readFileSync(join(FIXTURES, fileName), 'utf-8').replace(/^﻿/, '')
  return text.split(/\r?\n/)[0].split(';')
}

describe('shopcaisse-columns', () => {
  it('reprend exactement les intitulés du fichier maître d\'exemple', () => {
    expect(MASTER_COLUMNS).toEqual(headerOf('fichier-maitre.csv'))
  })

  it('reprend exactement les intitulés du fichier Produits fourni', () => {
    expect(PRODUCT_COLUMNS).toEqual(headerOf('produits-reference-20260719.csv'))
  })

  it('reprend exactement les intitulés du fichier Visualisation des stocks fourni', () => {
    expect(STOCK_COLUMNS).toEqual(headerOf('stocks-reference-20260719.csv'))
  })

  it('compte 22 colonnes maître, 19 produit, 13 stock', () => {
    expect(MASTER_COLUMNS).toHaveLength(22)
    expect(PRODUCT_COLUMNS).toHaveLength(19)
    expect(STOCK_COLUMNS).toHaveLength(13)
  })

  it('n\'expose aucune colonne interne de stock dans l\'export produits', () => {
    for (const internal of STOCK_INTERNAL_COLUMNS) {
      expect(PRODUCT_COLUMNS).not.toContain(internal)
      expect(STOCK_COLUMNS).not.toContain(internal)
    }
  })

  it('n\'ajoute aucune colonne produit hors du maître', () => {
    for (const column of PRODUCT_COLUMNS) {
      expect(MASTER_COLUMNS).toContain(column)
    }
  })

  it('donne une ligne maître vide portant les 22 colonnes à null', () => {
    const row = makeEmptyMasterRow()
    expect(Object.keys(row)).toEqual([...MASTER_COLUMNS])
    expect(Object.values(row).every((value) => value === null)).toBe(true)
  })
})
