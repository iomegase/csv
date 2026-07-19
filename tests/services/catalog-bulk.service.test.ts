import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL } from '@/lib/shopcaisse-columns'
import { bulkUpdateProducts } from '@/services/catalog-product.service'

withTestDatabase()

async function seed(csvData: Record<string, string>) {
  const template = await CsvTemplate.findOne({}) ?? (await CsvTemplate.create({ name: 'T', sourceFileName: 't.csv', isActive: true, columns: [] }))
  const p = await CatalogProduct.create({ templateId: template._id, csvData })
  return String(p._id)
}

async function row(id: string) {
  const p = await CatalogProduct.findById(id).lean()
  return p!.csvData as Record<string, unknown>
}

describe('bulkUpdateProducts', () => {
  it('assigne une famille à toute la sélection, sans toucher aux autres', async () => {
    const a = await seed({ Nom: 'Bague' })
    const b = await seed({ Nom: 'Collier' })
    const c = await seed({ Nom: 'Vase' })

    const res = await bulkUpdateProducts([a, b], { type: 'family', value: 'Bijoux' })

    expect(res.updated).toBe(2)
    expect((await row(a))[COL.famille]).toBe('Bijoux')
    expect((await row(b))[COL.famille]).toBe('Bijoux')
    expect((await row(c))[COL.famille]).toBeUndefined()
  })

  it('assigne un fournisseur à la sélection', async () => {
    const a = await seed({ Nom: 'Bague' })
    await bulkUpdateProducts([a], { type: 'supplier', value: 'New Heidi' })
    expect((await row(a))[COL.fournisseur]).toBe('New Heidi')
  })

  it('calcule le prix TTC à partir du HT et du coefficient', async () => {
    const a = await seed({ Nom: 'Bague', [COL.prixAchat]: '2,50' })
    await bulkUpdateProducts([a], { type: 'ttcFromHt', coefficient: 2 })
    expect((await row(a))[COL.prixTtc]).toBe('5.00')
  })

  it('ignore un produit sans prix d’achat pour le calcul TTC', async () => {
    const a = await seed({ Nom: 'Sans HT' })
    const res = await bulkUpdateProducts([a], { type: 'ttcFromHt', coefficient: 2 })
    expect(res.updated).toBe(0)
    expect((await row(a))[COL.prixTtc]).toBeUndefined()
  })
})
