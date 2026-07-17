import { describe, expect, it } from 'vitest'
import { COL, makeEmptyMasterRow } from '@/lib/shopcaisse-columns'
import type { MasterEntry } from '@/services/shopcaisse-master.service'
import { validateMasterEntries } from '@/services/shopcaisse-validation.service'

function entry(id: string, values: Record<string, string | null>): MasterEntry {
  return { id, row: { ...makeEmptyMasterRow(), [COL.supprime]: '0', ...values } }
}

/** Un produit existant complet : sert de ligne « saine » de référence. */
function existing(id: string, values: Record<string, string | null> = {}): MasterEntry {
  return entry(id, { [COL.identifiant]: id, [COL.reference]: `REF-${id}`, [COL.nom]: `Produit ${id}`, ...values })
}

describe('validateMasterEntries — cas sain', () => {
  it('autorise l’export et déclare l’alignement conforme', () => {
    const result = validateMasterEntries([existing('1'), existing('2')])
    expect(result.canExport).toBe(true)
    expect(result.blockers).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.summary.alignment).toBe('Conforme')
    expect(result.summary.sameRowCount).toBe(true)
    expect(result.summary.productRowCount).toBe(2)
    expect(result.summary.stockRowCount).toBe(2)
  })
})

describe('validateMasterEntries — résumé', () => {
  it('compte les produits, existants, nouveaux sans Identifiant et supprimés', () => {
    const result = validateMasterEntries([
      existing('1'),
      existing('2', { [COL.supprime]: '1' }),
      entry('c', { [COL.reference]: 'REF-N', [COL.nom]: 'Nouveau', [COL.stockSouhaite]: '3' }),
    ])
    expect(result.summary.total).toBe(3)
    expect(result.summary.existing).toBe(2)
    expect(result.summary.newWithoutId).toBe(1)
    expect(result.summary.deleted).toBe(1)
  })

  it('compte les mouvements positifs, négatifs, nuls et vides', () => {
    const result = validateMasterEntries([
      existing('1', { [COL.mouvementStock]: '3' }),
      existing('2', { [COL.mouvementStock]: '-3' }),
      existing('3', { [COL.mouvementStock]: '0' }),
      existing('4'),
    ])
    expect(result.summary.movementsPositive).toBe(1)
    expect(result.summary.movementsNegative).toBe(1)
    expect(result.summary.movementsZero).toBe(1)
    expect(result.summary.movementsEmpty).toBe(1)
  })
})

describe('validateMasterEntries — nouveaux produits', () => {
  const NEW_OK = { [COL.reference]: 'REF-N', [COL.nom]: 'Nouveau', [COL.stockSouhaite]: '3' }

  it('accepte un nouveau produit à Identifiant vide et Référence unique', () => {
    const result = validateMasterEntries([existing('1'), entry('c', NEW_OK)])
    expect(result.canExport).toBe(true)
    expect(result.summary.newWithoutId).toBe(1)
  })

  it('bloque un nouveau produit sans Référence', () => {
    const result = validateMasterEntries([entry('c', { [COL.nom]: 'Nouveau', [COL.stockSouhaite]: '3' })])
    expect(result.canExport).toBe(false)
    expect(result.blockers[0].reason).toBe('Référence obligatoire pour un nouveau produit.')
  })

  it('bloque un nouveau produit sans Nom', () => {
    const result = validateMasterEntries([entry('c', { [COL.reference]: 'REF-N', [COL.stockSouhaite]: '3' })])
    expect(result.canExport).toBe(false)
    expect(result.blockers.map((b) => b.reason)).toContain('Nom obligatoire pour un nouveau produit.')
  })

  it('bloque un nouveau produit dont la Référence est déjà prise', () => {
    const result = validateMasterEntries([existing('1', { [COL.reference]: 'REF-N' }), entry('c', NEW_OK)])
    expect(result.canExport).toBe(false)
    expect(result.conflicts.some((c) => c.rule === 'Référence')).toBe(true)
  })

  it('bloque un nouveau produit dont le Stock souhaité est vide', () => {
    const result = validateMasterEntries([entry('c', { [COL.reference]: 'REF-N', [COL.nom]: 'Nouveau' })])
    expect(result.canExport).toBe(false)
    expect(result.blockers[0].reason).toBe('Stock souhaité obligatoire et strictement positif pour un nouveau produit.')
  })

  it('bloque un nouveau produit dont le Stock souhaité est nul', () => {
    const result = validateMasterEntries([entry('c', { ...NEW_OK, [COL.stockSouhaite]: '0' })])
    expect(result.canExport).toBe(false)
    expect(result.blockers).toHaveLength(1)
  })

  it('bloque un nouveau produit dont le Stock souhaité est négatif', () => {
    const result = validateMasterEntries([entry('c', { ...NEW_OK, [COL.stockSouhaite]: '-2' })])
    expect(result.canExport).toBe(false)
    expect(result.blockers).toHaveLength(1)
  })

  it('n’impose pas de stock souhaité à un produit existant', () => {
    expect(validateMasterEntries([existing('1')]).canExport).toBe(true)
  })
})

