import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { InvoiceImport, type InvoiceItem } from '@/models/InvoiceImport'
import { applyInvoiceToCatalog } from '@/services/invoice-catalog.service'
import { validateMasterEntries } from '@/services/shopcaisse-validation.service'
import type { MasterRow } from '@/lib/shopcaisse-columns'

withTestDatabase()

// Le template ne sert qu'à repérer les colonnes d'identité (Nom / Référence /
// Code barre). La quantité reçue, elle, alimente toujours le Stock souhaité du
// maître, quelle que soit la forme du template.
const COLUMNS = ['Nom', 'Référence', 'Code barre']

async function makeActiveTemplate() {
  await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
}

const emptyItem = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  supplierReference: null,
  barcode: null,
  description: null,
  quantity: null,
  purchasePriceHT: null,
  vatRate: null,
  lineTotalHT: null,
  ...over,
})

async function makeInvoice(items: InvoiceItem[], over: Record<string, unknown> = {}) {
  const doc = await InvoiceImport.create({
    originalFileName: 'f.pdf',
    pdfContent: Buffer.from('%PDF-'),
    fileSize: 5,
    status: 'succeeded',
    items,
    validatedAt: new Date(),
    ...over,
  })
  return String(doc._id)
}

async function seedProduct(fields: Record<string, unknown>) {
  await CatalogProduct.create({ templateId: (await CsvTemplate.findOne({}))!._id, ...fields })
}

