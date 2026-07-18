import { describe, expect, it } from 'vitest'
import { Types } from 'mongoose'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'

withTestDatabase()

const COLUMNS = ['Nom', 'Quantité']

async function makeActiveTemplate() {
  const t = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
  return String(t._id)
}

describe('diffCatalogAgainstSource', () => {
  it('détecte une cellule modifiée vs originalCsvData (diff champ)', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Vase',
      csvData: { Nom: 'Vase', Quantité: '16' },
      originalCsvData: { Nom: 'Vase', Quantité: '10' },
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].fields).toEqual([{ column: 'Quantité', from: '10', to: '16' }])
  })

  it('numérote les lignes comme le tableau maître (position triée par _id)', async () => {
    const templateId = await makeActiveTemplate()
    // 1re ligne : inchangée. 2e : modifiée. 3e : ajoutée (créée par facture).
    await CatalogProduct.create({ templateId, name: 'A', csvData: { Nom: 'A' }, originalCsvData: { Nom: 'A' } })
    await CatalogProduct.create({ templateId, name: 'B', csvData: { Nom: 'B2' }, originalCsvData: { Nom: 'B' } })
    await CatalogProduct.create({
      templateId,
      name: 'C',
      csvData: { Nom: 'C' },
      createdFromInvoiceId: new Types.ObjectId(),
    })

    const diff = await diffCatalogAgainstSource()
    // Le maître montre A(1), B(2), C(3) triés par _id : le diff reprend ces numéros.
    expect(diff.modified[0].row).toBe(2)
    expect(diff.added[0].row).toBe(3)
  })

  it('classe un produit créé par une facture en « ajouté »', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Bol',
      csvData: { Nom: 'Bol', Quantité: '4' },
      originalCsvData: { Nom: 'Bol', Quantité: '4' },
      createdFromInvoiceId: new Types.ObjectId(),
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added.map((a) => a.name)).toEqual(['Bol'])
    expect(diff.modified).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
  })

  it('classe un produit créé à la main (sans originalCsvData) en « ajouté »', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Manuel',
      csvData: { Nom: 'Manuel', Quantité: '1' },
      originalCsvData: null,
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added.map((a) => a.name)).toEqual(['Manuel'])
  })

  it('classe un produit d’origine soft-deleted en « supprimé »', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Vase',
      csvData: { Nom: 'Vase', Quantité: '10' },
      originalCsvData: { Nom: 'Vase', Quantité: '10' },
      isDeleted: true,
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.removed.map((r) => r.name)).toEqual(['Vase'])
    expect(diff.removed[0].original).toMatchObject({ Nom: 'Vase', Quantité: '10' })
    expect(diff.added).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('un article ajouté par facture puis supprimé s’annule (nulle part)', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Ephemere',
      csvData: { Nom: 'Ephemere', Quantité: '2' },
      originalCsvData: { Nom: 'Ephemere', Quantité: '2' },
      createdFromInvoiceId: new Types.ObjectId(),
      isDeleted: true,
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('ne signale pas une différence null vs chaîne vide', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Vase',
      csvData: { Nom: 'Vase', Quantité: null },
      originalCsvData: { Nom: 'Vase', Quantité: '' },
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.modified).toHaveLength(0)
  })

  it('catalogue identique à l’origine : aucun changement', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Vase',
      csvData: { Nom: 'Vase', Quantité: '10' },
      originalCsvData: { Nom: 'Vase', Quantité: '10' },
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('un renommage apparaît en « modifié » (colonne Nom), pas en supprimé+ajouté', async () => {
    const templateId = await makeActiveTemplate()
    await CatalogProduct.create({
      templateId,
      name: 'Vase rouge',
      csvData: { Nom: 'Vase rouge', Quantité: '10' },
      originalCsvData: { Nom: 'Vase', Quantité: '10' },
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].fields).toEqual([{ column: 'Nom', from: 'Vase', to: 'Vase rouge' }])
  })

  it('sans template actif, lève une erreur', async () => {
    await expect(diffCatalogAgainstSource()).rejects.toThrow(/template/i)
  })
})
