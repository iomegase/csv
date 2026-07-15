import { describe, expect, it } from 'vitest'
import { detectIdentityMapping, nameSupplierKey, normalizeMatchValue } from '@/lib/catalog-columns'

describe('detectIdentityMapping', () => {
  it('reconnaît les en-têtes ShopCaisse', () => {
    const mapping = detectIdentityMapping([
      'Identifiant',
      'Nom',
      'Famille',
      'Fournisseur',
      'Référence',
      'Code barre',
    ])

    expect(mapping).toEqual({
      shopcaisseId: 'Identifiant',
      reference: 'Référence',
      barcode: 'Code barre',
      name: 'Nom',
      supplier: 'Fournisseur',
    })
  })

  it("laisse vide ce qui est absent plutôt que de deviner", () => {
    const mapping = detectIdentityMapping(['Nom', 'Prix de vente'])

    expect(mapping.name).toBe('Nom')
    expect(mapping.barcode).toBe('')
    expect(mapping.supplier).toBe('')
    expect(mapping.shopcaisseId).toBe('')
  })
})

describe('normalizeMatchValue', () => {
  it('replie casse, accents et espaces', () => {
    expect(normalizeMatchValue('  Vase   Décoratif ')).toBe('vase decoratif')
    expect(normalizeMatchValue('VASE DECORATIF')).toBe('vase decoratif')
  })

  it('rend une chaîne vide pour les valeurs absentes', () => {
    expect(normalizeMatchValue(null)).toBe('')
    expect(normalizeMatchValue(undefined)).toBe('')
    expect(normalizeMatchValue('   ')).toBe('')
  })

  it('conserve les nombres sous forme de chaîne', () => {
    expect(normalizeMatchValue(3700000000001)).toBe('3700000000001')
  })
})

describe('nameSupplierKey', () => {
  it('ne fait pas collisionner un nom long avec un fournisseur court', () => {
    // Avec un espace comme séparateur, ces deux paires donneraient la même clé
    // et fusionneraient deux produits distincts (D4).
    expect(nameSupplierKey('Vase', 'Decoratif A')).not.toBe(nameSupplierKey('Vase Decoratif', 'A'))
  })

  it('rend une clé vide si le nom ou le fournisseur manque', () => {
    expect(nameSupplierKey('Vase', null)).toBe('')
    expect(nameSupplierKey(null, 'Fournisseur A')).toBe('')
  })
})
