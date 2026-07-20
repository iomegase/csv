import { describe, expect, it } from 'vitest'
import { COL, PRODUCT_COLUMNS, STOCK_COLUMNS, makeEmptyMasterRow, type MasterRow } from '@/lib/shopcaisse-columns'
import type { MasterEntry } from '@/services/shopcaisse-master.service'
import {
  buildProductRows,
  buildStockRows,
  checkAlignment,
  serializeCsv,
} from '@/services/shopcaisse-export.service'

function entry(
  id: string,
  values: Record<string, string | null>,
  stockRow: Record<string, string | null> | null = null,
): MasterEntry {
  return { id, row: { ...makeEmptyMasterRow(), [COL.supprime]: '0', ...values }, stockRow }
}

/** Les lignes de données du CSV, en-tête et BOM retirés. */
function dataLines(csv: string): string[] {
  return csv.replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean)
}

describe('buildProductRows', () => {
  it('produit les 19 colonnes ShopCaisse dans l’ordre', () => {
    const csv = serializeCsv(PRODUCT_COLUMNS, buildProductRows([entry('a', { [COL.nom]: 'Café' })]))
    expect(csv.replace(/^﻿/, '').split('\n')[0]).toBe(PRODUCT_COLUMNS.join(';'))
  })

  it('n’expose jamais les colonnes internes de stock', () => {
    const csv = serializeCsv(
      PRODUCT_COLUMNS,
      buildProductRows([entry('a', { [COL.nom]: 'Café', [COL.stockActuel]: '5', [COL.mouvementStock]: '3' })]),
    )
    expect(csv).not.toContain('Stock actuel')
    expect(csv).not.toContain('Stock souhaité')
    expect(csv).not.toContain('Mouvement stock')
  })

  it('reproduit la ligne d’exemple de la consigne', () => {
    const rows = buildProductRows([
      entry('a', {
        [COL.nom]: 'Café Latte',
        [COL.famille]: 'Boissons',
        [COL.rangs]: 'Entrée',
        [COL.fournisseur]: 'Fournisseur A',
        [COL.tvaSurPlace]: '20.0',
        [COL.tvaAEmporter]: '10.0',
        [COL.type]: 'SIMPLE',
        [COL.codeBarre]: '3760001000001',
        [COL.reference]: 'REF-001',
        [COL.description]: 'Un café latte onctueux',
        [COL.unite]: 'UNIT',
        [COL.prixAchat]: '2.50',
        [COL.gestionStock]: '1',
        [COL.affichageStock]: '1',
        [COL.couleurFond]: '#190fa7',
        [COL.texteBouton]: 'Dessert',
        [COL.supprime]: '0',
      }),
    ])
    expect(dataLines(serializeCsv(PRODUCT_COLUMNS, rows))[0]).toBe(
      ';Café Latte;Boissons;Entrée;Fournisseur A;20.0;10.0;SIMPLE;3760001000001;REF-001;Un café latte onctueux;UNIT;1;1;;#190fa7;Dessert;0;2.50',
    )
  })

  it('exporte Supprimé en binaire, jamais en Oui/Non', () => {
    const csv = serializeCsv(PRODUCT_COLUMNS, buildProductRows([
      entry('a', { [COL.nom]: 'A', [COL.supprime]: 'Oui' }),
      entry('b', { [COL.nom]: 'B', [COL.supprime]: 'Non' }),
    ]))
    expect(csv).not.toMatch(/;Oui/)
    expect(csv).not.toMatch(/;Non/)
    expect(dataLines(csv)[0].split(';')[17]).toBe('1')
    expect(dataLines(csv)[1].split(';')[17]).toBe('0')
  })

  it('conserve la ligne d’un produit marqué supprimé', () => {
    const rows = buildProductRows([entry('a', { [COL.nom]: 'Café', [COL.supprime]: '1' })])
    expect(rows).toHaveLength(1)
  })

  it('conserve les cellules vides', () => {
    const line = dataLines(serializeCsv(PRODUCT_COLUMNS, buildProductRows([entry('a', { [COL.nom]: 'Café' })])))[0]
    expect(line).toBe(';Café;;;;;;;;;;;;;;;;0;')
  })
})

