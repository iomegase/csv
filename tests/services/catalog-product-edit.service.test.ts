import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import {
  createCatalogProduct,
  listAllCatalogProducts,
  softDeleteCatalogProduct,
  updateCatalogProductCells,
} from '@/services/catalog-product.service'
import { COL } from '@/lib/shopcaisse-columns'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'

withTestDatabase()

async function makeTemplateId() {
  const t = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: ['Nom', 'Quantité'].map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
  return String(t._id)
}

describe('mutations catalogue', () => {
  it('met à jour des cellules et vide une cellule en null', async () => {
    const templateId = await makeTemplateId()
    const p = await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '3' } })

    await updateCatalogProductCells(String(p._id), { Quantité: '9', Nom: '' })

    const after = await CatalogProduct.findById(p._id).lean()
    expect(after!.csvData).toMatchObject({ Quantité: '9', Nom: null })
  })

  it('crée un article et le liste', async () => {
    const templateId = await makeTemplateId()
    const id = await createCatalogProduct(templateId, { Nom: 'Bol', Quantité: '4' })

    expect(id).toBeTruthy()
    const all = await listAllCatalogProducts()
    expect(all).toHaveLength(1)
    expect(all[0].csvData).toMatchObject({ Nom: 'Bol', Quantité: '4' })
  })

  it('supprime en douceur (isDeleted) mais garde la ligne dans le maître', async () => {
    const templateId = await makeTemplateId()
    const p = await CatalogProduct.create({ templateId, name: 'X', csvData: { Nom: 'X' } })

    await softDeleteCatalogProduct(String(p._id))

    // La ligne reste visible : le maître montre tout, la suppression étant
    // portée par la colonne Supprimé / isDeleted (décision L5-3).
    expect((await CatalogProduct.findById(p._id).lean())!.isDeleted).toBe(true)
    expect(await listAllCatalogProducts()).toHaveLength(1)
  })

  it('rejette un identifiant invalide', async () => {
    await expect(updateCatalogProductCells('nope', { Nom: 'x' })).rejects.toThrow(/invalide/)
    await expect(softDeleteCatalogProduct('nope')).rejects.toThrow(/invalide/)
  })
})

describe('updateCatalogProductCells — règles du tableau maître', () => {
  async function makeMasterProduct(values: Partial<Record<string, string>> = {}) {
    const templateId = await ensureMasterTemplate()
    const product = await CatalogProduct.create({
      templateId,
      csvData: { [COL.identifiant]: '42', [COL.nom]: 'Café', [COL.supprime]: '0', ...values },
    })
    return String(product._id)
  }

  async function readRow(id: string) {
    const product = await CatalogProduct.findById(id).lean()
    return product!.csvData as Record<string, unknown>
  }

  it('recalcule Mouvement stock quand Stock souhaité change', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5' })
    await updateCatalogProductCells(id, { [COL.stockSouhaite]: '8' })
    expect((await readRow(id))[COL.mouvementStock]).toBe('3')
  })

  it('recalcule Mouvement stock quand Stock actuel change', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5', [COL.stockSouhaite]: '8', [COL.mouvementStock]: '3' })
    await updateCatalogProductCells(id, { [COL.stockActuel]: '11' })
    expect((await readRow(id))[COL.mouvementStock]).toBe('-3')
  })

  it('vide Mouvement stock quand un des deux stocks est effacé', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5', [COL.stockSouhaite]: '8', [COL.mouvementStock]: '3' })
    await updateCatalogProductCells(id, { [COL.stockSouhaite]: null })
    expect((await readRow(id))[COL.mouvementStock]).toBeNull()
  })

  it('refuse une valeur de stock non numérique et n’écrit rien', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5' })
    await expect(updateCatalogProductCells(id, { [COL.stockSouhaite]: 'huit' })).rejects.toThrow(
      'Stock souhaité non numérique : « huit ».',
    )
    expect((await readRow(id))[COL.stockSouhaite]).toBeUndefined()
  })

  it('refuse d’écrire dans Identifiant', async () => {
    const id = await makeMasterProduct()
    await expect(updateCatalogProductCells(id, { [COL.identifiant]: '99' })).rejects.toThrow(
      'Colonne en lecture seule : Identifiant.',
    )
  })

  it('refuse d’écrire dans Mouvement stock', async () => {
    const id = await makeMasterProduct()
    await expect(updateCatalogProductCells(id, { [COL.mouvementStock]: '99' })).rejects.toThrow(
      'Colonne en lecture seule : Mouvement stock.',
    )
  })

  it('normalise Supprimé et le reporte dans isDeleted', async () => {
    const id = await makeMasterProduct()
    await updateCatalogProductCells(id, { [COL.supprime]: 'Oui' })

    expect((await readRow(id))[COL.supprime]).toBe('1')
    expect((await CatalogProduct.findById(id).lean())!.isDeleted).toBe(true)
  })

  it('remet isDeleted à false quand on repasse Supprimé à Non', async () => {
    const id = await makeMasterProduct({ [COL.supprime]: '1' })
    await updateCatalogProductCells(id, { [COL.supprime]: 'Non' })

    expect((await readRow(id))[COL.supprime]).toBe('0')
    expect((await CatalogProduct.findById(id).lean())!.isDeleted).toBe(false)
  })

  it('laisse éditer librement une colonne produit', async () => {
    const id = await makeMasterProduct()
    await updateCatalogProductCells(id, { [COL.nom]: 'Café Latte', [COL.famille]: 'Boissons' })
    const row = await readRow(id)
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.famille]).toBe('Boissons')
  })
})
