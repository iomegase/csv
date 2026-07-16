import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { InvoiceImport } from '@/models/InvoiceImport'
import { CsvTemplate } from '@/models/CsvTemplate'

vi.mock('@/services/azure-invoice.service', () => ({
  beginInvoiceAnalysis: vi.fn(),
  pollInvoiceAnalysis: vi.fn(),
}))

import { beginInvoiceAnalysis, pollInvoiceAnalysis } from '@/services/azure-invoice.service'
import {
  createInvoiceImport,
  startAnalysis,
  refreshAnalysis,
  updateInvoiceItems,
  validateInvoice,
  deleteInvoiceImport,
  exportInvoiceCsv,
} from '@/services/invoice-import.service'

withTestDatabase()

const PDF = () => Buffer.from('%PDF-1.4\nfacture', 'utf-8')

afterEach(() => vi.clearAllMocks())

async function makeActiveTemplate() {
  return CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    isActive: true,
    delimiter: ';',
    columns: [
      { name: 'Référence', position: 0, detectedType: 'string' },
      { name: 'Nom', position: 1, detectedType: 'string' },
    ],
  })
}

describe('createInvoiceImport', () => {
  it('stocke le PDF et le statut pending', async () => {
    const result = await createInvoiceImport({
      buffer: PDF(),
      originalFileName: 'facture.pdf',
      mimeType: 'application/pdf',
    })
    const doc = await InvoiceImport.findById(result.invoiceId)
    expect(doc!.status).toBe('pending')
    expect(Buffer.from(doc!.pdfContent).equals(PDF())).toBe(true)
  })

  it('refuse un fichier non PDF', async () => {
    await expect(
      createInvoiceImport({ buffer: Buffer.from('PK\x03\x04'), originalFileName: 'x.pdf', mimeType: 'application/pdf' }),
    ).rejects.toThrow(/PDF/)
  })
})

describe('analyse', () => {
  it('startAnalysis pose processing et l’operation-location', async () => {
    vi.mocked(beginInvoiceAnalysis).mockResolvedValue({ operationLocation: 'https://op/1' })
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })

    await startAnalysis(invoiceId)

    const doc = await InvoiceImport.findById(invoiceId)
    expect(doc!.status).toBe('processing')
    expect(doc!.azureOperationLocation).toBe('https://op/1')
  })

  it('refreshAnalysis succeeded normalise et fige les items', async () => {
    vi.mocked(beginInvoiceAnalysis).mockResolvedValue({ operationLocation: 'https://op/1' })
    vi.mocked(pollInvoiceAnalysis).mockResolvedValue({
      status: 'succeeded',
      result: {
        documents: [
          { fields: { Items: { valueArray: [{ valueObject: { Description: { valueString: 'Chaise' } } }] } } },
        ],
      },
    })
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await startAnalysis(invoiceId)

    const doc = await refreshAnalysis(invoiceId)

    expect(doc.status).toBe('succeeded')
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0].description).toBe('Chaise')
  })

  it('refreshAnalysis failed pose error et le message', async () => {
    vi.mocked(beginInvoiceAnalysis).mockResolvedValue({ operationLocation: 'https://op/1' })
    vi.mocked(pollInvoiceAnalysis).mockResolvedValue({ status: 'failed', error: 'illisible' })
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await startAnalysis(invoiceId)

    const doc = await refreshAnalysis(invoiceId)
    expect(doc.status).toBe('error')
    expect(doc.errorMessage).toMatch(/illisible/)
  })
})

describe('correction et validation', () => {
  const oneItem = [
    { supplierReference: 'R1', barcode: null, description: 'Chaise', quantity: 1, purchasePriceHT: 10, vatRate: null, lineTotalHT: 10 },
  ]

  it('updateInvoiceItems remplace les lignes', async () => {
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await updateInvoiceItems(invoiceId, oneItem)
    const doc = await InvoiceImport.findById(invoiceId)
    expect(doc!.items[0].supplierReference).toBe('R1')
  })

  it('validateInvoice verrouille l’édition', async () => {
    await makeActiveTemplate()
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await updateInvoiceItems(invoiceId, oneItem)
    await validateInvoice(invoiceId)

    const doc = await InvoiceImport.findById(invoiceId)
    expect(doc!.validatedAt).not.toBeNull()
    await expect(updateInvoiceItems(invoiceId, oneItem)).rejects.toThrow(/validée/)
  })
})

describe('export et suppression', () => {
  it('exportInvoiceCsv rend un CSV au format du template actif', async () => {
    await makeActiveTemplate()
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'facture.pdf', mimeType: 'application/pdf' })
    await updateInvoiceItems(invoiceId, [
      { supplierReference: 'R1', barcode: null, description: 'Chaise', quantity: 1, purchasePriceHT: 10, vatRate: null, lineTotalHT: 10 },
    ])

    const { csv, fileName } = await exportInvoiceCsv(invoiceId, { bom: false })
    expect(csv).toBe('Référence;Nom\r\nR1;Chaise\r\n')
    expect(fileName).toMatch(/\.csv$/)
  })

  it('deleteInvoiceImport supprime le document', async () => {
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await deleteInvoiceImport(invoiceId)
    expect(await InvoiceImport.findById(invoiceId)).toBeNull()
  })
})
