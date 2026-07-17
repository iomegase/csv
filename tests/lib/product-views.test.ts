import { describe, expect, it } from 'vitest'
import { detectColumnMapping, rowMatchesProductView, type ColumnMapping } from '@/lib/product-views'
import { MASTER_COLUMNS } from '@/lib/shopcaisse-columns'

describe('detectColumnMapping — colonnes du tableau maître ShopCaisse', () => {
  const mapping = detectColumnMapping([...MASTER_COLUMNS])

  it('reconnaît « Stock actuel » comme colonne de stock', () => {
    expect(mapping.stock).toBe('Stock actuel')
  })

  it('reconnaît « PRIX TTC … » comme prix de vente', () => {
    expect(mapping.salePrice).toBe('PRIX TTC - Défaut - Mon Magasin Caisse 1')
  })

  it('ne prend pas « Prix d’achat » pour le prix de vente', () => {
    expect(mapping.salePrice).not.toBe("Prix d'achat")
  })

  it('reconnaît « Fournisseur » comme colonne fournisseur', () => {
    expect(mapping.supplier).toBe('Fournisseur')
  })
})

describe('rowMatchesProductView — sans fournisseur', () => {
  const mapping: ColumnMapping = {
    name: 'Nom',
    stock: 'Stock actuel',
    salePrice: 'Prix',
    family: 'Famille',
    supplier: 'Fournisseur',
  }

  it.each(['', 'Pas de fournisseur', 'PAS DE FOURNISSEUR'])(
    'classe « %s » en Sans fournisseur',
    (fournisseur) => {
      expect(rowMatchesProductView({ Nom: 'X', Fournisseur: fournisseur }, 'withoutSupplier', mapping)).toBe(true)
    },
  )

  it('ne classe pas un produit avec un vrai fournisseur en Sans fournisseur', () => {
    expect(
      rowMatchesProductView({ Nom: 'X', Fournisseur: 'Moulin roty' }, 'withoutSupplier', mapping),
    ).toBe(false)
  })
})

describe('rowMatchesProductView — prix et stock ≤ 0 comptent comme absents', () => {
  const mapping: ColumnMapping = { name: 'Nom', stock: 'Stock actuel', salePrice: 'Prix', family: 'Famille', supplier: 'Fournisseur' }
  const rowWith = (stock: string, prix: string) => ({ Nom: 'X', 'Stock actuel': stock, Prix: prix, Famille: 'F', Fournisseur: 'Moulin roty' })

  it.each(['0', '-3', ''])('classe un prix « %s » en Sans prix', (prix) => {
    expect(rowMatchesProductView(rowWith('5', prix), 'withoutPrice', mapping)).toBe(true)
  })

  it.each(['0', '-3', ''])('classe un stock « %s » en Sans stock', (stock) => {
    expect(rowMatchesProductView(rowWith(stock, '5'), 'withoutStock', mapping)).toBe(true)
  })

  it('un prix et un stock strictement positifs ne sont ni sans prix ni sans stock', () => {
    expect(rowMatchesProductView(rowWith('5', '9'), 'withoutPrice', mapping)).toBe(false)
    expect(rowMatchesProductView(rowWith('5', '9'), 'withoutStock', mapping)).toBe(false)
  })

  it('« stock, prix et fournisseur » exige aussi un fournisseur', () => {
    // Stock + prix positifs ET un fournisseur renseigné.
    expect(rowMatchesProductView(rowWith('5', '9'), 'withStockAndPrice', mapping)).toBe(true)
    // Même stock et prix, mais sans fournisseur : exclu.
    expect(
      rowMatchesProductView(
        { Nom: 'X', 'Stock actuel': '5', Prix: '9', Fournisseur: 'Pas de fournisseur' },
        'withStockAndPrice',
        mapping,
      ),
    ).toBe(false)
  })
})
