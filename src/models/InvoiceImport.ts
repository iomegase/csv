import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

export const INVOICE_STATUSES = ['pending', 'processing', 'succeeded', 'error'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export type InvoiceItem = {
  supplierReference: string | null
  barcode: string | null
  description: string | null
  quantity: number | null
  purchasePriceHT: number | null
  vatRate: number | null
  lineTotalHT: number | null
}

// _id: false — les lignes sont un tableau de valeurs, pas des sous-documents
// adressables. null explicite : une donnée absente n'est jamais inventée.
const InvoiceItemSchema = new Schema<InvoiceItem>(
  {
    supplierReference: { type: String, default: null },
    barcode: { type: String, default: null },
    description: { type: String, default: null },
    quantity: { type: Number, default: null },
    purchasePriceHT: { type: Number, default: null },
    vatRate: { type: Number, default: null },
    lineTotalHT: { type: Number, default: null },
  },
  { _id: false },
)

const InvoiceImportSchema = new Schema(
  {
    originalFileName: { type: String, required: true },
    pdfContent: { type: Buffer, required: true },
    fileSize: { type: Number, required: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'pending' },
    azureModelId: { type: String, default: 'prebuilt-invoice' },
    azureOperationLocation: { type: String, default: null },
    azureRawResult: { type: Schema.Types.Mixed, default: null },
    items: { type: [InvoiceItemSchema], default: [] },
    errorMessage: { type: String, default: null },
    templateIdAtConversion: { type: Schema.Types.ObjectId, ref: 'CsvTemplate', default: null },
    validatedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type InvoiceImportDoc = InferSchemaType<typeof InvoiceImportSchema>

export const InvoiceImport =
  (models.InvoiceImport as Model<InvoiceImportDoc>) ||
  model<InvoiceImportDoc>('InvoiceImport', InvoiceImportSchema)
