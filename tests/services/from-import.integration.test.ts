import { describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { withTestDatabase } from '../helpers/db'
import { createCsvImport } from '@/services/csv-import.service'
import { createTemplateFromImport, activateTemplate } from '@/services/csv-template.service'
import { syncCatalogFromCsv } from '@/services/catalog-sync.service'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvImport } from '@/models/CsvImport'

withTestDatabase()

const CSV =
  'Identifiant;Nom;Famille;Fournisseur;Référence;Code barre\r\nA1;Vase;Objets déco;Fournisseur A;VASE-001;370\r\n'

describe('chaîne complète import → template → catalogue', () => {
  it('crée le template actif et alimente le catalogue', async () => {
    const imported = await createCsvImport({
      buffer: Buffer.from(CSV, 'utf-8'),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    const { templateId, parsed } = await createTemplateFromImport(imported.importId)
    const summary = await syncCatalogFromCsv(templateId, parsed)
    await activateTemplate(templateId, { force: true })

    const template = await CsvTemplate.findById(templateId).lean()

    // Les colonnes et leur ordre sont conservés à l'identique (spec 3).
    expect(template!.columns.map((c) => c.name)).toEqual([
      'Identifiant',
      'Nom',
      'Famille',
      'Fournisseur',
      'Référence',
      'Code barre',
    ])
    expect(template!.columns.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5])
    expect(template!.delimiter).toBe(';')
    expect(template!.isActive).toBe(true)

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.csvData).toMatchObject({ Nom: 'Vase', Famille: 'Objets déco' })

    const doc = await CsvImport.findById(imported.importId)
    await rm(doc!.filePath, { force: true })
  })

  it('un seul template reste actif après plusieurs imports', async () => {
    for (const _ of [1, 2, 3]) {
      const imported = await createCsvImport({
        buffer: Buffer.from(CSV, 'utf-8'),
        originalFileName: 'produits.csv',
        mimeType: 'text/csv',
      })
      const { templateId, parsed } = await createTemplateFromImport(imported.importId)
      await syncCatalogFromCsv(templateId, parsed)
      await activateTemplate(templateId, { force: true })
      const doc = await CsvImport.findById(imported.importId)
      await rm(doc!.filePath, { force: true })
    }

    expect(await CsvTemplate.countDocuments({ isActive: true })).toBe(1)
    expect(await CsvTemplate.countDocuments({})).toBe(3)
    // Un seul produit : les trois imports décrivent le même (D1).
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })
})
