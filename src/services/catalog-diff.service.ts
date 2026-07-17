import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvImport } from '@/models/CsvImport'
import { getActiveTemplate } from '@/services/csv-template.service'
import { parseCsvBuffer } from '@/services/csv-parser.service'
import { detectIdentityMapping, normalizeMatchValue } from '@/lib/catalog-columns'

export interface CatalogDiff {
  added: Array<{ id: string; name: string | null }>
  removed: Array<{ name: string | null; original: Record<string, string> }>
  modified: Array<{
    id: string
    name: string | null
    fields: Array<{ column: string; from: string | null; to: string | null }>
  }>
}

/** Deux valeurs sont « identiques » si elles sont vides des deux côtés, ou égales. */
function norm(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export async function diffCatalogAgainstSource(): Promise<CatalogDiff> {
  await connectToDatabase()

  const template = await getActiveTemplate()
  if (!template) throw new Error('Aucun template actif.')

  const columnNames = [...template.columns].sort((a, b) => a.position - b.position).map((c) => c.name)
  const nameColumn = detectIdentityMapping(columnNames).name

  // Original : import source re-parsé (figé). Absent ⇒ original vide.
  let originalRows: Record<string, string>[] = []
  if (template.sourceImportId) {
    // Pas de .lean() ici : en lean, rawContent (type Buffer du schéma) revient
    // en objet BSON Binary brut, pas en Buffer Node — Buffer.from() sur cet
    // objet produirait un contenu vide. L'hydratation Mongoose recast bien le
    // champ en Buffer (même convention que createTemplateFromImport).
    const csvImport = await CsvImport.findById(template.sourceImportId)
    if (csvImport?.rawContent) {
      originalRows = parseCsvBuffer(Buffer.from(csvImport.rawContent)).rows
    }
  }

  const originalByName = new Map<string, Record<string, string>>()
  for (const row of originalRows) {
    const key = normalizeMatchValue(nameColumn ? row[nameColumn] : null)
    if (key && !originalByName.has(key)) originalByName.set(key, row)
  }

  // Copie de travail : tous les articles (isDeleted compris pour « supprimés »).
  const products = await CatalogProduct.find({})
    .select('name csvData isDeleted')
    .lean()

  const activeNames = new Set<string>()
  const diff: CatalogDiff = { added: [], removed: [], modified: [] }

  for (const product of products) {
    if (product.isDeleted) continue
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    const name = (product.name ?? (nameColumn ? (csvData[nameColumn] as string) : null)) ?? null
    const key = normalizeMatchValue(name)
    if (key) activeNames.add(key)

    const original = key ? originalByName.get(key) : undefined
    if (!original) {
      diff.added.push({ id: String(product._id), name })
      continue
    }

    const fields: Array<{ column: string; from: string | null; to: string | null }> = []
    for (const column of columnNames) {
      const from = norm(original[column])
      const to = norm(csvData[column])
      if (from !== to) {
        fields.push({ column, from: from === '' ? null : from, to: to === '' ? null : to })
      }
    }
    if (fields.length) diff.modified.push({ id: String(product._id), name, fields })
  }

  // Supprimés : présents dans l'original, absents des articles actifs.
  for (const [key, row] of originalByName) {
    if (!activeNames.has(key)) {
      diff.removed.push({ name: nameColumn ? (row[nameColumn] ?? null) : null, original: row })
    }
  }

  return diff
}
