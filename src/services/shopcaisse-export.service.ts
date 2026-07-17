import { COL, PRODUCT_COLUMNS, type MasterRow } from '@/lib/shopcaisse-columns'
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
 * `Quantité` porte le **mouvement**, pas le stock souhaité : ShopCaisse ajoute
 * la valeur reçue au stock existant. Y mettre la cible doublerait les quantités.
 */
export function buildStockRows(entries: MasterEntry[]): MasterRow[] {
  return entries.map((entry) => ({
    [COL.identifiant]: entry.row[COL.identifiant] ?? null,
    [COL.reference]: entry.row[COL.reference] ?? null,
    [COL.nom]: entry.row[COL.nom] ?? null,
    // Un mouvement vide reste vide : « 0 » affirmerait « ne rien changer »,
    // alors qu'on ne sait pas ce qu'il faut faire.
    [COL.quantite]: entry.row[COL.mouvementStock] ?? null,
  }))
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