describe('validateMasterEntries — stocks illisibles', () => {
  it('bloque une valeur de stock non numérique', () => {
    const result = validateMasterEntries([existing('1', { [COL.stockActuel]: 'beaucoup' })])
    expect(result.canExport).toBe(false)
    expect(result.blockers[0].reason).toBe('Stock actuel non numérique : « beaucoup ».')
  })
})

describe('validateMasterEntries — doublons et ambiguïtés', () => {
  it('détecte un doublon d’Identifiant et bloque l’export', () => {
    const result = validateMasterEntries([
      entry('a', { [COL.identifiant]: '42', [COL.reference]: 'REF-1', [COL.nom]: 'A' }),
      entry('b', { [COL.identifiant]: '42', [COL.reference]: 'REF-2', [COL.nom]: 'B' }),
    ])
    expect(result.canExport).toBe(false)
    expect(result.summary.duplicates).toBe(2)
    expect(result.conflicts[0]).toMatchObject({ row: 1, rule: 'Identifiant', relatedRows: [2] })
    expect(result.conflicts[0].reason).toContain('Identifiant')
  })

  it('détecte un doublon de Référence', () => {
    const result = validateMasterEntries([
      entry('a', { [COL.reference]: 'REF-1', [COL.nom]: 'A', [COL.stockSouhaite]: '1' }),
      entry('b', { [COL.reference]: 'REF-1', [COL.nom]: 'B', [COL.stockSouhaite]: '1' }),
    ])
    expect(result.canExport).toBe(false)
    expect(result.conflicts.map((c) => c.rule)).toEqual(['Référence', 'Référence'])
  })

  it('détecte une correspondance ambiguë sur Nom + Code barre', () => {
    const result = validateMasterEntries([
      existing('1', { [COL.identifiant]: '1', [COL.nom]: 'Café', [COL.codeBarre]: '111' }),
      existing('2', { [COL.identifiant]: '2', [COL.nom]: 'café', [COL.codeBarre]: '111' }),
    ])
    expect(result.canExport).toBe(false)
    expect(result.summary.ambiguous).toBe(2)
  })

  it('donne à chaque conflit la ligne, l’Identifiant, la Référence, le Nom et les lignes liées', () => {
    const result = validateMasterEntries([
      entry('a', { [COL.identifiant]: '42', [COL.reference]: 'REF-1', [COL.nom]: 'A' }),
      entry('b', { [COL.identifiant]: '42', [COL.reference]: 'REF-2', [COL.nom]: 'B' }),
    ])
    expect(result.conflicts[0]).toMatchObject({
      row: 1,
      id: 'a',
      identifiant: '42',
      reference: 'REF-1',
      nom: 'A',
      relatedRows: [2],
    })
  })
})
