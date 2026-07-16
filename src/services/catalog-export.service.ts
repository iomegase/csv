import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export function serializeCsvValue(value: unknown, delimiter = ';'): string {
  if (value === null || value === undefined) return ''

  const stringValue = String(value)

  if (
    stringValue.includes(delimiter) ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r')
  ) {
    return `"${stringValue.replaceAll('"', '""')}"`
  }

  return stringValue
}

export async function exportCatalogCsv(
  options: { bom?: boolean } = {},
): Promise<{ csv: string; fileName: string }> {
  await connectToDatabase()

  const template = await getActiveTemplate()
  if (!template) throw new Error(NO_ACTIVE_TEMPLATE_MESSAGE)

  const columns = [...template.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => column.name)

  const delimiter = template.delimiter || ';'
  const products = await CatalogProduct.find({ isDeleted: false })
    .sort({ _id: 1 })
    .select('csvData')
    .lean()

  const lines = [columns.map((column) => serializeCsvValue(column, delimiter)).join(delimiter)]

  for (const product of products) {
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    // Lecture par nom de colonne du template : une colonne absente donne une
    // cellule vide, cohérent avec le traitement de null (D6).
    lines.push(
      columns.map((column) => serializeCsvValue(csvData[column], delimiter)).join(delimiter),
    )
  }

  // \r\n et BOM : format attendu par ShopCaisse, identique à l'export client.
  const csv = `${lines.join('\r\n')}\r\n`
  const withBom = options.bom === false ? csv : `﻿${csv}`

  return {
    csv: withBom,
    fileName: `catalogue-${new Date().toISOString().slice(0, 10)}.csv`,
  }
}
