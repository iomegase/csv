import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { InvoiceImport, type InvoiceItem } from '@/models/InvoiceImport'
import { applyInvoiceToCatalog } from '@/services/invoice-catalog.service'

withTestDatabase()

const COLUMNS = ['Nom', 'Référence', 'Code barre', 'Quantité']

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

describe('applyInvoiceToCatalog', () => {
  it('ajoute la quantité au stock d’un produit apparié par référence', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      reference: 'VASE-001',
      name: 'Vase',
      csvData: { Nom: 'Vase', Référence: 'VASE-001', Quantité: '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'VASE-001', description: 'Vase', quantity: 6 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    expect(summary.created).toBe(0)
    const product = await CatalogProduct.findOne({ reference: 'VASE-001' }).lean()
    expect(product!.csvData).toMatchObject({ Quantité: '16' })
    expect(String(product!.lastUpdatedFromInvoiceId)).toBe(invoiceId)
  })

  it('ajoute la quantité sur une colonne stock dont le nom contient un point, sans créer de sous-objet imbriqué', async () => {
    // Régression : un $set d'agrégation avec une clé `csvData.${col}` en
    // notation pointée scinderait "Qté." en ["csvData","Qté",""] et créerait
    // un sous-objet au lieu d'écrire la vraie colonne. L'écriture doit passer
    // par une clé littérale, symétrique de la lecture par $getField.
    await CsvTemplate.create({
      name: 'TDot',
      sourceFileName: 't.csv',
      columns: ['Nom', 'Référence', 'Qté.'].map((name, position) => ({
        name,
        position,
        detectedType: 'string',
      })),
      delimiter: ';',
      isActive: true,
    })
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      reference: 'DOT-001',
      name: 'Boîte',
      csvData: { Nom: 'Boîte', Référence: 'DOT-001', 'Qté.': '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'DOT-001', description: 'Boîte', quantity: 6 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'DOT-001' }).lean()
    expect(product!.csvData).toMatchObject({ 'Qté.': '16' })
    expect(Object.prototype.hasOwnProperty.call(product!.csvData as object, 'Qté.')).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(product!.csvData as object, 'Qté')).toBe(false)
  })

  it('crée un produit inconnu avec le stock de la facture', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'NEW-1', description: 'Bol', quantity: 4 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'NEW-1' }).lean()
    expect(product!.csvData).toMatchObject({ Référence: 'NEW-1', Nom: 'Bol', Quantité: '4' })
    expect(String(product!.createdFromInvoiceId)).toBe(invoiceId)
  })

  it('apparie par code-barres', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      barcode: '3001234567890',
      name: 'Assiette',
      csvData: { Nom: 'Assiette', 'Code barre': '3001234567890', Quantité: '2' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ barcode: '3001234567890', description: 'Assiette', quantity: 3 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ barcode: '3001234567890' }).lean()
    expect(product!.csvData).toMatchObject({ Quantité: '5' })
  })

  it('apparie par nom quand référence et code-barres sont absents (R1.2)', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      name: '[DP0001] Dessous de plat sapin blanc',
      csvData: { Nom: '[DP0001] Dessous de plat sapin blanc', Quantité: '10' },
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
    expect(product!.csvData).toMatchObject({ Quantité: '16' })
    expect(String(product!.lastUpdatedFromInvoiceId)).toBe(invoiceId)
  })

  it('lit un stock existant localisé (séparateur de milliers) sans le détruire (R1.7)', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      reference: 'LOC-1',
      name: 'Carton',
      csvData: { Nom: 'Carton', Référence: 'LOC-1', Quantité: '1 200' },
    })
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'LOC-1', quantity: 6 })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'LOC-1' }).lean()
    expect(product!.csvData).toMatchObject({ Quantité: '1206' })
  })

  it('agrège plusieurs lignes visant le même produit existant (R1.6)', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      reference: 'SUM-1',
      name: 'Sac',
      csvData: { Nom: 'Sac', Référence: 'SUM-1', Quantité: '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'SUM-1', quantity: 6 }),
      emptyItem({ supplierReference: 'SUM-1', quantity: 4 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'SUM-1' }).lean()
    expect(product!.csvData).toMatchObject({ Quantité: '20' })
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
    expect(product!.csvData).toMatchObject({ Quantité: '8' })
  })

  it('signale un nom ambigu (plusieurs produits de même nom) sans écrire (R1.5)', async () => {
    await makeActiveTemplate()
    const templateId = (await CsvTemplate.findOne({}))!._id
    await CatalogProduct.create({ templateId, name: 'Bougie', csvData: { Nom: 'Bougie', Quantité: '1' } })
    await CatalogProduct.create({ templateId, name: 'Bougie', csvData: { Nom: 'Bougie', Quantité: '2' } })
    const invoiceId = await makeInvoice([emptyItem({ description: 'Bougie', quantity: 5 })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.ambiguous).toHaveLength(1)
    expect(summary.ambiguous[0].matchedBy).toBe('name')
    expect(summary.updated).toBe(0)
    expect(summary.created).toBe(0)
  })

  it('ne comptabilise pas un cas ambigu et le signale', async () => {
    await makeActiveTemplate()
    const templateId = (await CsvTemplate.findOne({}))!._id
    await CatalogProduct.create({ templateId, reference: 'DUP', name: 'A', csvData: { Référence: 'DUP', Quantité: '1' } })
    await CatalogProduct.create({ templateId, reference: 'DUP', name: 'B', csvData: { Référence: 'DUP', Quantité: '1' } })
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

  it('échoue si le template actif n’a pas de colonne quantité', async () => {
    await CsvTemplate.create({
      name: 'SansQte',
      sourceFileName: 't.csv',
      columns: ['Nom', 'Référence'].map((name, position) => ({ name, position, detectedType: 'string' })),
      delimiter: ';',
      isActive: true,
    })
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'X', quantity: 1 })])

    await expect(applyInvoiceToCatalog(invoiceId)).rejects.toThrow(/colonne quantité|stock/)
  })
})
