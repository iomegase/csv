import { describe, expect, it } from 'vitest'
import { COL, makeEmptyMasterRow, type MasterRow } from '@/lib/shopcaisse-columns'
import { buildIdentityIndex, findConflicts, identityKeys, matchRow } from '@/lib/shopcaisse-identity'

function row(values: Partial<Record<string, string>>): MasterRow {
  return { ...makeEmptyMasterRow(), ...values }
}

describe('identityKeys', () => {
  it('donne les trois règles dans l\'ordre de priorité quand tout est renseigné', () => {
    const keys = identityKeys(
      row({ [COL.identifiant]: '42', [COL.reference]: 'REF-001', [COL.nom]: 'Café', [COL.codeBarre]: '376' }),
    )
    expect(keys.map((k) => k.rule)).toEqual(['Identifiant', 'Référence', 'Nom + Code barre'])
  })

  it('ignore une règle dont la valeur est vide', () => {
    const keys = identityKeys(row({ [COL.reference]: 'REF-001' }))
    expect(keys.map((k) => k.rule)).toEqual(['Référence'])
  })

  it('n\'ouvre pas la règle Nom + Code barre si le code-barres manque', () => {
    const keys = identityKeys(row({ [COL.nom]: 'Café' }))
    expect(keys).toEqual([])
  })

  it('normalise casse et accents', () => {
    const a = identityKeys(row({ [COL.reference]: '  Réf-001 ' }))
    const b = identityKeys(row({ [COL.reference]: 'ref-001' }))
    expect(a[0].key).toBe(b[0].key)
  })
})

describe('matchRow', () => {
  it('apparie par Identifiant en priorité', () => {
    const index = buildIdentityIndex([
      { row: row({ [COL.identifiant]: '42', [COL.reference]: 'REF-ANCIENNE' }), item: 'a' },
      { row: row({ [COL.reference]: 'REF-001' }), item: 'b' },
    ])
    const outcome = matchRow(index, row({ [COL.identifiant]: '42', [COL.reference]: 'REF-001' }))
    expect(outcome).toEqual({ status: 'matched', item: 'a', rule: 'Identifiant' })
  })

  it('apparie par Référence quand l\'Identifiant est vide', () => {
    const index = buildIdentityIndex([{ row: row({ [COL.reference]: 'REF-001' }), item: 'a' }])
    const outcome = matchRow(index, row({ [COL.reference]: 'REF-001', [COL.nom]: 'Café' }))
    expect(outcome).toEqual({ status: 'matched', item: 'a', rule: 'Référence' })
  })

  it('apparie par Nom + Code barre en dernier recours', () => {
    const index = buildIdentityIndex([
      { row: row({ [COL.nom]: 'Café Latte', [COL.codeBarre]: '3760001000001' }), item: 'a' },
    ])
    const outcome = matchRow(index, row({ [COL.nom]: 'café latte', [COL.codeBarre]: '3760001000001' }))
    expect(outcome).toEqual({ status: 'matched', item: 'a', rule: 'Nom + Code barre' })
  })

  it('renvoie « new » quand rien ne correspond', () => {
    const index = buildIdentityIndex([{ row: row({ [COL.reference]: 'REF-001' }), item: 'a' }])
    expect(matchRow(index, row({ [COL.reference]: 'REF-999' }))).toEqual({ status: 'new' })
  })

  it('renvoie « ambiguous » plutôt que de choisir entre deux candidats', () => {
    const index = buildIdentityIndex([
      { row: row({ [COL.reference]: 'REF-001', [COL.nom]: 'Café' }), item: 'a' },
      { row: row({ [COL.reference]: 'REF-001', [COL.nom]: 'Thé' }), item: 'b' },
    ])
    expect(matchRow(index, row({ [COL.reference]: 'REF-001' }))).toEqual({
      status: 'ambiguous',
      items: ['a', 'b'],
      rule: 'Référence',
    })
  })

  it('n\'apparie pas deux lignes sur une valeur vide partagée', () => {
    const index = buildIdentityIndex([{ row: row({ [COL.nom]: 'Café' }), item: 'a' }])
    expect(matchRow(index, row({ [COL.nom]: 'Thé' }))).toEqual({ status: 'new' })
  })
})

describe('findConflicts', () => {
  it('ne signale rien sur un maître sain', () => {
    expect(
      findConflicts([
        row({ [COL.identifiant]: '1', [COL.reference]: 'REF-001' }),
        row({ [COL.identifiant]: '2', [COL.reference]: 'REF-002' }),
      ]),
    ).toEqual([])
  })

  it('détecte deux lignes partageant le même Identifiant', () => {
    const conflicts = findConflicts([
      row({ [COL.identifiant]: '1', [COL.reference]: 'REF-001' }),
      row({ [COL.identifiant]: '1', [COL.reference]: 'REF-002' }),
    ])
    expect(conflicts).toEqual([
      { row: 0, rule: 'Identifiant', value: '1', relatedRows: [1] },
      { row: 1, rule: 'Identifiant', value: '1', relatedRows: [0] },
    ])
  })

  it('détecte deux lignes partageant la même Référence', () => {
    const conflicts = findConflicts([
      row({ [COL.reference]: 'REF-001', [COL.nom]: 'Café' }),
      row({ [COL.reference]: 'REF-001', [COL.nom]: 'Thé' }),
    ])
    expect(conflicts.map((c) => c.rule)).toEqual(['Référence', 'Référence'])
  })

  it('détecte deux lignes partageant le même Nom + Code barre', () => {
    const conflicts = findConflicts([
      row({ [COL.nom]: 'Café', [COL.codeBarre]: '376' }),
      row({ [COL.nom]: 'café', [COL.codeBarre]: '376' }),
    ])
    expect(conflicts.map((c) => c.rule)).toEqual(['Nom + Code barre', 'Nom + Code barre'])
  })

  it('ne signale pas deux lignes dont l\'Identifiant est vide', () => {
    expect(findConflicts([row({ [COL.reference]: 'A' }), row({ [COL.reference]: 'B' })])).toEqual([])
  })
})
