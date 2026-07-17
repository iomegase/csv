import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getActiveTemplate } from '@/services/csv-template.service'
import { detectIdentityMapping } from '@/lib/catalog-columns'

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

function stringifyRecord(record: Record<string, unknown> | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(record ?? {})) out[key] = norm(value)
  return out
}

/**
 * Compare la copie de travail (catalogue) à l'original figé de CHAQUE produit
 * (`originalCsvData`, écrit à la création et conservé). Ce socle par produit
 * survit à la suppression de l'import CSV — contrairement à `sourceImportId`,
 * qui pointait vers un import destructible (R2).
 *
 * Classement par provenance :
 * - `createdFromInvoiceId` ou `originalCsvData` absent ⇒ **ajouté** (pas dans
 *   l'original) ;
 * - `isDeleted` sur un produit d'origine ⇒ **supprimé** (un article ajouté puis
 *   supprimé s'annule et n'apparaît nulle part) ;
 * - sinon, cellule(s) divergentes vs l'origine ⇒ **modifié**.
 */
export async function diffCatalogAgainstSource(): Promise<CatalogDiff> {
  await connectToDatabase()

  const template = await getActiveTemplate()
  if (!template) throw new Error('Aucun template actif.')

  const columnNames = [...template.columns].sort((a, b) => a.position - b.position).map((c) => c.name)
  const nameColumn = detectIdentityMapping(columnNames).name

  const products = await CatalogProduct.find({})
    .select('name csvData originalCsvData createdFromInvoiceId isDeleted')
    .lean()

  const diff: CatalogDiff = { added: [], removed: [], modified: [] }

  for (const product of products) {
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    const original = (product.originalCsvData ?? null) as Record<string, unknown> | null
    const name =
      (product.name ?? (nameColumn ? (csvData[nameColumn] as string) : null)) ?? null

    // « Ajouté » = pas issu de l'import d'origine : créé par une facture, ou sans
    // valeur d'origine enregistrée (création manuelle).
    const isAdded = Boolean(product.createdFromInvoiceId) || original == null

    if (product.isDeleted) {
      // Un article d'origine supprimé compte comme « supprimé ». Un article
      // ajouté puis supprimé s'annule (ni ajouté ni supprimé).
      if (!isAdded) diff.removed.push({ name, original: stringifyRecord(original) })
      continue
    }

    if (isAdded) {
      diff.added.push({ id: String(product._id), name })
      continue
    }

    // Article d'origine présent : comparer chaque colonne à sa valeur d'origine.
    const columns = columnNames.length
      ? columnNames
      : Array.from(new Set([...Object.keys(original ?? {}), ...Object.keys(csvData)]))

    const fields: Array<{ column: string; from: string | null; to: string | null }> = []
    for (const column of columns) {
      const from = norm((original ?? {})[column])
      const to = norm(csvData[column])
      if (from !== to) {
        fields.push({ column, from: from === '' ? null : from, to: to === '' ? null : to })
      }
    }
    if (fields.length) diff.modified.push({ id: String(product._id), name, fields })
  }

  return diff
}
