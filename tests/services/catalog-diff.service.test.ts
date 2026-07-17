import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CsvImport } from '@/models/CsvImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'

withTestDatabase()

const COLUMNS = ['Nom', 'Quantité']

async function setup(originalRows: string[][], apply: (templateId: string) => Promise<void>) {
  const header = COLUMNS.join(';')
  const body = originalRows.map((r) => r.join(';')).join('\r\n')
  const csv = `${header}\r\n${body}\r\n`
  const csvImport = await CsvImport.create({
    originalFileName: 't.csv',
    rawContent: Buffer.from(csv, 'utf-8'),
    fileSize: csv.length,
    mimeType: 'text/csv',
    encoding: 'utf-8',
    delimiter: ';',
    columns: COLUMNS,
    rowCount: originalRows.length,
  })
  const template = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    sourceImportId: csvImport._id,
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
  await apply(String(template._id))
}

describe('diffCatalogAgainstSource', () => {
  it('détecte une quantité modifiée (diff champ)', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '16' } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].fields).toEqual([{ column: 'Quantité', from: '10', to: '16' }])
  })

  it('détecte un article ajouté (absent de l’original)', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' } })
      await CatalogProduct.create({ templateId, name: 'Bol', csvData: { Nom: 'Bol', Quantité: '4' } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added.map((a) => a.name)).toEqual(['Bol'])
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('détecte un article supprimé (soft delete ⇒ retiré de la copie de travail)', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' }, isDeleted: true })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.removed.map((r) => r.name)).toEqual(['Vase'])
    expect(diff.added).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('un article absent de l’original ET soft-deleted n’apparaît nulle part', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' } })
      await CatalogProduct.create({ templateId, name: 'Bol', csvData: { Nom: 'Bol', Quantité: '4' }, isDeleted: true })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('ne signale pas une différence null vs chaîne vide', async () => {
    await setup([['Vase', '']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: null } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.modified).toHaveLength(0)
  })

  it('catalogue identique à l’original : aucun changement', async () => {
    await setup([['Vase', '10'], ['Bol', '4']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' } })
      await CatalogProduct.create({ templateId, name: 'Bol', csvData: { Nom: 'Bol', Quantité: '4' } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('sans template actif, lève une erreur', async () => {
    await expect(diffCatalogAgainstSource()).rejects.toThrow(/template/i)
  })
})
