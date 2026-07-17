import { isValidObjectId } from 'mongoose'
import { basename } from 'node:path'
import { connectToDatabase } from '@/lib/mongodb'
import { InvoiceImport, type InvoiceItem, type InvoiceImportDoc } from '@/models/InvoiceImport'
import { assertPdfFile } from '@/lib/pdf-validation'
import { normalizeAzureInvoice } from '@/lib/azure-invoice-normalize'
import { invoiceItemsToCsv, type CsvTemplateShape } from '@/lib/invoice-to-csv'
import { getActiveTemplate } from '@/services/csv-template.service'
import { beginInvoiceAnalysis, pollInvoiceAnalysis } from '@/services/azure-invoice.service'

export interface InvoiceImportResult {
  invoiceId: string
  status: InvoiceImportDoc['status']
}

function assertId(id: string): void {
  if (!isValidObjectId(id)) throw new Error('Identifiant de facture invalide.')
}

async function requireInvoice(id: string) {
  assertId(id)
  await connectToDatabase()
  const doc = await InvoiceImport.findById(id)
  if (!doc) throw new Error('Facture introuvable.')
  return doc
}

export async function createInvoiceImport(input: {
  buffer: Buffer
  originalFileName: string
  mimeType: string
  family?: string | null
  supplier?: string | null
}): Promise<InvoiceImportResult> {
  const safeName = basename(input.originalFileName)
  assertPdfFile(safeName, input.mimeType, input.buffer.byteLength, input.buffer.subarray(0, 5))

  await connectToDatabase()
  const doc = await InvoiceImport.create({
    originalFileName: safeName,
    pdfContent: input.buffer,
    fileSize: input.buffer.byteLength,
    status: 'pending',
    defaultFamily: input.family?.trim() || null,
    defaultSupplier: input.supplier?.trim() || null,
  })

  return { invoiceId: String(doc._id), status: doc.status }
}

/** Soumet à Azure et passe en processing. Relançable depuis error/succeeded. */
export async function startAnalysis(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  if (doc.validatedAt) throw new Error('Facture validée : édition verrouillée.')
  const { operationLocation } = await beginInvoiceAnalysis(Buffer.from(doc.pdfContent))

  doc.status = 'processing'
  doc.azureOperationLocation = operationLocation
  doc.errorMessage = null
  await doc.save()
  return doc.toObject()
}

/** Sonde Azure une fois et fait avancer le statut. */
export async function refreshAnalysis(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)

  if (doc.status !== 'processing' || !doc.azureOperationLocation) {
    return doc.toObject()
  }

  const outcome = await pollInvoiceAnalysis(doc.azureOperationLocation)

  if (outcome.status === 'succeeded') {
    doc.azureRawResult = outcome.result ?? null
    doc.set('items', normalizeAzureInvoice(outcome.result))
    doc.status = 'succeeded'
    doc.errorMessage = null
  } else if (outcome.status === 'failed') {
    doc.status = 'error'
    doc.errorMessage = outcome.error ?? 'Analyse Azure échouée.'
  }

  await doc.save()
  return doc.toObject()
}

export async function listInvoiceImports(): Promise<
  Array<Pick<InvoiceImportDoc, 'originalFileName' | 'status' | 'createdAt' | 'validatedAt'> & { id: string; itemCount: number }>
> {
  await connectToDatabase()
  const docs = await InvoiceImport.find({})
    .select('originalFileName status createdAt validatedAt items')
    .sort({ createdAt: -1 })
    .lean()

  return docs.map((doc) => ({
    id: String(doc._id),
    originalFileName: doc.originalFileName,
    status: doc.status,
    createdAt: doc.createdAt,
    validatedAt: doc.validatedAt,
    itemCount: doc.items?.length ?? 0,
  }))
}

/** Détail complet sans les octets PDF ni le JSON Azure brut (lourds). */
export async function getInvoiceImport(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  const object = doc.toObject()
  return { ...object, pdfContent: undefined as never, azureRawResult: undefined as never }
}

export async function updateInvoiceItems(id: string, items: InvoiceItem[]): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  if (doc.validatedAt) throw new Error('Facture validée : édition verrouillée.')
  doc.set('items', items)
  await doc.save()
  return doc.toObject()
}

export async function validateInvoice(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  const template = await getActiveTemplate()
  doc.validatedAt = new Date()
  doc.templateIdAtConversion = template?._id ?? null
  await doc.save()
  return doc.toObject()
}

export async function deleteInvoiceImport(id: string): Promise<void> {
  assertId(id)
  await connectToDatabase()
  await InvoiceImport.findByIdAndDelete(id)
}

export async function exportInvoiceCsv(
  id: string,
  options: { bom?: boolean } = {},
): Promise<{ csv: string; fileName: string }> {
  const doc = await requireInvoice(id)
  const template = (await getActiveTemplate()) as unknown as CsvTemplateShape | null

  const csv = invoiceItemsToCsv(doc.items, template, options)
  const base = doc.originalFileName.replace(/\.pdf$/i, '')
  return { csv, fileName: `facture-${base}-${new Date().toISOString().slice(0, 10)}.csv` }
}
