import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'

export interface FacetEntry {
  value: string
  count: number
}

/**
 * Compte les produits du tableau maître par valeur d'une colonne de `csvData`
 * (p. ex. `Famille`, `Fournisseur`).
 *
 * Toutes les lignes sont comptées, y compris celles marquées supprimées : le
 * maître les conserve (décision L5-3). Les valeurs vides sont exclues — « existant »
 * veut dire renseigné. Le tri est alphabétique français.
 *
 * `column` provient d'un appelant interne (les pages serveur), jamais d'une
 * entrée utilisateur : elle est interpolée telle quelle dans le champ agrégé.
 */
export async function countCatalogValues(column: string): Promise<FacetEntry[]> {
  await connectToDatabase()

  const rows = await CatalogProduct.aggregate<{ _id: unknown; count: number }>([
    { $group: { _id: `$csvData.${column}`, count: { $sum: 1 } } },
  ])

  return rows
    .map((row) => ({ value: row._id == null ? '' : String(row._id), count: row.count }))
    .filter((entry) => entry.value.trim() !== '')
    .sort((a, b) => a.value.localeCompare(b.value, 'fr'))
}
