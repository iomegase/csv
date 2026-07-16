import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getCatalogColumnKeys, listCatalogProducts } from '@/services/catalog-product.service'

withTestDatabase()

async function seed(count: number) {
  const template = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    isActive: true,
    columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
  })

  await CatalogProduct.insertMany(
    Array.from({ length: count }, (_, index) => ({
      templateId: template._id,
      name: `Produit ${index}`,
      csvData: { Nom: `Produit ${index}` },
    })),
  )
}

describe('listCatalogProducts', () => {
  it('pagine', async () => {
    await seed(30)
    const result = await listCatalogProducts({ page: 2, pageSize: 10 })

    expect(result.products).toHaveLength(10)
    expect(result.total).toBe(30)
    expect(result.page).toBe(2)
  })

  it('exclut les produits supprimés', async () => {
    await seed(3)
    await CatalogProduct.updateOne({}, { $set: { isDeleted: true } })

    expect((await listCatalogProducts({ page: 1, pageSize: 10 })).total).toBe(2)
  })
})

describe('getCatalogColumnKeys', () => {
  it('rend les clés réellement présentes dans csvData', async () => {
    await seed(1)
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      csvData: { Nom: 'X', 'Code barre': '370' },
    })

    expect((await getCatalogColumnKeys()).sort()).toEqual(['Code barre', 'Nom'])
  })

  it('rend un tableau vide sur un catalogue vide', async () => {
    expect(await getCatalogColumnKeys()).toEqual([])
  })
})
