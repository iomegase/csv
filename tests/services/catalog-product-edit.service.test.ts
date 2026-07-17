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

  it('supprime en douceur (isDeleted) et exclut de la liste', async () => {
    const templateId = await makeTemplateId()
    const p = await CatalogProduct.create({ templateId, name: 'X', csvData: { Nom: 'X' } })

    await softDeleteCatalogProduct(String(p._id))

    expect((await CatalogProduct.findById(p._id).lean())!.isDeleted).toBe(true)
    expect(await listAllCatalogProducts()).toHaveLength(0)
  })

  it('rejette un identifiant invalide', async () => {
    await expect(updateCatalogProductCells('nope', { Nom: 'x' })).rejects.toThrow(/invalide/)
    await expect(softDeleteCatalogProduct('nope')).rejects.toThrow(/invalide/)
  })
})
