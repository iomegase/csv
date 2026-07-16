import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { InvoiceImport } from '@/models/InvoiceImport'

withTestDatabase()

const base = () => ({
  originalFileName: 'facture.pdf',
  pdfContent: Buffer.from('%PDF-1.4 test'),
  fileSize: 13,
})

describe('InvoiceImport', () => {
  it('applique les valeurs par défaut', async () => {
    const doc = await InvoiceImport.create(base())
    expect(doc.status).toBe('pending')
    expect(doc.items).toEqual([])
    expect(doc.azureOperationLocation).toBeNull()
    expect(doc.azureRawResult).toBeNull()
    expect(doc.errorMessage).toBeNull()
    expect(doc.validatedAt).toBeNull()
    expect(doc.azureModelId).toBe('prebuilt-invoice')
  })

  it('refuse un statut hors énumération', async () => {
    await expect(
      InvoiceImport.create({ ...base(), status: 'inconnu' }),
    ).rejects.toThrow(/status/)
  })

  it('conserve les InvoiceItem avec leurs null', async () => {
    const doc = await InvoiceImport.create({
      ...base(),
      items: [
        {
          supplierReference: 'REF-1',
          barcode: null,
          description: 'Chaise',
          quantity: 2,
          purchasePriceHT: 15.5,
          vatRate: null,
          lineTotalHT: 31,
        },
      ],
    })
    const stored = await InvoiceImport.findById(doc._id).lean()
    expect(stored!.items[0]).toMatchObject({ supplierReference: 'REF-1', barcode: null, vatRate: null })
  })
})
