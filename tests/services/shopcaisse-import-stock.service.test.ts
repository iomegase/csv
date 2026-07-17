import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, STOCK_COLUMNS } from '@/lib/shopcaisse-columns'
import { importProductsIntoMaster, importStockIntoMaster } from '@/services/shopcaisse-import.service'
import type { ParsedCsv } from '@/services/csv-parser.service'

withTestDatabase()

function parsedStock(rows: Array<Record<string, string>>): ParsedCsv {
  return {
    columns: [...STOCK_COLUMNS],
    rows: rows.map((row) => Object.fromEntries(STOCK_COLUMNS.map((c) => [c, row[c] ?? '']))),
    delimiter: ';',
    encoding: 'utf-8',
    encodingConfident: true,
  }
}

function parsedProducts(rows: Array<Record<string, string>>): ParsedCsv {
  const columns = ['Identifiant', 'Nom', 'Référence', 'Code barre']
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? '']))),
    delimiter: ';',
    encoding: 'utf-8',
    encodingConfident: true,
  }
}

async function firstRow() {
  const product = await CatalogProduct.findOne({}).lean()
  return product!.csvData as Record<string, unknown>
}

describe('importStockIntoMaster', () => {
  it('range la Quantité importée dans Stock actuel', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Nom: 'Café', Quantité: '5' }]))

    expect(summary.updated).toBe(1)
    expect((await firstRow())[COL.stockActuel]).toBe('5')
  })

  it('ne touche pas à Stock souhaité', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: '5' }]))
    expect((await firstRow())[COL.stockSouhaite]).toBeNull()
  })

  it('recalcule le mouvement quand un stock souhaité était déjà saisi', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await CatalogProduct.updateOne({}, { $set: { [`csvData.${COL.stockSouhaite}`]: '8' } })

    await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: '5' }]))

    const row = await firstRow()
    expect(row[COL.stockActuel]).toBe('5')
    expect(row[COL.mouvementStock]).toBe('3')
  })

  it('apparie par Identifiant en priorité', async () => {
    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café', Référence: 'REF-001' }]))
    await importStockIntoMaster(parsedStock([{ Identifiant: '42', Quantité: '5' }]))
    expect((await firstRow())[COL.stockActuel]).toBe('5')
  })

  it('ne crée jamais de produit depuis le fichier stock', async () => {
    const summary = await importStockIntoMaster(parsedStock([{ Référence: 'REF-404', Nom: 'Fantôme', Quantité: '5' }]))

    expect(summary.created).toBe(0)
    expect(summary.updated).toBe(0)
    expect(summary.errors).toEqual([
      { row: 0, message: 'Produit introuvable dans le tableau maître : REF-404. Importez d’abord le fichier produits.' },
    ])
    expect(await CatalogProduct.countDocuments({})).toBe(0)
  })

  it('refuse une quantité non numérique et ne l’écrit pas', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: 'beaucoup' }]))

    expect(summary.errors).toEqual([
      { row: 0, message: 'Quantité non numérique : « beaucoup ».' },
    ])
    expect((await firstRow())[COL.stockActuel]).toBeNull()
  })

  it('laisse Stock actuel vide quand la Quantité est vide — jamais de zéro inventé', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: '' }]))
    expect((await firstRow())[COL.stockActuel]).toBeNull()
  })

  it('signale l’ambiguïté sans écrire', async () => {
    await importProductsIntoMaster(
      parsedProducts([
        { Nom: 'Café', Référence: 'REF-001', 'Code barre': '111' },
        { Nom: 'Café', Référence: 'REF-002', 'Code barre': '111' },
      ]),
    )
    const summary = await importStockIntoMaster(parsedStock([{ Nom: 'Café', Quantité: '5' }]))

    // Nom seul n'identifie rien ; sans code-barres, aucune règle ne s'applique.
    expect(summary.updated).toBe(0)
    expect(summary.errors).toHaveLength(1)
  })
})
