import { CsvRow } from '@/lib/csv'

export type ProductViewId =
  | 'all'
  | 'withoutStock'
  | 'withoutPrice'
  | 'withStockAndPrice'
  | 'withoutFamily'

export interface ColumnMapping {
  name: string
  stock: string
  salePrice: string
  family: string
}

export interface ProductViewDefinition {
  id: ProductViewId
  href: string
  label: string
  shortLabel: string
  description: string
}

export const PRODUCT_VIEWS: ProductViewDefinition[] = [
  {
    id: 'all',
    href: '/tous-les-produits',
    label: 'Tous les produits',
    shortLabel: 'Tous',
    description: 'Toutes les références présentes dans le fichier importé.',
  },
  {
    id: 'withoutStock',
    href: '/sans-stock',
    label: 'Produits sans stock',
    shortLabel: 'Sans stock',
    description: 'Références dont la quantité est vide, nulle ou négative.',
  },
  {
    id: 'withoutPrice',
    href: '/sans-prix',
    label: 'Produits sans prix',
    shortLabel: 'Sans prix',
    description: 'Références dont le prix de vente est vide, non renseigné ou égal à zéro.',
  },
  {
    id: 'withStockAndPrice',
    href: '/avec-stock-et-prix',
    label: 'Produits avec stock et prix',
    shortLabel: 'Stock + prix',
    description: 'Références possédant une quantité positive et un prix de vente positif.',
  },
  {
    id: 'withoutFamily',
    href: '/sans-famille',
    label: 'Produits sans famille',
    shortLabel: 'Sans famille',
    description: 'Références dont la famille ou la catégorie n’est pas renseignée.',
  },
]

const COLUMN_ALIASES: Record<keyof ColumnMapping, string[]> = {
  name: ['nom', 'designation', 'libelle', 'produit', 'nom du produit', 'article'],
  stock: ['quantite', 'qte', 'stock', 'stock actuel', 'stock disponible', 'quantite en stock'],
  salePrice: [
    'valeur a la vente',
    'prix de vente',
    'prix vente',
    'prix public',
    'tarif vente',
    'pv',
  ],
  family: ['famille', 'categorie', 'rayon', 'univers', 'groupe', 'collection'],
}

export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function findColumn(columns: string[], aliases: string[]): string {
  const normalizedColumns = columns.map((column) => ({
    original: column,
    normalized: normalizeHeader(column),
  }))

  for (const alias of aliases) {
    const exact = normalizedColumns.find(({ normalized }) => normalized === alias)
    if (exact) return exact.original
  }

  for (const alias of aliases) {
    if (alias.length < 4) continue
    const partial = normalizedColumns.find(({ normalized }) => normalized.includes(alias))
    if (partial) return partial.original
  }

  return ''
}

export function detectColumnMapping(columns: string[]): ColumnMapping {
  return {
    name: findColumn(columns, COLUMN_ALIASES.name),
    stock: findColumn(columns, COLUMN_ALIASES.stock),
    salePrice: findColumn(columns, COLUMN_ALIASES.salePrice),
    family: findColumn(columns, COLUMN_ALIASES.family),
  }
}

export function parseLocalizedNumber(value: string): number | null {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('fr')

  if (
    !normalized ||
    ['n/a', 'na', 'null', 'non renseigne', 'non renseigné', '-', '--'].includes(normalized)
  ) {
    return null
  }

  const cleaned = normalized
    .replace(/[€$£]/g, '')
    .replace(/[\s\u00A0\u202F]/g, '')
    .replace(/,(?=\d{1,4}$)/, '.')
    .replace(/[^0-9.-]/g, '')

  if (!cleaned) return null

  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

export function isEmptyValue(value: string): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('fr')

  return (
    !normalized ||
    ['n/a', 'na', 'null', 'non renseigne', 'non renseigné', '-', '--'].includes(normalized)
  )
}

const NO_FAMILY_LABELS = ['pas de famille']

export function isWithoutFamily(value: string): boolean {
  const normalized = String(value ?? '')
    .trim()
    .toLocaleLowerCase('fr')

  return isEmptyValue(normalized) || NO_FAMILY_LABELS.includes(normalized)
}

export function getRequiredMappingKeys(view: ProductViewId): Array<keyof ColumnMapping> {
  switch (view) {
    case 'withoutStock':
      return ['stock']
    case 'withoutPrice':
      return ['salePrice']
    case 'withStockAndPrice':
      return ['stock', 'salePrice']
    case 'withoutFamily':
      return ['family']
    default:
      return []
  }
}

export function isViewAvailable(view: ProductViewId, mapping: ColumnMapping): boolean {
  return getRequiredMappingKeys(view).every((key) => Boolean(mapping[key]))
}

export function rowMatchesProductView(
  row: CsvRow,
  view: ProductViewId,
  mapping: ColumnMapping,
): boolean {
  if (view === 'all') return true
  if (!isViewAvailable(view, mapping)) return false

  const stock = mapping.stock ? parseLocalizedNumber(row[mapping.stock]) : null
  const salePrice = mapping.salePrice ? parseLocalizedNumber(row[mapping.salePrice]) : null

  switch (view) {
    case 'withoutStock':
      return stock === null || stock <= 0
    case 'withoutPrice':
      return salePrice === null || salePrice <= 0
    case 'withStockAndPrice':
      return stock !== null && stock > 0 && salePrice !== null && salePrice > 0
    case 'withoutFamily':
      return isWithoutFamily(row[mapping.family])
    default:
      return true
  }
}

export function getProductViewRows(
  rows: CsvRow[],
  view: ProductViewId,
  mapping: ColumnMapping,
): CsvRow[] {
  return rows.filter((row) => rowMatchesProductView(row, view, mapping))
}