describe('applyInvoiceToCatalog', () => {
  it('porte la quantité reçue dans le Stock souhaité et recalcule le mouvement', async () => {
    await makeActiveTemplate()
    await seedProduct({
      reference: 'VASE-001',
      name: 'Vase',
      csvData: { Nom: 'Vase', Référence: 'VASE-001', 'Stock actuel': '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'VASE-001', description: 'Vase', quantity: 6 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    expect(summary.created).toBe(0)
    const product = await CatalogProduct.findOne({ reference: 'VASE-001' }).lean()
    // Cible 16 (10 connu + 6 reçus), mouvement 6 = ce que ShopCaisse doit ajouter.
    expect(product!.csvData).toMatchObject({ 'Stock souhaité': '16', 'Mouvement stock': '6' })
    expect(String(product!.lastUpdatedFromInvoiceId)).toBe(invoiceId)
  })

  it('crée un produit inconnu : Stock actuel 0, Stock souhaité = quantité, mouvement = quantité', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'NEW-1', description: 'Bol', quantity: 4 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'NEW-1' }).lean()
    expect(product!.csvData).toMatchObject({
      Référence: 'NEW-1',
      Nom: 'Bol',
      'Stock actuel': '0',
      'Stock souhaité': '4',
      'Mouvement stock': '4',
    })
    expect(String(product!.createdFromInvoiceId)).toBe(invoiceId)
  })

  it('crée un produit exportable sans Référence — un Nom et une quantité suffisent', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ description: 'Bol artisanal', quantity: 4 })])

    await applyInvoiceToCatalog(invoiceId)

    const product = await CatalogProduct.findOne({}).lean()
    const validation = validateMasterEntries([{ id: 'x', row: product!.csvData as MasterRow }])
    expect(validation.canExport).toBe(true)
    expect(validation.blockers).toEqual([])
  })

  it('apparie par code-barres', async () => {
    await makeActiveTemplate()
    await seedProduct({
      barcode: '3001234567890',
      name: 'Assiette',
      csvData: { Nom: 'Assiette', 'Code barre': '3001234567890', 'Stock actuel': '2' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ barcode: '3001234567890', description: 'Assiette', quantity: 3 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ barcode: '3001234567890' }).lean()
    expect(product!.csvData).toMatchObject({ 'Stock souhaité': '5', 'Mouvement stock': '3' })
  })

  it('apparie par nom quand référence et code-barres sont absents (R1.2)', async () => {
    await makeActiveTemplate()
    await seedProduct({
      name: '[DP0001] Dessous de plat sapin blanc',
      csvData: { Nom: '[DP0001] Dessous de plat sapin blanc', 'Stock actuel': '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ description: '[DP0001] Dessous de plat sapin blanc', quantity: 6 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    expect(summary.created).toBe(0)
    const product = await CatalogProduct.findOne({
      name: '[DP0001] Dessous de plat sapin blanc',
    }).lean()
    expect(product!.csvData).toMatchObject({ 'Stock souhaité': '16', 'Mouvement stock': '6' })
    expect(String(product!.lastUpdatedFromInvoiceId)).toBe(invoiceId)
  })

  it('base la cible sur un Stock souhaité déjà saisi plutôt que sur le Stock actuel', async () => {
    await makeActiveTemplate()
    await seedProduct({
      reference: 'TGT-1',
      name: 'Coussin',
      csvData: { Nom: 'Coussin', Référence: 'TGT-1', 'Stock actuel': '5', 'Stock souhaité': '8' },
    })
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'TGT-1', quantity: 2 })])

    await applyInvoiceToCatalog(invoiceId)

    const product = await CatalogProduct.findOne({ reference: 'TGT-1' }).lean()
    // 8 (cible déjà voulue) + 2 reçus = 10 ; mouvement 10 − 5 = 5.
    expect(product!.csvData).toMatchObject({ 'Stock souhaité': '10', 'Mouvement stock': '5' })
  })

  it('agrège plusieurs lignes visant le même produit existant (R1.6)', async () => {
    await makeActiveTemplate()
    await seedProduct({
      reference: 'SUM-1',
      name: 'Sac',
      csvData: { Nom: 'Sac', Référence: 'SUM-1', 'Stock actuel': '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'SUM-1', quantity: 6 }),
      emptyItem({ supplierReference: 'SUM-1', quantity: 4 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'SUM-1' }).lean()
    expect(product!.csvData).toMatchObject({ 'Stock souhaité': '20', 'Mouvement stock': '10' })
  })

  it('agrège plusieurs lignes d’un même nouveau produit (R1.6)', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'NEW-2', description: 'Pot', quantity: 3 }),
      emptyItem({ supplierReference: 'NEW-2', description: 'Pot', quantity: 5 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.created).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'NEW-2' }).lean()
    expect(product!.csvData).toMatchObject({ 'Stock souhaité': '8', 'Mouvement stock': '8' })
  })

  it('signale un nom ambigu (plusieurs produits de même nom) sans écrire (R1.5)', async () => {
    await makeActiveTemplate()
    await seedProduct({ name: 'Bougie', csvData: { Nom: 'Bougie' } })
    await seedProduct({ name: 'Bougie', csvData: { Nom: 'Bougie' } })
    const invoiceId = await makeInvoice([emptyItem({ description: 'Bougie', quantity: 5 })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.ambiguous).toHaveLength(1)
    expect(summary.ambiguous[0].matchedBy).toBe('name')
    expect(summary.updated).toBe(0)
    expect(summary.created).toBe(0)
  })

  it('ne comptabilise pas un cas ambigu et le signale', async () => {
    await makeActiveTemplate()
    await seedProduct({ reference: 'DUP', name: 'A', csvData: { Référence: 'DUP' } })
    await seedProduct({ reference: 'DUP', name: 'B', csvData: { Référence: 'DUP' } })
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'DUP', quantity: 5 })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.ambiguous).toHaveLength(1)
    expect(summary.ambiguous[0].matchedBy).toBe('reference')
    expect(summary.updated).toBe(0)
    expect(summary.created).toBe(0)
  })

  it('ignore une ligne sans quantité', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'NOQTY', quantity: null })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.skipped).toHaveLength(1)
    expect(summary.created).toBe(0)
    expect(await CatalogProduct.countDocuments({})).toBe(0)
  })

  it('refuse une facture non validée', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'X', quantity: 1 })], {
      validatedAt: null,
    })

    await expect(applyInvoiceToCatalog(invoiceId)).rejects.toThrow(/non validée/)
  })

  it('refuse une facture déjà appliquée et horodate la première application', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'ONCE', quantity: 1 })])

    await applyInvoiceToCatalog(invoiceId)
    const first = await InvoiceImport.findById(invoiceId).lean()
    expect(first!.appliedToCatalogAt).toBeTruthy()

    await expect(applyInvoiceToCatalog(invoiceId)).rejects.toThrow(/déjà appliquée/)
    // Pas de double ajout : une seule création.
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })
})
