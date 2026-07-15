import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

export const DETECTED_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'json',
  'unknown',
] as const

export type DetectedType = (typeof DETECTED_TYPES)[number]

const CsvColumnSchema = new Schema(
  {
    name: { type: String, required: true },
    position: { type: Number, required: true },
    detectedType: { type: String, enum: DETECTED_TYPES, default: 'unknown' },
  },
  { _id: false },
)

const CsvTemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    sourceFileName: { type: String, required: true },
    sourceImportId: { type: Schema.Types.ObjectId, ref: 'CsvImport', default: null },
    columns: { type: [CsvColumnSchema], required: true },
    delimiter: { type: String, default: ';' },
    encoding: { type: String, default: 'utf-8' },
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// Garantit « un seul template actif » dans la base elle-même. La transaction
// d'activation sérialise le cas normal ; cet index est ce qui rattrape deux
// activations réellement concurrentes.
CsvTemplateSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
)

export type CsvTemplateDoc = InferSchemaType<typeof CsvTemplateSchema>
export type CsvColumn = { name: string; position: number; detectedType: DetectedType }

export const CsvTemplate =
  (models.CsvTemplate as Model<CsvTemplateDoc>) ||
  model<CsvTemplateDoc>('CsvTemplate', CsvTemplateSchema)