describe('buildStockRows', () => {
  it('produit les 13 colonnes Visualisation des stocks dans l’ordre', () => {
    const csv = serializeCsv(STOCK_COLUMNS, buildStockRows([entry('a', { [COL.nom]: 'Café' })]))
    expect(csv.replace(/^﻿/, '').split('\n')[0]).toBe(STOCK_COLUMNS.join(';'))
  })

  it('conserve la ligne source et exporte Stock souhaité dans En stock', () => {
    const rows = buildStockRows([
      entry(
        'a',
        {
          [COL.identifiant]: '42',
          [COL.reference]: 'REF-001',
          [COL.nom]: 'Café',
          [COL.stockActuel]: '5',
          [COL.stockSouhaite]: '8',
          [COL.prixAchat]: '3,60',
          [COL.prixTtc]: '9,20',
          [COL.fournisseur]: 'Maison B',
          [COL.famille]: 'Boissons',
        },
        {
          Identifiant: '42',
          Nom: 'Ancien café',
          Référence: 'OLD',
          'En stock': '5',
          'Mon Magasin': '5',
          'Réservés client': '1',
          'Réservés fournisseur': '2',
          'Stock effectif': '2',
          "Prix d'achat H.T.": '3,50',
          'Valeur H.T.': '17,50',
          'Prix par défaut': '8,90',
          Fournisseur: 'Maison A',
          Famille: 'Café',
        },
      ),
    ])
    expect(Object.keys(rows[0])).toEqual([...STOCK_COLUMNS])
    expect(rows[0]).toMatchObject({
      Identifiant: '42',
      Nom: 'Café',
      Référence: 'REF-001',
      'En stock': '8',
      'Mon Magasin': '5',
      'Réservés client': '1',
      'Réservés fournisseur': '2',
      'Stock effectif': '2',
      "Prix d'achat H.T.": '3,60',
      'Valeur H.T.': '17,50',
      'Prix par défaut': '9,20',
      Fournisseur: 'Maison B',
      Famille: 'Boissons',
    })
  })

  it('utilise Stock actuel quand Stock souhaité est vide', () => {
    const rows = buildStockRows([entry('a', { [COL.nom]: 'Café', [COL.stockActuel]: '5' })])
    expect(rows[0][COL.enStock]).toBe('5')
  })

  it('laisse les cellules inconnues vides', () => {
    const rows = buildStockRows([entry('a', { [COL.nom]: 'Café' })])
    expect(rows[0][COL.monMagasin]).toBeNull()
    expect(rows[0][COL.reservesClient]).toBeNull()
    expect(rows[0][COL.stockEffectif]).toBeNull()
  })

  it('garde la ligne d’un produit sans Identifiant, Identifiant vide', () => {
    const rows = buildStockRows([entry('a', { [COL.reference]: 'REF-001', [COL.nom]: 'Café' })])
    expect(rows[0][COL.identifiant]).toBeNull()
  })

  it('garde la ligne d’un produit dont Gestion du stock vaut 0', () => {
    const rows = buildStockRows([entry('a', { [COL.nom]: 'Café', [COL.gestionStock]: '0' })])
    expect(rows).toHaveLength(1)
  })
})

describe('alignement des deux exports', () => {
  const entries = [
    entry('a', { [COL.identifiant]: '42', [COL.reference]: 'REF-001', [COL.nom]: 'Café', [COL.mouvementStock]: '3' }),
    entry('b', { [COL.reference]: 'REF-002', [COL.nom]: 'Thé' }),
    entry('c', { [COL.identifiant]: '7', [COL.reference]: 'REF-003', [COL.nom]: 'Vase', [COL.supprime]: '1' }),
  ]

  it('produit le même nombre de lignes dans les deux fichiers', () => {
    expect(buildProductRows(entries)).toHaveLength(3)
    expect(buildStockRows(entries)).toHaveLength(3)
  })

  it('produit le même ordre, le même Identifiant, la même Référence, le même Nom', () => {
    const products = buildProductRows(entries)
    const stock = buildStockRows(entries)
    for (let i = 0; i < products.length; i += 1) {
      expect(stock[i][COL.identifiant]).toBe(products[i][COL.identifiant])
      expect(stock[i][COL.reference]).toBe(products[i][COL.reference])
      expect(stock[i][COL.nom]).toBe(products[i][COL.nom])
    }
  })

  it('ne signale rien quand les deux fichiers concordent', () => {
    expect(checkAlignment(buildProductRows(entries), buildStockRows(entries))).toEqual([])
  })

  it('signale une différence de nombre de lignes', () => {
    const issues = checkAlignment(buildProductRows(entries), buildStockRows(entries.slice(0, 2)))
    expect(issues).toEqual([{ row: 3, column: 'Nombre de lignes', product: '3', stock: '2' }])
  })

  it('signale la ligne et les valeurs divergentes', () => {
    const stock = buildStockRows(entries)
    stock[1][COL.nom] = 'Thé vert'
    const issues = checkAlignment(buildProductRows(entries), stock)
    expect(issues).toEqual([{ row: 2, column: 'Nom', product: 'Thé', stock: 'Thé vert' }])
  })
})

describe('serializeCsv', () => {
  it('écrit un BOM UTF-8', () => {
    expect(serializeCsv(STOCK_COLUMNS, [])).toMatch(/^﻿/)
    expect(Buffer.from(serializeCsv(STOCK_COLUMNS, []), 'utf-8').subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    )
  })

  it('sépare par point-virgule et reproduit les fins de ligne LF des références', () => {
    const csv = serializeCsv(STOCK_COLUMNS, buildStockRows([entry('a', { [COL.nom]: 'Café' })]))
    expect(csv).not.toContain('\r\n')
    expect(csv.replace(/^﻿/, '')).toBe(`${STOCK_COLUMNS.join(';')}\n;Café;;;;;;;;;;;\n`)
  })

  it('échappe une valeur contenant le séparateur', () => {
    const rows: MasterRow[] = [{ [COL.identifiant]: null, [COL.reference]: null, [COL.nom]: 'Café; sucre', [COL.quantite]: null }]
    expect(serializeCsv(STOCK_COLUMNS, rows)).toContain('"Café; sucre"')
  })
})
