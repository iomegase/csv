import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { countCatalogValues } from '@/services/catalog-facets.service'

withTestDatabase()

async function seed(values: Array<{ Famille?: string | null; isDeleted?: boolean }>) {
  const templateId = await ensureMasterTemplate()
  for (const { Famille, isDeleted } of values) {
    await CatalogProduct.create({ templateId, csvData: { Famille: Famille ?? null }, isDeleted: isDeleted ?? false })
  }
}

describe('countCatalogValues', () => {
  it('regroupe les produits d’une même valeur et les compte', async () => {
    await seed([{ Famille: 'Boissons' }, { Famille: 'Boissons' }, { Famille: 'Épicerie' }])

    expect(await countCatalogValues('Famille')).toEqual([
      { value: 'Boissons', count: 2 },
      { value: 'Épicerie', count: 1 },
    ])
  })

  it('exclut les valeurs vides, nulles ou faites d’espaces', async () => {
    await seed([{ Famille: 'Boissons' }, { Famille: '' }, { Famille: null }, { Famille: '   ' }])

    expect(await countCatalogValues('Famille')).toEqual([{ value: 'Boissons', count: 1 }])
  })

  it('trie par ordre alphabétique français', async () => {
    await seed([{ Famille: 'Zeste' }, { Famille: 'Ananas' }, { Famille: 'épices' }])

    expect((await countCatalogValues('Famille')).map((e) => e.value)).toEqual(['Ananas', 'épices', 'Zeste'])
  })

  it('compte aussi les lignes marquées supprimées', async () => {
    await seed([{ Famille: 'Boissons' }, { Famille: 'Boissons', isDeleted: true }])

    expect(await countCatalogValues('Famille')).toEqual([{ value: 'Boissons', count: 2 }])
  })

  it('rend un tableau vide sur un catalogue vide', async () => {
    expect(await countCatalogValues('Famille')).toEqual([])
  })
})
