import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

const CsvImportSchema = new Schema(
  {
    originalFileName: { type: String, required: true },
    // Octets bruts du CSV, stockés en base (BSON Binary) plutôt que sur disque :
    // le serverless (Vercel) n'a pas de système de fichiers persistant partagé
    // entre l'upload et la création du template. Le plafond MAX_CSV_BYTES (10 Mo)
    // reste sous la limite de 16 Mo d'un document MongoDB.
    rawContent: { type: Buffer, required: true },
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
