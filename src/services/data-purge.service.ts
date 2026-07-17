import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvImport } from '@/models/CsvImport'
import { CsvTemplate } from '@/models/CsvTemplate'
import { InvoiceImport } from '@/models/InvoiceImport'

export interface PurgeResult {
  deleted: {
    catalogProducts: number
    csvImports: number
    csvTemplates: number
    invoices: number
  }
}

/**
 * Vide entièrement l'application : les quatre collections, sans exception.
 *
 * Irréversible. Le garde-fou (saisie du mot de confirmation) vit dans la route
 * et l'UI ; ce service, lui, efface sans poser de question — il n'est appelé
 * qu'une fois la confirmation validée.
 */
export async function purgeAllData(): Promise<PurgeResult> {
  await connectToDatabase()

  const [catalogProducts, csvImports, csvTemplates, invoices] = await Promise.all([
    CatalogProduct.deleteMany({}),
    CsvImport.deleteMany({}),
    CsvTemplate.deleteMany({}),
    InvoiceImport.deleteMany({}),
  ])

  return {
    deleted: {
      catalogProducts: catalogProducts.deletedCount,
      csvImports: csvImports.deletedCount,
      csvTemplates: csvTemplates.deletedCount,
      invoices: invoices.deletedCount,
    },
  }
}
