import { normalizeMatchValue } from '@/lib/catalog-columns'
import { COL, type MasterRow } from '@/lib/shopcaisse-columns'

export type IdentityRule = 'Identifiant' | 'Référence' | 'Nom + Code barre'

export const IDENTITY_RULES: readonly IdentityRule[] = ['Identifiant', 'Référence', 'Nom + Code barre']

export interface IdentityKey {
  rule: IdentityRule
  key: string
}

export interface IdentityIndex<T> {
  buckets: Map<IdentityRule, Map<string, T[]>>
}

export type MatchOutcome<T> =
  | { status: 'matched'; item: T; rule: IdentityRule }
  | { status: 'ambiguous'; items: T[]; rule: IdentityRule }
  | { status: 'new' }

export interface Conflict {
  /** Index 0-based dans la liste maître. */
  row: number
  rule: IdentityRule
  value: string
  relatedRows: number[]
}

/**
 * Clé « Nom + Code barre ».
 *
 * Les deux valeurs sont exigées : un nom seul n'identifie pas un produit. Le
 * séparateur `\u0000` ne peut pas apparaître dans une valeur normalisée ; avec
 * un espace, « vase » + « 12 » et « vase 1 » + « 2 » donneraient la même clé et
 * fusionneraient deux produits distincts.
 */
/**
 * Un code-barres qui n'identifie rien renvoie `''`.
 *
 * ShopCaisse écrit « [] » quand un produit n'a pas de code-barres — un tableau
 * vide sérialisé, présent sur ~150 des ~2200 produits. Ce n'est pas une valeur :
 * la lire comme telle ferait passer pour doublons tous les produits qui
 * partagent un nom générique (« Recharge », « Torchon »…) sans code-barres.
 * On exige donc au moins un caractère alphanumérique.
 */
function realBarcode(row: MasterRow): string {
  const barcode = normalizeMatchValue(row[COL.codeBarre])
  return /[a-z0-9]/.test(barcode) ? barcode : ''
}

function hasIdentifiant(row: MasterRow): boolean {
  return normalizeMatchValue(row[COL.identifiant]) !== ''
}

function nameBarcodeKey(row: MasterRow): string {
  const name = normalizeMatchValue(row[COL.nom])
  const barcode = realBarcode(row)
  if (!name || !barcode) return ''
  return `${name}\u0000${barcode}`
}

/** Les clés renseignées de la ligne, dans l'ordre de priorité de la consigne. */
export function identityKeys(row: MasterRow): IdentityKey[] {
  const candidates: IdentityKey[] = [
    { rule: 'Identifiant', key: normalizeMatchValue(row[COL.identifiant]) },
    { rule: 'Référence', key: normalizeMatchValue(row[COL.reference]) },
    { rule: 'Nom + Code barre', key: nameBarcodeKey(row) },
  ]
  // Une valeur vide n'identifie personne : deux produits sans référence ne sont
  // pas le même produit.
  return candidates.filter((candidate) => candidate.key !== '')
}

export function buildIdentityIndex<T>(entries: Array<{ row: MasterRow; item: T }>): IdentityIndex<T> {
  const buckets = new Map<IdentityRule, Map<string, T[]>>(
    IDENTITY_RULES.map((rule) => [rule, new Map<string, T[]>()]),
  )

  for (const entry of entries) {
    for (const { rule, key } of identityKeys(entry.row)) {
      const bucket = buckets.get(rule)!
      const existing = bucket.get(key)
      if (existing) existing.push(entry.item)
      else bucket.set(key, [entry.item])
    }
  }

  return { buckets }
}

/**
 * Cherche la ligne maître correspondante.
 *
 * Plusieurs candidats sur une règle => « ambiguous » : l'application ne choisit
 * pas à la place de l'utilisateur et ne fusionne jamais deux lignes.
 */
export function matchRow<T>(index: IdentityIndex<T>, row: MasterRow): MatchOutcome<T> {
  for (const { rule, key } of identityKeys(row)) {
    const items = index.buckets.get(rule)?.get(key)
    if (!items?.length) continue
    if (items.length > 1) return { status: 'ambiguous', items, rule }
    return { status: 'matched', item: items[0], rule }
  }

  return { status: 'new' }
}

/**
 * Les collisions à l'intérieur du maître lui-même : deux lignes qui, selon une
 * règle d'identification, désignent le même produit. Signalées, jamais fusionnées.
 */
export function findConflicts(rows: MasterRow[]): Conflict[] {
  const conflicts: Conflict[] = []

  for (const rule of IDENTITY_RULES) {
    const byKey = new Map<string, number[]>()

    rows.forEach((row, index) => {
      const key = identityKeys(row).find((candidate) => candidate.rule === rule)?.key
      if (!key) return
      const bucket = byKey.get(key)
      if (bucket) bucket.push(index)
      else byKey.set(key, [index])
    })

    for (const [, indexes] of byKey) {
      if (indexes.length < 2) continue

      // La Référence est une clé fournisseur non unique : une même référence
      // couvre parfois plusieurs déclinaisons. Deux produits qui ont chacun leur
      // Identifiant ShopCaisse ne sont pas ambigus (ShopCaisse réimporte par
      // Identifiant), donc on ne bloque pas. On ne signale que si au moins une
      // ligne du groupe n'a pas d'Identifiant : son identité repose alors sur la
      // Référence, et le partage la rend indistinguable.
      if (rule === 'Référence' && indexes.every((index) => hasIdentifiant(rows[index]))) continue

      for (const index of indexes) {
        conflicts.push({
          row: index,
          rule,
          value: displayValue(rows[index], rule),
          relatedRows: indexes.filter((other) => other !== index),
        })
      }
    }
  }

  // Par ligne puis par règle : l'utilisateur lit la page Comparer dans l'ordre
  // du tableau, pas dans l'ordre des règles.
  return conflicts.sort((a, b) => a.row - b.row || IDENTITY_RULES.indexOf(a.rule) - IDENTITY_RULES.indexOf(b.rule))
}

/** La valeur telle qu'elle est saisie, pas sa forme normalisée : c'est ce que l'utilisateur doit reconnaître. */
function displayValue(row: MasterRow, rule: IdentityRule): string {
  if (rule === 'Identifiant') return String(row[COL.identifiant] ?? '')
  if (rule === 'Référence') return String(row[COL.reference] ?? '')
  return `${row[COL.nom] ?? ''} / ${row[COL.codeBarre] ?? ''}`
}
