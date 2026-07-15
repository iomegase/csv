import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

const CatalogProductSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'CsvTemplate', required: true, index: true },

    // Champs d'identité extraits de csvData pour l'indexation et la
    // correspondance. csvData reste la valeur de référence.
    shopcaisseId: { type: String, default: null, index: true },
    reference: { type: String, default: null, index: true },
    barcode: { type: String, default: null, index: true },
    name: { type: String, default: null, index: true },
    supplier: { type: String, default: null, index: true },

    csvData: { type: Schema.Types.Mixed, required: true },
    originalCsvData: { type: Schema.Types.Mixed, default: null },

    // Renseignés par le lot 3. Le modèle InvoiceImport n'existe pas encore :
    // la ref reste inerte tant qu'aucun populate ne la traverse.
    createdFromInvoiceId: { type: Schema.Types.ObjectId, ref: 'InvoiceImport', default: null },
    lastUpdatedFromInvoiceId: { type: Schema.Types.ObjectId, ref: 'InvoiceImport', default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export type CatalogProductDoc = InferSchemaType<typeof CatalogProductSchema>

export const CatalogProduct =
  (models.CatalogProduct as Model<CatalogProductDoc>) ||
  model<CatalogProductDoc>('CatalogProduct', CatalogProductSchema)
