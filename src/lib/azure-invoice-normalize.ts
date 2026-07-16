import type { InvoiceItem } from '@/models/InvoiceImport'

type AzureField = Record<string, unknown>

/** Lit une chaîne d'un champ Azure, ou null. */
function readString(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null
  const value = (field as AzureField).valueString ?? (field as AzureField).content
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Lit un nombre d'un champ Azure (valueNumber, valueInteger ou montant), ou null. */
function readNumber(field: unknown): number | null {
  if (!field || typeof field !== 'object') return null
  const f = field as AzureField
  const candidates = [
    f.valueNumber,
    f.valueInteger,
    (f.valueCurrency as AzureField | undefined)?.amount,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

/** Lit un taux de TVA (« 20% », « 20 », 20) sans jamais l'inventer, ou null. */
function readRate(field: unknown): number | null {
  const direct = readNumber(field)
  if (direct !== null) return direct
  const text = readString(field)
  if (text === null) return null
  const match = text.replace(',', '.').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function normalizeAzureInvoice(analyzeResult: unknown): InvoiceItem[] {
  const result = analyzeResult as AzureField | null
  const documents = (result?.documents as AzureField[] | undefined) ?? []
  const items: InvoiceItem[] = []

  for (const document of documents) {
    const fields = (document?.fields as AzureField | undefined) ?? {}
    const array = ((fields.Items as AzureField | undefined)?.valueArray as AzureField[] | undefined) ?? []

    for (const entry of array) {
      const object = (entry?.valueObject as AzureField | undefined) ?? {}
      items.push({
        supplierReference: readString(object.ProductCode),
        // Le modèle facture n'expose pas de code-barres : jamais inventé.
        barcode: null,
        description: readString(object.Description),
        quantity: readNumber(object.Quantity),
        purchasePriceHT: readNumber(object.UnitPrice),
        // TaxRate uniquement : on ne déduit pas le taux d'un montant de taxe.
        vatRate: readRate(object.TaxRate),
        lineTotalHT: readNumber(object.Amount),
      })
    }
  }

  return items
}
