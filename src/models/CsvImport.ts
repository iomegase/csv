import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

const CsvImportSchema = new Schema(
  {
    originalFileName: { type: String, required: true },
    storedFileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, required: true },
    encoding: { type: String, required: true },
    delimiter: { type: String, required: true },
    columns: { type: [String], required: true },
    rowCount: { type: Number, required: true },
  },
  { timestamps: true },
)

export type CsvImportDoc = InferSchemaType<typeof CsvImportSchema>

export const CsvImport =
  (models.CsvImport as Model<CsvImportDoc>) ||
  model<CsvImportDoc>('CsvImport', CsvImportSchema)
