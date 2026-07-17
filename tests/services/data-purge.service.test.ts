import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvImport } from '@/models/CsvImport'
import { CsvTemplate } from '@/models/CsvTemplate'
import { InvoiceImport } from '@/models/InvoiceImport'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { purgeAllData } from '@/services/data-purge.service'

withTestDatabase()

async function seedEverything() {
  const templateId = await ensureMasterTemplate()
  await CatalogProduct.create({ templateId, csvData: { Nom: 'Café' } })
  await CatalogProduct.create({ templateId, csvData: { Nom: 'Thé' } })
  await CsvImport.create({
    originalFileName: 'x.csv',
    rawContent: Buffer.from('a;b'),
    fileSize: 3,
    mimeType: 'text/csv',
    encoding: 'utf-8',
    delimiter: ';',
    columns: [],
    rowCount: 1,
  })
  await InvoiceImport.create({ originalFileName: 'f.pdf', pdfContent: Buffer.from('%PDF'), fileSize: 4 })
}

describe('purgeAllData', () => {
  it('vide les quatre collections et renvoie les décomptes', async () => {
    await seedEverything()

    const { deleted } = await purgeAllData()

    expect(deleted).toEqual({ catalogProducts: 2, csvImports: 1, csvTemplates: 1, invoices: 1 })
    expect(await CatalogProduct.countDocuments({})).toBe(0)
    expect(await CsvImport.countDocuments({})).toBe(0)
    expect(await CsvTemplate.countDocuments({})).toBe(0)
    expect(await InvoiceImport.countDocuments({})).toBe(0)
  })

  it('ne jette pas sur une base déjà vide', async () => {
    const { deleted } = await purgeAllData()
    expect(deleted).toEqual({ catalogProducts: 0, csvImports: 0, csvTemplates: 0, invoices: 0 })
  })
})
