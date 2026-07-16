import type { InvoiceItem } from '@/models/InvoiceImport'
import { findColumn } from '@/lib/product-views'
import { serializeCsvValue } from '@/services/catalog-export.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export type CsvTemplateShape = {
  columns: { name: string; position: number }[]
  delimiter: string
}

// Alias stricts, réutilisant la détection du lot 1. `findColumn` compare des
// colonnes NORMALISÉES par `normalizeHeader` (accents retirés, minuscules, toute
// ponctuation → espace) : les alias doivent donc être écrits sous cette forme
// normalisée. Ex. la colonne « Prix d'achat » se normalise en « prix d achat »,
// d'où l'alias `prix d achat`. « famille », « rang » n'ont aucun alias ici :
// ces colonnes resteront vides — on ne les invente pas.
const FIELD_ALIASES: Record<keyof InvoiceItem, string[]> = {
  supplierReference: ['reference', 'ref', 'code article', 'sku', 'code produit'],
  barcode: ['code barre', 'code barres', 'codebarre', 'ean', 'ean13', 'gencod', 'gencode'],
  description: ['nom', 'designation', 'libelle', 'description'],
  quantity: ['quantite', 'qte', 'stock'],
  purchasePriceHT: ['prix d achat', 'prix achat', 'prix achat ht', 'prix ht', 'cout', 'achat'],
  vatRate: ['tva', 'taux tva', 'taux de tva'],
  lineTotalHT: ['total ht', 'montant ht', 'total'],
}

/** Colonne du template associée à chaque champ InvoiceItem (ou '' si absente). */
function buildFieldToColumn(columnNames: string[]): Partial<Record<keyof InvoiceItem, string>> {
  const mapping: Partial<Record<keyof InvoiceItem, string>> = {}
  for (const field of Object.keys(FIELD_ALIASES) as (keyof InvoiceItem)[]) {
    const column = findColumn(columnNames, FIELD_ALIASES[field])
    if (column) mapping[field] = column
  }
  return mapping
}

export function invoiceItemsToCsv(
  items: InvoiceItem[],
  template: CsvTemplateShape | null,
  options: { bom?: boolean } = {},
): string {
  if (!template) throw new Error(NO_ACTIVE_TEMPLATE_MESSAGE)

  const columns = [...template.columns].sort((a, b) => a.position - b.position).map((c) => c.name)
  const delimiter = template.delimiter || ';'
  const fieldToColumn = buildFieldToColumn(columns)

  // Colonne → champ InvoiceItem (inverse), pour remplir chaque cellule.
  const columnToField = new Map<string, keyof InvoiceItem>()
  for (const [field, column] of Object.entries(fieldToColumn) as [keyof InvoiceItem, string][]) {
    columnToField.set(column, field)
  }

  const lines = [columns.map((c) => serializeCsvValue(c, delimiter)).join(delimiter)]

  for (const item of items) {
    lines.push(
      columns
        .map((column) => {
          const field = columnToField.get(column)
          // Colonne non mappée, ou valeur null → cellule vide. Jamais inventée.
          const value = field ? item[field] : null
          return serializeCsvValue(value, delimiter)
        })
        .join(delimiter),
    )
  }

  const csv = `${lines.join('\r\n')}\r\n`
  return options.bom === false ? csv : `﻿${csv}`
}
