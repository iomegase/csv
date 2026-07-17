import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COL,
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

  it('reprend exactement les intitulés de export-produits.csv', () => {
    expect(PRODUCT_COLUMNS).toEqual(headerOf('export-produits.csv'))
  })

  it('reprend exactement les intitulés du modèle de stock', () => {
    expect(STOCK_COLUMNS).toEqual(headerOf('export-stock-modele.csv'))
  })

  it('compte 22 colonnes maître, 19 produit, 4 stock', () => {
    expect(MASTER_COLUMNS).toHaveLength(22)
    expect(PRODUCT_COLUMNS).toHaveLength(19)
    expect(STOCK_COLUMNS).toHaveLength(4)
  })

  it('n\'expose aucune colonne interne de stock dans l\'export produits', () => {
    for (const internal of STOCK_INTERNAL_COLUMNS) {
      expect(PRODUCT_COLUMNS).not.toContain(internal)
      expect(STOCK_COLUMNS).not.toContain(internal)
    }
  })

  it('n\'ajoute aucune colonne hors du maître dans les exports', () => {
    for (const column of [...PRODUCT_COLUMNS, ...STOCK_COLUMNS]) {
      if (column === COL.quantite) continue // propre au fichier stock
      expect(MASTER_COLUMNS).toContain(column)
    }
  })

  it('donne une ligne maître vide portant les 22 colonnes à null', () => {
    const row = makeEmptyMasterRow()
    expect(Object.keys(row)).toEqual([...MASTER_COLUMNS])
    expect(Object.values(row).every((value) => value === null)).toBe(true)
  })
})
