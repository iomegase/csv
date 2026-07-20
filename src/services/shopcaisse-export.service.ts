import {
  COL,
  PRODUCT_COLUMNS,
  toStockVisualisationRow,
  type MasterRow,
  type StockVisualisationRow,
} from '@/lib/shopcaisse-columns'
import { readStockCell } from '@/lib/shopcaisse-stock'
import { serializeCsvValue } from '@/services/catalog-export.service'
import { normalizeSupprime } from '@/services/shopcaisse-master.service'
import type { MasterEntry } from '@/services/shopcaisse-master.service'

export const PRODUCTS_FILE_NAME = 'export-produits.csv'
export const STOCK_FILE_NAME = 'export-stock.csv'

/** Les colonnes comparées entre les deux fichiers pour prouver l'alignement. */
const ALIGNED_COLUMNS: readonly string[] = [COL.identifiant, COL.reference, COL.nom]

export interface AlignmentIssue {
  /** Numéro de ligne produit, 1-based, en-tête exclu. */
  row: number
  column: string
  product: string
  stock: string
}

/**
 * Les lignes de `export-produits.csv`.
 *
 * Aucun filtre, aucun tri : `entries` est la liste maître, et c'est elle seule
 * qui fixe le nombre de lignes et leur ordre dans les deux fichiers. Une ligne
 * marquée supprimée reste présente — c'est justement ce marquage que ShopCaisse
 * doit lire.
 */
export function buildProductRows(entries: MasterEntry[]): MasterRow[] {
  return entries.map((entry) => {
    const row: MasterRow = {}
    for (const column of PRODUCT_COLUMNS) row[column] = entry.row[column] ?? null
    // ShopCaisse n'accepte que du binaire ici ; « Oui »/« Non » n'existe qu'à l'écran.
    row[COL.supprime] = normalizeSupprime(entry.row[COL.supprime])
    return row
  })
}

/**
 * Les lignes de `export-stock.csv`, dans le même ordre et en même nombre.
 *
 * La ligne source importée est conservée. Les données communes suivent la
 * version courante du produit, et `En stock` porte la cible quand elle existe.
 */
export function buildStockRows(entries: MasterEntry[]): StockVisualisationRow[] {
  return entries.map((entry) => {
    const row = toStockVisualisationRow(entry.stockRow ?? {})
    const target = readStockCell(entry.row[COL.stockSouhaite])

    row[COL.identifiant] = entry.row[COL.identifiant] ?? null
    row[COL.nom] = entry.row[COL.nom] ?? null
    row[COL.reference] = entry.row[COL.reference] ?? null
    row[COL.enStock] = target.kind === 'number'
      ? entry.row[COL.stockSouhaite]
      : entry.row[COL.stockActuel] ?? row[COL.enStock]
    row[COL.prixAchatHt] = entry.row[COL.prixAchat] ?? row[COL.prixAchatHt]
    row[COL.prixParDefaut] = entry.row[COL.prixTtc] ?? row[COL.prixParDefaut]
    row[COL.fournisseur] = entry.row[COL.fournisseur] ?? row[COL.fournisseur]
    row[COL.famille] = entry.row[COL.famille] ?? row[COL.famille]

    return row
  })
}

/**
 * Vérifie que la ligne `i` des deux fichiers décrit bien le même produit.
 *
 * Les deux listes viennent de la même source, donc ce contrôle devrait toujours
 * passer. Il est là précisément pour cela : si un futur filtre ou tri se glisse
 * d'un seul côté, l'export s'arrête au lieu d'envoyer à ShopCaisse des
 * mouvements attribués aux mauvais produits.
 */
export function checkAlignment(productRows: MasterRow[], stockRows: MasterRow[]): AlignmentIssue[] {
  if (productRows.length !== stockRows.length) {
    return [
      {
        row: Math.min(productRows.length, stockRows.length) + 1,
        column: 'Nombre de lignes',
        product: String(productRows.length),
        stock: String(stockRows.length),
      },
    ]
  }

  const issues: AlignmentIssue[] = []

  productRows.forEach((productRow, index) => {
    for (const column of ALIGNED_COLUMNS) {
      const product = productRow[column] ?? ''
      const stock = stockRows[index][column] ?? ''
      if (product !== stock) {
        issues.push({ row: index + 1, column, product, stock })
      }
    }
  })

  return issues
}

/** CSV ShopCaisse : BOM UTF-8, séparateur `;`, fins de ligne CRLF. */
export function serializeCsv(columns: readonly string[], rows: MasterRow[]): string {
  const lines = [columns.map((column) => serializeCsvValue(column, ';')).join(';')]

  for (const row of rows) {
    lines.push(columns.map((column) => serializeCsvValue(row[column], ';')).join(';'))
  }

  return `﻿${lines.join('\r\n')}\r\n`
}
