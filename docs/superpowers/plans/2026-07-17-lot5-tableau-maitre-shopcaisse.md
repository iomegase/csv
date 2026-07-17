# Tableau maître ShopCaisse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire du catalogue un tableau maître ShopCaisse à 22 colonnes fixes, alimenté par deux imports (produits + stock), et produire à l'export un lot ZIP de deux CSV strictement alignés.

**Architecture:** Le schéma maître (22 colonnes, intitulés figés) devient un module de constantes. L'import ShopCaisse crée/active un `CsvTemplate` portant exactement ces 22 colonnes, si bien que l'UI, la pagination, la recherche et les vues filtrées existantes continuent de fonctionner sans réécriture. `CatalogProduct.csvData` reste la copie de travail ; `originalCsvData` reste le socle de comparaison. Les trois colonnes de stock sont internes au maître et n'apparaissent dans aucun export. Les deux CSV exportés sont construits à partir de la même liste de lignes maître, dans le même ordre, et une validation bloque l'export en cas de désalignement, de doublon ou d'ambiguïté.

**Tech Stack:** Next.js 16 (App Router), React 19, MongoDB/Mongoose 9, Papaparse, Zod 4, Vitest 4, Tailwind 4, jszip (nouvelle dépendance).

## Global Constraints

- **Intitulés de colonnes figés.** Aucune tâche ne réécrit un intitulé à la main : tous viennent de `src/lib/shopcaisse-columns.ts`, lui-même verrouillé par un test qui compare aux fichiers d'exemple réels. Les apostrophes et accents (`Prix d'achat`, `TVA à emporter`, `Unité`, `Supprimé`, `Référence`) doivent être byte-identiques aux fichiers ShopCaisse.
- **Séparateur `;`**, fins de ligne `\r\n`, encodage **UTF-8 avec BOM** pour les deux exports.
- **Ne jamais inventer une valeur.** Une cellule vide reste vide. Elle ne devient jamais `0`, sauf par la règle explicite de la colonne `Supprimé` (§5 de la consigne).
- **Ne jamais supprimer une ligne du maître automatiquement.** La suppression est un marquage (`Supprimé`), jamais un effacement.
- **Ne jamais filtrer ni trier séparément les deux exports.** Une seule liste de lignes maître les alimente tous les deux.
- **Le code-barres est une chaîne.** Jamais de conversion numérique : les zéros de tête sont significatifs.
- **Décisions tranchées avec le pilote (2026-07-17) :**
  - **L5-1 — Deux imports.** `export-produits.csv` ET un fichier stock (`Identifiant;Référence;Nom;Quantité`). La `Quantité` importée alimente **`Stock actuel`** (l'état connu), jamais `Stock souhaité`.
  - **L5-2 — Maître ShopCaisse figé.** Les 22 colonnes sont codées en dur. L'import ShopCaisse crée/active un template portant exactement ces colonnes.
  - **L5-3 — `Supprimé` est la source de vérité**, `CatalogProduct.isDeleted` est tenu en miroir (`isDeleted === (csvData['Supprimé'] === '1')`) pour que la page Comparer garde sa catégorie « supprimés ». Le filtre `isDeleted: false` disparaît de la liste produits.
  - **L5-4 — ZIP via `jszip`.**
- **Portée préservée :** `/api/catalog/export` (route générique existante), `/catalogue`, l'import CSV générique via `/api/csv-templates/from-import` et `catalog-sync.service.ts` restent en place et ne doivent pas régresser.

---

## Structure de fichiers

**Créés :**

| Fichier | Responsabilité |
|---|---|
| `src/lib/shopcaisse-columns.ts` | Les intitulés exacts et les trois listes de colonnes (maître / produits / stock). Aucune logique. |
| `src/lib/shopcaisse-stock.ts` | Lecture d'une cellule de stock, calcul et formatage du mouvement. Pur, sans I/O. |
| `src/lib/shopcaisse-identity.ts` | Stratégie d'identification (Identifiant → Référence → Nom+Code barre) et détection des doublons/ambiguïtés. Pur. |
| `src/services/shopcaisse-master.service.ts` | Template maître, migration des anciennes données, lecture ordonnée des lignes maître. |
| `src/services/shopcaisse-import.service.ts` | `importProductsIntoMaster` et `importStockIntoMaster`. |
| `src/services/shopcaisse-validation.service.ts` | Validation avant export : blocages, conflits, alignement, résumé. |
| `src/services/shopcaisse-export.service.ts` | Construction des lignes des deux CSV, sérialisation, contrôle d'alignement. |
| `src/services/shopcaisse-bundle.service.ts` | Assemblage de l'archive ZIP. Séparé de l'export pour éviter un cycle d'imports avec la validation. |
| `src/app/api/admin/shopcaisse/import/route.ts` | `POST { importId, kind }`. |
| `src/app/api/admin/shopcaisse/export/route.ts` | `GET` → ZIP. |
| `src/app/api/admin/shopcaisse/export-summary/route.ts` | `GET` → résumé + blocages. |
| `src/lib/validations/shopcaisse.schema.ts` | Schémas Zod des routes ci-dessus. |
| `tests/fixtures/shopcaisse/*.csv` | Les trois fichiers d'exemple, versionnés, qui verrouillent les intitulés. |

**Modifiés :** `src/services/catalog-product.service.ts` (retrait du filtre `isDeleted`, miroir `Supprimé`↔`isDeleted`), `src/components/admin/CsvTemplateManager.tsx` (deux zones d'import), `src/components/catalog/CatalogEditor.tsx` (colonnes en lecture seule, bascule Oui/Non, recalcul du mouvement, bouton de lot), `src/components/catalog/CatalogDiffView.tsx` (contrôle « Alignement des exports »), `src/app/api/admin/catalog/diff/route.ts`.

---

### Task 1 : Schéma maître verrouillé par les fichiers d'exemple

**Files:**
- Create: `src/lib/shopcaisse-columns.ts`
- Create: `tests/fixtures/shopcaisse/export-produits.csv` (copie de `docs/shopcaisse-metier/export-produits.csv`)
- Create: `tests/fixtures/shopcaisse/export-stock-modele.csv` (copie de `docs/shopcaisse-metier/ export-stocks-modele.csv`, **espace initial du nom retiré**)
- Create: `tests/fixtures/shopcaisse/fichier-maitre.csv` (copie de `docs/shopcaisse-metier/fichier_maitre_shopcaisse.csv`)
- Test: `tests/lib/shopcaisse-columns.test.ts`

**Interfaces:**
- Consomme : rien.
- Produit : `MASTER_COLUMNS: readonly string[]` (22), `PRODUCT_COLUMNS: readonly string[]` (19), `STOCK_COLUMNS: readonly string[]` (4), `STOCK_INTERNAL_COLUMNS: readonly string[]` (3), l'objet `COL` (accès nommé à chaque intitulé), `makeEmptyMasterRow(): Record<string, string | null>`.

- [ ] **Step 1 : Versionner les fichiers d'exemple comme fixtures**

Les trois fichiers sont aujourd'hui non suivis dans `docs/shopcaisse-metier/`. Ce sont eux qui font autorité sur les intitulés : ils deviennent des fixtures de test.

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
mkdir -p tests/fixtures/shopcaisse
cp "docs/shopcaisse-metier/export-produits.csv" tests/fixtures/shopcaisse/export-produits.csv
cp "docs/shopcaisse-metier/ export-stocks-modele.csv" tests/fixtures/shopcaisse/export-stock-modele.csv
cp "docs/shopcaisse-metier/fichier_maitre_shopcaisse.csv" tests/fixtures/shopcaisse/fichier-maitre.csv
```

- [ ] **Step 2 : Écrire le test qui échoue**

Ce test est le garde-fou central du lot : il compare les constantes aux en-têtes réels, caractère par caractère. Si une apostrophe ou un accent diverge, il tombe.

```ts
// tests/lib/shopcaisse-columns.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  COL,
  MASTER_COLUMNS,
  PRODUCT_COLUMNS,
  STOCK_COLUMNS,
  STOCK_INTERNAL_COLUMNS,
  makeEmptyMasterRow,
} from '@/lib/shopcaisse-columns'

const FIXTURES = join(process.cwd(), 'tests/fixtures/shopcaisse')

/** En-tête réel du fichier, BOM retiré, sans dépendre du parseur. */
function headerOf(fileName: string): string[] {
  const text = readFileSync(join(FIXTURES, fileName), 'utf-8').replace(/^﻿/, '')
  return text.split(/\r?\n/)[0].split(';')
}

describe('shopcaisse-columns', () => {
  it('reprend exactement les intitulés du fichier maître d’exemple', () => {
    expect(MASTER_COLUMNS).toEqual(headerOf('fichier-maitre.csv'))
  })

  it('reprend exactement les intitulés de export-produits.csv', () => {
    expect(PRODUCT_COLUMNS).toEqual(headerOf('export-produits.csv'))
  })

  it('reprend exactement les intitulés du modèle de stock', () => {
    expect(STOCK_COLUMNS).toEqual(headerOf('export-stock-modele.csv'))
  })

  it('compte 22 colonnes maître, 19 produit, 4 stock', () => {
    expect(MASTER_COLUMNS).toHaveLength(22)
    expect(PRODUCT_COLUMNS).toHaveLength(19)
    expect(STOCK_COLUMNS).toHaveLength(4)
  })

  it('n’expose aucune colonne interne de stock dans l’export produits', () => {
    for (const internal of STOCK_INTERNAL_COLUMNS) {
      expect(PRODUCT_COLUMNS).not.toContain(internal)
      expect(STOCK_COLUMNS).not.toContain(internal)
    }
  })

  it('n’ajoute aucune colonne hors du maître dans les exports', () => {
    for (const column of [...PRODUCT_COLUMNS, ...STOCK_COLUMNS]) {
      if (column === COL.quantite) continue // propre au fichier stock
      expect(MASTER_COLUMNS).toContain(column)
    }
  })

  it('donne une ligne maître vide portant les 22 colonnes à null', () => {
    const row = makeEmptyMasterRow()
    expect(Object.keys(row)).toEqual([...MASTER_COLUMNS])
    expect(Object.values(row).every((value) => value === null)).toBe(true)
  })
})
```

- [ ] **Step 3 : Vérifier que le test échoue**

Run: `npx vitest run tests/lib/shopcaisse-columns.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/shopcaisse-columns"`.

- [ ] **Step 4 : Écrire le module**

Les intitulés sont recopiés depuis les fichiers d'exemple. `Prix d'achat` porte une apostrophe droite `'` (U+0027), pas une apostrophe typographique.

```ts
// src/lib/shopcaisse-columns.ts

/**
 * Les intitulés ShopCaisse, à la lettre près.
 *
 * ShopCaisse apparie ses colonnes par intitulé exact : un accent ou une
 * apostrophe qui diverge rend la colonne introuvable côté caisse. C'est
 * pourquoi rien ici n'est reconstruit ni normalisé, et pourquoi le test
 * associé compare ces valeurs aux fichiers d'exemple réels plutôt qu'à des
 * chaînes recopiées à la main.
 */
export const COL = {
  identifiant: 'Identifiant',
  reference: 'Référence',
  nom: 'Nom',
  stockActuel: 'Stock actuel',
  stockSouhaite: 'Stock souhaité',
  mouvementStock: 'Mouvement stock',
  famille: 'Famille',
  rangs: 'Rangs',
  fournisseur: 'Fournisseur',
  tvaSurPlace: 'TVA sur place',
  tvaAEmporter: 'TVA à emporter',
  type: 'Type',
  codeBarre: 'Code barre',
  description: 'Description',
  unite: 'Unité',
  prixAchat: "Prix d'achat",
  gestionStock: 'Gestion du stock',
  affichageStock: 'Affichage du stock',
  couleurFond: 'Couleur de fond',
  texteBouton: 'Texte du bouton',
  prixTtc: 'PRIX TTC - Défaut - Mon Magasin Caisse 1',
  supprime: 'Supprimé',
  quantite: 'Quantité',
} as const

/** Le tableau maître : toutes les données produit + les colonnes de stock internes. */
export const MASTER_COLUMNS: readonly string[] = [
  COL.identifiant,
  COL.reference,
  COL.nom,
  COL.stockActuel,
  COL.stockSouhaite,
  COL.mouvementStock,
  COL.famille,
  COL.rangs,
  COL.fournisseur,
  COL.tvaSurPlace,
  COL.tvaAEmporter,
  COL.type,
  COL.codeBarre,
  COL.description,
  COL.unite,
  COL.prixAchat,
  COL.gestionStock,
  COL.affichageStock,
  COL.couleurFond,
  COL.texteBouton,
  COL.prixTtc,
  COL.supprime,
]

/**
 * Internes à l'application : elles servent à calculer la quantité à
 * transmettre, et ShopCaisse ne les connaît pas. Elles ne sortent dans aucun
 * export.
 */
export const STOCK_INTERNAL_COLUMNS: readonly string[] = [
  COL.stockActuel,
  COL.stockSouhaite,
  COL.mouvementStock,
]

/** `export-produits.csv`, à l'import comme à l'export : ordre imposé par ShopCaisse. */
export const PRODUCT_COLUMNS: readonly string[] = [
  COL.identifiant,
  COL.nom,
  COL.famille,
  COL.rangs,
  COL.fournisseur,
  COL.tvaSurPlace,
  COL.tvaAEmporter,
  COL.type,
  COL.codeBarre,
  COL.reference,
  COL.description,
  COL.unite,
  COL.prixAchat,
  COL.gestionStock,
  COL.affichageStock,
  COL.couleurFond,
  COL.texteBouton,
  COL.prixTtc,
  COL.supprime,
]

/** `export-stock.csv`. `Quantité` porte le mouvement, jamais le stock souhaité. */
export const STOCK_COLUMNS: readonly string[] = [
  COL.identifiant,
  COL.reference,
  COL.nom,
  COL.quantite,
]

export type MasterRow = Record<string, string | null>

/** Une ligne maître neuve : les 22 colonnes présentes, toutes vides (jamais 0). */
export function makeEmptyMasterRow(): MasterRow {
  return Object.fromEntries(MASTER_COLUMNS.map((column) => [column, null]))
}

export function isMasterColumn(column: string): boolean {
  return MASTER_COLUMNS.includes(column)
}
```

- [ ] **Step 5 : Vérifier que le test passe**

Run: `npx vitest run tests/lib/shopcaisse-columns.test.ts`
Expected: PASS (7 tests).

Si l'égalité échoue sur un intitulé, **corriger la constante, jamais la fixture** : le fichier ShopCaisse fait autorité.

- [ ] **Step 6 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/lib/shopcaisse-columns.ts tests/lib/shopcaisse-columns.test.ts tests/fixtures/shopcaisse
git commit -m "Ajoute le schéma de colonnes ShopCaisse verrouillé par les fichiers d'exemple"
```

---

### Task 2 : Calcul du mouvement de stock

**Files:**
- Create: `src/lib/shopcaisse-stock.ts`
- Test: `tests/lib/shopcaisse-stock.test.ts`

**Interfaces:**
- Consomme : rien (module pur).
- Produit :
  - `readStockCell(value: unknown): StockCell` où `StockCell = { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'invalid'; raw: string }`
  - `computeMovement(current: unknown, target: unknown): Movement` où `Movement = { kind: 'empty' } | { kind: 'value'; value: number; text: string } | { kind: 'invalid'; column: string; raw: string }`
  - `formatStockNumber(value: number): string`

- [ ] **Step 1 : Écrire le test qui échoue**

Couvre les tests obligatoires 9 à 12 de la consigne (mouvement positif, négatif, nul, vide) et la règle « erreur si non numérique ».

```ts
// tests/lib/shopcaisse-stock.test.ts
import { describe, expect, it } from 'vitest'
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement, formatStockNumber, readStockCell } from '@/lib/shopcaisse-stock'

describe('readStockCell', () => {
  it('lit un entier', () => {
    expect(readStockCell('5')).toEqual({ kind: 'number', value: 5 })
  })

  it('lit un décimal à point comme à virgule', () => {
    expect(readStockCell('2.00')).toEqual({ kind: 'number', value: 2 })
    expect(readStockCell('2,5')).toEqual({ kind: 'number', value: 2.5 })
  })

  it('lit un négatif', () => {
    expect(readStockCell('-3')).toEqual({ kind: 'number', value: -3 })
  })

  it('traite le vide, null et undefined comme vide — jamais comme zéro', () => {
    expect(readStockCell('')).toEqual({ kind: 'empty' })
    expect(readStockCell('   ')).toEqual({ kind: 'empty' })
    expect(readStockCell(null)).toEqual({ kind: 'empty' })
    expect(readStockCell(undefined)).toEqual({ kind: 'empty' })
  })

  it('lit zéro comme la valeur 0, et non comme du vide', () => {
    expect(readStockCell('0')).toEqual({ kind: 'number', value: 0 })
  })

  it('refuse une valeur non numérique', () => {
    expect(readStockCell('abc')).toEqual({ kind: 'invalid', raw: 'abc' })
    expect(readStockCell('5x')).toEqual({ kind: 'invalid', raw: '5x' })
    expect(readStockCell('12 pièces')).toEqual({ kind: 'invalid', raw: '12 pièces' })
  })
})

describe('computeMovement', () => {
  it('calcule un mouvement positif : 5 → 8 donne 3', () => {
    expect(computeMovement('5', '8')).toEqual({ kind: 'value', value: 3, text: '3' })
  })

  it('calcule un mouvement négatif : 8 → 5 donne -3', () => {
    expect(computeMovement('8', '5')).toEqual({ kind: 'value', value: -3, text: '-3' })
  })

  it('calcule un mouvement nul : 8 → 8 donne 0', () => {
    expect(computeMovement('8', '8')).toEqual({ kind: 'value', value: 0, text: '0' })
  })

  it('laisse le mouvement vide quand le stock actuel est vide', () => {
    expect(computeMovement('', '8')).toEqual({ kind: 'empty' })
  })

  it('laisse le mouvement vide quand le stock souhaité est vide', () => {
    expect(computeMovement('5', '')).toEqual({ kind: 'empty' })
  })

  it('laisse le mouvement vide quand les deux sont vides', () => {
    expect(computeMovement(null, null)).toEqual({ kind: 'empty' })
  })

  it('signale la colonne fautive quand une valeur n’est pas numérique', () => {
    expect(computeMovement('abc', '8')).toEqual({
      kind: 'invalid',
      column: COL.stockActuel,
      raw: 'abc',
    })
    expect(computeMovement('5', 'huit')).toEqual({
      kind: 'invalid',
      column: COL.stockSouhaite,
      raw: 'huit',
    })
  })

  it('ne laisse pas l’imprécision flottante fuiter dans le CSV', () => {
    expect(computeMovement('5.2', '8.1')).toEqual({ kind: 'value', value: 2.9, text: '2.9' })
  })
})

describe('formatStockNumber', () => {
  it('n’ajoute pas de décimales inutiles', () => {
    expect(formatStockNumber(3)).toBe('3')
    expect(formatStockNumber(0)).toBe('0')
    expect(formatStockNumber(-3)).toBe('-3')
    expect(formatStockNumber(2.5)).toBe('2.5')
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/lib/shopcaisse-stock.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/shopcaisse-stock"`.

- [ ] **Step 3 : Écrire le module**

Ne pas réutiliser `parseLocalizedNumber` de `product-views.ts` : elle retire les caractères non numériques et lirait « 5x » comme 5, ce qui inventerait une quantité au lieu de signaler une erreur.

```ts
// src/lib/shopcaisse-stock.ts
import { COL } from '@/lib/shopcaisse-columns'

export type StockCell =
  | { kind: 'empty' }
  | { kind: 'number'; value: number }
  | { kind: 'invalid'; raw: string }

export type Movement =
  | { kind: 'empty' }
  | { kind: 'value'; value: number; text: string }
  | { kind: 'invalid'; column: string; raw: string }

/** Un nombre entier ou décimal, point ou virgule, signe optionnel. Rien d'autre. */
const STOCK_PATTERN = /^-?\d+(?:[.,]\d+)?$/

/**
 * Lit une cellule de stock.
 *
 * Volontairement strict, contrairement à `parseLocalizedNumber` : celle-ci
 * nettoie les caractères parasites et lirait « 5x » comme 5. Sur une quantité,
 * ce serait inventer une valeur là où la consigne demande une erreur.
 */
export function readStockCell(value: unknown): StockCell {
  if (value === null || value === undefined) return { kind: 'empty' }

  const raw = String(value)
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'empty' }

  if (!STOCK_PATTERN.test(trimmed)) return { kind: 'invalid', raw }

  const parsed = Number(trimmed.replace(',', '.'))
  if (!Number.isFinite(parsed)) return { kind: 'invalid', raw }

  return { kind: 'number', value: parsed }
}

/**
 * Mouvement stock = Stock souhaité − Stock actuel.
 *
 * Vide dès qu'une des deux valeurs manque : sans les deux, la différence
 * n'existe pas, et la remplacer par 0 affirmerait « aucun mouvement » alors
 * qu'on ne sait rien.
 */
export function computeMovement(current: unknown, target: unknown): Movement {
  const currentCell = readStockCell(current)
  if (currentCell.kind === 'invalid') {
    return { kind: 'invalid', column: COL.stockActuel, raw: currentCell.raw }
  }

  const targetCell = readStockCell(target)
  if (targetCell.kind === 'invalid') {
    return { kind: 'invalid', column: COL.stockSouhaite, raw: targetCell.raw }
  }

  if (currentCell.kind === 'empty' || targetCell.kind === 'empty') return { kind: 'empty' }

  const value = roundQuantity(targetCell.value - currentCell.value)
  return { kind: 'value', value, text: formatStockNumber(value) }
}

/**
 * 8.1 − 5.2 vaut 2.9000000000000004 en flottant. Trois décimales couvrent
 * largement une quantité de stock et coupent ce bruit avant qu'il n'atteigne
 * le CSV.
 */
function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000
}

/** Pas de décimales inutiles : ShopCaisse accepte « 3 » aussi bien que « 3.00 ». */
export function formatStockNumber(value: number): string {
  return String(roundQuantity(value))
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/lib/shopcaisse-stock.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/lib/shopcaisse-stock.ts tests/lib/shopcaisse-stock.test.ts
git commit -m "Ajoute le calcul du mouvement de stock"
```

---

### Task 3 : Identification des produits et détection des ambiguïtés

**Files:**
- Create: `src/lib/shopcaisse-identity.ts`
- Test: `tests/lib/shopcaisse-identity.test.ts`

**Interfaces:**
- Consomme : `COL` (Task 1), `normalizeMatchValue` de `@/lib/catalog-columns` (existant, réutilisé).
- Produit :
  - `type IdentityRule = 'Identifiant' | 'Référence' | 'Nom + Code barre'`
  - `identityKeys(row): Array<{ rule: IdentityRule; key: string }>` — les clés renseignées, dans l'ordre de priorité.
  - `buildIdentityIndex<T>(entries: Array<{ row: MasterRow; item: T }>): IdentityIndex<T>`
  - `matchRow<T>(index: IdentityIndex<T>, row: MasterRow): MatchOutcome<T>` avec
    `MatchOutcome<T> = { status: 'matched'; item: T; rule: IdentityRule } | { status: 'ambiguous'; items: T[]; rule: IdentityRule } | { status: 'new' }`
  - `findConflicts(rows: MasterRow[]): Conflict[]` avec
    `Conflict = { row: number; rule: IdentityRule; value: string; relatedRows: number[] }` (`row` est un index 0-based)

- [ ] **Step 1 : Écrire le test qui échoue**

Couvre les tests obligatoires 6, 7, 25, 26 et 27.

```ts
// tests/lib/shopcaisse-identity.test.ts
import { describe, expect, it } from 'vitest'
import { COL, makeEmptyMasterRow, type MasterRow } from '@/lib/shopcaisse-columns'
import { buildIdentityIndex, findConflicts, identityKeys, matchRow } from '@/lib/shopcaisse-identity'

function row(values: Record<string, string | null>): MasterRow {
  return { ...makeEmptyMasterRow(), ...values }
}

describe('identityKeys', () => {
  it('donne les trois règles dans l’ordre de priorité quand tout est renseigné', () => {
    const keys = identityKeys(
      row({ [COL.identifiant]: '42', [COL.reference]: 'REF-001', [COL.nom]: 'Café', [COL.codeBarre]: '376' }),
    )
    expect(keys.map((k) => k.rule)).toEqual(['Identifiant', 'Référence', 'Nom + Code barre'])
  })

  it('ignore une règle dont la valeur est vide', () => {
    const keys = identityKeys(row({ [COL.reference]: 'REF-001' }))
    expect(keys.map((k) => k.rule)).toEqual(['Référence'])
  })

  it('n’ouvre pas la règle Nom + Code barre si le code-barres manque', () => {
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

  it('apparie par Référence quand l’Identifiant est vide', () => {
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

  it('n’apparie pas deux lignes sur une valeur vide partagée', () => {
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

  it('ne signale pas deux lignes dont l’Identifiant est vide', () => {
    expect(findConflicts([row({ [COL.reference]: 'A' }), row({ [COL.reference]: 'B' })])).toEqual([])
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/lib/shopcaisse-identity.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/shopcaisse-identity"`.

- [ ] **Step 3 : Écrire le module**

```ts
// src/lib/shopcaisse-identity.ts
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
function nameBarcodeKey(row: MasterRow): string {
  const name = normalizeMatchValue(row[COL.nom])
  const barcode = normalizeMatchValue(row[COL.codeBarre])
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
 * Plusieurs candidats sur une règle ⇒ « ambiguous » : l'application ne choisit
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
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/lib/shopcaisse-identity.test.ts`
Expected: PASS (14 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/lib/shopcaisse-identity.ts tests/lib/shopcaisse-identity.test.ts
git commit -m "Ajoute l'identification des produits et la détection des ambiguïtés"
```

---

### Task 4 : Template maître et migration des anciennes données

**Files:**
- Create: `src/services/shopcaisse-master.service.ts`
- Test: `tests/services/shopcaisse-master.service.test.ts`

**Interfaces:**
- Consomme : `MASTER_COLUMNS`, `COL`, `makeEmptyMasterRow`, `MasterRow` (Task 1) ; `computeMovement` (Task 2) ; `CatalogProduct`, `CsvTemplate`, `activateTemplate` (existants).
- Produit :
  - `MASTER_TEMPLATE_NAME: string`
  - `normalizeSupprime(value: unknown): '0' | '1'`
  - `toMasterRow(source: Record<string, unknown>): MasterRow` — range des valeurs quelconques dans les 22 colonnes, par intitulé exact puis par intitulé normalisé.
  - `withMovement(row: MasterRow): MasterRow` — recalcule `Mouvement stock`.
  - `ensureMasterTemplate(): Promise<string>` — migre le catalogue puis crée/active le template maître ; renvoie son id.
  - `listMasterEntries(): Promise<MasterEntry[]>` où `MasterEntry = { id: string; row: MasterRow }`, triées par `_id` croissant.

- [ ] **Step 1 : Écrire le test qui échoue**

Couvre les tests obligatoires 5 (création du maître), 31/32 (Oui↔1, Non↔0) et la migration sans perte du §10.

```ts
// tests/services/shopcaisse-master.service.test.ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, MASTER_COLUMNS } from '@/lib/shopcaisse-columns'
import {
  ensureMasterTemplate,
  listMasterEntries,
  MASTER_TEMPLATE_NAME,
  normalizeSupprime,
  toMasterRow,
  withMovement,
} from '@/services/shopcaisse-master.service'

withTestDatabase()

describe('normalizeSupprime', () => {
  it('convertit Oui en 1', () => {
    expect(normalizeSupprime('Oui')).toBe('1')
    expect(normalizeSupprime('oui')).toBe('1')
    expect(normalizeSupprime('1')).toBe('1')
  })

  it('convertit Non en 0', () => {
    expect(normalizeSupprime('Non')).toBe('0')
    expect(normalizeSupprime('non')).toBe('0')
    expect(normalizeSupprime('0')).toBe('0')
  })

  it('traite le vide comme « non supprimé » — la seule règle qui comble un vide', () => {
    expect(normalizeSupprime('')).toBe('0')
    expect(normalizeSupprime(null)).toBe('0')
    expect(normalizeSupprime(undefined)).toBe('0')
  })
})

describe('toMasterRow', () => {
  it('range chaque valeur dans sa colonne maître', () => {
    const row = toMasterRow({ Nom: 'Café Latte', 'Code barre': '0037600', Référence: 'REF-001' })
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.codeBarre]).toBe('0037600')
    expect(row[COL.reference]).toBe('REF-001')
  })

  it('porte toujours les 22 colonnes', () => {
    expect(Object.keys(toMasterRow({ Nom: 'Café' }))).toEqual([...MASTER_COLUMNS])
  })

  it('conserve les cellules vides sans les remplacer par 0', () => {
    const row = toMasterRow({ Nom: 'Café', "Prix d'achat": '' })
    expect(row[COL.prixAchat]).toBeNull()
    expect(row[COL.stockActuel]).toBeNull()
  })

  it('conserve le 0 significatif', () => {
    expect(toMasterRow({ 'Gestion du stock': '0' })[COL.gestionStock]).toBe('0')
  })

  it('garde le code-barres en chaîne, zéros de tête compris', () => {
    expect(toMasterRow({ 'Code barre': '0003760001000001' })[COL.codeBarre]).toBe('0003760001000001')
  })

  it('retrouve une colonne dont l’intitulé diverge par la casse ou les accents', () => {
    expect(toMasterRow({ REFERENCE: 'REF-001' })[COL.reference]).toBe('REF-001')
  })

  it('ignore une colonne inconnue du maître', () => {
    const row = toMasterRow({ Nom: 'Café', 'Colonne maison': 'x' })
    expect(Object.keys(row)).not.toContain('Colonne maison')
  })

  it('normalise Supprimé en binaire', () => {
    expect(toMasterRow({ Supprimé: 'Oui' })[COL.supprime]).toBe('1')
    expect(toMasterRow({ Nom: 'Café' })[COL.supprime]).toBe('0')
  })
})

describe('withMovement', () => {
  it('recalcule le mouvement à partir des deux stocks', () => {
    const row = withMovement(toMasterRow({ 'Stock actuel': '5', 'Stock souhaité': '8' }))
    expect(row[COL.mouvementStock]).toBe('3')
  })

  it('vide le mouvement quand un stock manque', () => {
    const row = withMovement(toMasterRow({ 'Stock souhaité': '8' }))
    expect(row[COL.mouvementStock]).toBeNull()
  })

  it('vide le mouvement quand un stock est illisible, sans jeter', () => {
    const row = withMovement(toMasterRow({ 'Stock actuel': 'abc', 'Stock souhaité': '8' }))
    expect(row[COL.mouvementStock]).toBeNull()
  })
})

describe('ensureMasterTemplate', () => {
  it('crée et active un template portant les 22 colonnes maître', async () => {
    await ensureMasterTemplate()
    const active = await CsvTemplate.findOne({ isActive: true }).lean()
    expect(active?.name).toBe(MASTER_TEMPLATE_NAME)
    expect(active?.columns.map((c) => c.name)).toEqual([...MASTER_COLUMNS])
    expect(active?.delimiter).toBe(';')
  })

  it('est idempotent : deux appels ne créent qu’un seul template actif', async () => {
    const first = await ensureMasterTemplate()
    const second = await ensureMasterTemplate()
    expect(second).toBe(first)
    expect(await CsvTemplate.countDocuments({ isActive: true })).toBe(1)
  })

  it('migre un catalogue ancien vers le schéma maître sans perdre de valeur', async () => {
    const old = await CsvTemplate.create({
      name: 'Ancien',
      sourceFileName: 'a.csv',
      columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
      isActive: true,
    })
    await CatalogProduct.create({
      templateId: old._id,
      name: 'Vase',
      csvData: { Nom: 'Vase', 'Code barre': '007', Inconnue: 'x' },
      originalCsvData: { Nom: 'Vase', 'Code barre': '007' },
    })

    await ensureMasterTemplate()

    const product = await CatalogProduct.findOne({ name: 'Vase' }).lean()
    const csvData = product!.csvData as Record<string, unknown>
    expect(Object.keys(csvData)).toEqual([...MASTER_COLUMNS])
    expect(csvData[COL.nom]).toBe('Vase')
    expect(csvData[COL.codeBarre]).toBe('007')
    expect(csvData[COL.supprime]).toBe('0')
    // originalCsvData migre aussi : sinon la comparaison verrait tout comme modifié.
    expect(Object.keys(product!.originalCsvData as Record<string, unknown>)).toEqual([...MASTER_COLUMNS])
  })

  it('reporte isDeleted dans la colonne Supprimé à la migration', async () => {
    const old = await CsvTemplate.create({
      name: 'Ancien',
      sourceFileName: 'a.csv',
      columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
      isActive: true,
    })
    await CatalogProduct.create({ templateId: old._id, name: 'Vase', csvData: { Nom: 'Vase' }, isDeleted: true })

    await ensureMasterTemplate()

    const product = await CatalogProduct.findOne({ name: 'Vase' }).lean()
    expect((product!.csvData as Record<string, unknown>)[COL.supprime]).toBe('1')
    expect(product!.isDeleted).toBe(true)
  })
})

describe('listMasterEntries', () => {
  it('rend les lignes dans l’ordre de création, supprimées comprises', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({ templateId, csvData: { [COL.nom]: 'A', [COL.supprime]: '0' } })
    await CatalogProduct.create({ templateId, csvData: { [COL.nom]: 'B', [COL.supprime]: '1' }, isDeleted: true })

    const entries = await listMasterEntries()
    expect(entries.map((e) => e.row[COL.nom])).toEqual(['A', 'B'])
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-master.service.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/shopcaisse-master.service"`.

- [ ] **Step 3 : Écrire le service**

```ts
// src/services/shopcaisse-master.service.ts
import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { normalizeHeader } from '@/lib/product-views'
import { COL, MASTER_COLUMNS, makeEmptyMasterRow, type MasterRow } from '@/lib/shopcaisse-columns'
import { computeMovement } from '@/lib/shopcaisse-stock'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvTemplate } from '@/models/CsvTemplate'
import { activateTemplate } from '@/services/csv-template.service'

export const MASTER_TEMPLATE_NAME = 'Tableau maître ShopCaisse'

export interface MasterEntry {
  id: string
  row: MasterRow
}

const TRUTHY_SUPPRIME = new Set(['1', 'oui', 'true', 'vrai'])

/**
 * `Supprimé` est le seul champ où un vide devient 0.
 *
 * La règle est explicite dans la consigne (§5) : ShopCaisse n'accepte que du
 * binaire dans cette colonne, et « ni Oui ni Non » n'existe pas — un produit
 * qu'on n'a pas marqué est un produit qu'on conserve.
 */
export function normalizeSupprime(value: unknown): '0' | '1' {
  if (value === null || value === undefined) return '0'
  return TRUTHY_SUPPRIME.has(String(value).trim().toLocaleLowerCase('fr')) ? '1' : '0'
}

/** Index des colonnes maître par intitulé normalisé, construit une seule fois. */
const MASTER_BY_NORMALIZED = new Map(
  MASTER_COLUMNS.map((column) => [normalizeHeader(column), column]),
)

/**
 * Range des valeurs quelconques dans les 22 colonnes maître.
 *
 * L'appariement se fait d'abord par intitulé exact — c'est le contrat
 * ShopCaisse —, puis par intitulé normalisé, ce qui rattrape un ancien
 * catalogue dont les en-têtes divergeaient par la casse ou les accents. Une
 * colonne inconnue du maître est écartée : elle n'a pas de place dans le
 * schéma figé, et l'inventer casserait les exports.
 */
export function toMasterRow(source: Record<string, unknown>): MasterRow {
  const row = makeEmptyMasterRow()

  for (const [key, value] of Object.entries(source)) {
    const column = MASTER_COLUMNS.includes(key) ? key : MASTER_BY_NORMALIZED.get(normalizeHeader(key))
    if (!column) continue
    row[column] = emptyToNull(value)
  }

  row[COL.supprime] = normalizeSupprime(row[COL.supprime])
  return row
}

/** Une valeur absente vaut null, jamais 0 ni « N/A ». */
function emptyToNull(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = String(value)
  return text === '' ? null : text
}

/**
 * Recalcule `Mouvement stock`.
 *
 * Une valeur illisible laisse le mouvement vide plutôt que de jeter : le
 * signalement à l'utilisateur est le travail de la validation avant export,
 * qui voit toute la ligne et peut la nommer.
 */
export function withMovement(row: MasterRow): MasterRow {
  const movement = computeMovement(row[COL.stockActuel], row[COL.stockSouhaite])
  return { ...row, [COL.mouvementStock]: movement.kind === 'value' ? movement.text : null }
}

/**
 * Garantit un template actif portant exactement le schéma maître.
 *
 * La migration précède l'activation, comme dans `from-import` : le contrôle de
 * colonnes d'`activateTemplate` compare aux clés réellement présentes dans le
 * catalogue, qui doivent donc déjà porter les 22 colonnes.
 */
export async function ensureMasterTemplate(): Promise<string> {
  await connectToDatabase()

  const active = await CsvTemplate.findOne({ isActive: true }).lean()
  if (active && isMasterTemplate(active.columns.map((column) => column.name))) {
    await migrateCatalogToMaster(String(active._id))
    return String(active._id)
  }

  const template = await CsvTemplate.create({
    name: MASTER_TEMPLATE_NAME,
    sourceFileName: 'export-produits.csv',
    columns: MASTER_COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    encoding: 'utf-8',
    isActive: false,
  })

  const templateId = String(template._id)
  await migrateCatalogToMaster(templateId)
  await activateTemplate(templateId)

  return templateId
}

function isMasterTemplate(columns: string[]): boolean {
  return columns.length === MASTER_COLUMNS.length && columns.every((name, i) => name === MASTER_COLUMNS[i])
}

/**
 * Réécrit chaque produit dans le schéma maître, sans perte.
 *
 * `originalCsvData` migre avec `csvData` : les comparer sur des schémas
 * différents ferait apparaître tout le catalogue comme modifié.
 */
async function migrateCatalogToMaster(templateId: string): Promise<void> {
  const products = await CatalogProduct.find({}).select('csvData originalCsvData isDeleted').lean()

  const operations = products.map((product) => {
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    const original = product.originalCsvData as Record<string, unknown> | null

    const row = withMovement(toMasterRow(csvData))
    // Le champ isDeleted portait la suppression avant l'introduction de la
    // colonne : il fait foi quand la colonne est absente.
    if (product.isDeleted) row[COL.supprime] = '1'

    return {
      updateOne: {
        filter: { _id: product._id },
        update: {
          $set: {
            templateId: new Types.ObjectId(templateId),
            csvData: row,
            originalCsvData: original ? toMasterRow(original) : null,
            isDeleted: row[COL.supprime] === '1',
          },
        },
      },
    }
  })

  if (operations.length) await CatalogProduct.bulkWrite(operations, { ordered: false })
}

/**
 * Toutes les lignes maître, supprimées comprises.
 *
 * L'ordre `_id` croissant est l'ordre de création, et c'est lui qui garantit
 * que les deux exports décrivent le même produit à chaque index.
 */
export async function listMasterEntries(): Promise<MasterEntry[]> {
  await connectToDatabase()

  const products = await CatalogProduct.find({}).sort({ _id: 1 }).select('csvData').lean()

  return products.map((product) => ({
    id: String(product._id),
    row: toMasterRow((product.csvData ?? {}) as Record<string, unknown>),
  }))
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-master.service.test.ts`
Expected: PASS (18 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/services/shopcaisse-master.service.ts tests/services/shopcaisse-master.service.test.ts
git commit -m "Ajoute le template maître ShopCaisse et la migration des anciennes données"
```

---

### Task 5 : Import de `export-produits.csv` dans le maître

**Files:**
- Create: `src/services/shopcaisse-import.service.ts`
- Test: `tests/services/shopcaisse-import-products.service.test.ts`

**Interfaces:**
- Consomme : `COL`, `PRODUCT_COLUMNS`, `MasterRow` (Task 1) ; `buildIdentityIndex`, `matchRow`, `IdentityRule` (Task 3) ; `toMasterRow`, `withMovement`, `ensureMasterTemplate`, `normalizeSupprime` (Task 4) ; `ParsedCsv` de `@/services/csv-parser.service` (existant).
- Produit :
  - `interface ImportSummary { created: number; updated: number; ambiguous: Array<{ row: number; rule: IdentityRule }>; errors: Array<{ row: number; message: string }> }`
  - `importProductsIntoMaster(parsed: ParsedCsv): Promise<ImportSummary>`

- [ ] **Step 1 : Écrire le test qui échoue**

Couvre les tests obligatoires 1, 2, 3, 4, 6, 7, 8 de la consigne.

```ts
// tests/services/shopcaisse-import-products.service.test.ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, MASTER_COLUMNS, PRODUCT_COLUMNS } from '@/lib/shopcaisse-columns'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { importProductsIntoMaster } from '@/services/shopcaisse-import.service'
import type { ParsedCsv } from '@/services/csv-parser.service'

withTestDatabase()

/** Un ParsedCsv produits, colonnes dans l'ordre ShopCaisse. */
function parsedProducts(rows: Array<Record<string, string>>): ParsedCsv {
  return {
    columns: [...PRODUCT_COLUMNS],
    rows: rows.map((row) => Object.fromEntries(PRODUCT_COLUMNS.map((c) => [c, row[c] ?? '']))),
    delimiter: ';',
    encoding: 'utf-8',
    encodingConfident: true,
  }
}

async function masterRows() {
  const products = await CatalogProduct.find({}).sort({ _id: 1 }).lean()
  return products.map((p) => p.csvData as Record<string, unknown>)
}

describe('importProductsIntoMaster', () => {
  it('crée le tableau maître à partir du fichier produits', async () => {
    const summary = await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001', Famille: 'Boissons' }]),
    )
    expect(summary.created).toBe(1)
    expect(summary.updated).toBe(0)

    const [row] = await masterRows()
    expect(Object.keys(row)).toEqual([...MASTER_COLUMNS])
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.reference]).toBe('REF-001')
    expect(row[COL.famille]).toBe('Boissons')
  })

  it('mappe par intitulé et non par position', async () => {
    // Colonnes volontairement inversées par rapport à l'ordre ShopCaisse.
    const parsed: ParsedCsv = {
      columns: ['Référence', 'Nom'],
      rows: [{ Référence: 'REF-001', Nom: 'Café Latte' }],
      delimiter: ';',
      encoding: 'utf-8',
      encodingConfident: true,
    }
    await importProductsIntoMaster(parsed)

    const [row] = await masterRows()
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.reference]).toBe('REF-001')
  })

  it('conserve les cellules vides sans les remplacer par 0', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001' }]))
    const [row] = await masterRows()
    expect(row[COL.prixAchat]).toBeNull()
    expect(row[COL.description]).toBeNull()
  })

  it('conserve le 0 significatif', async () => {
    await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café', Référence: 'REF-001', 'Gestion du stock': '0' }]),
    )
    const [row] = await masterRows()
    expect(row[COL.gestionStock]).toBe('0')
  })

  it('conserve les décimales', async () => {
    await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café', Référence: 'REF-001', "Prix d'achat": '2.50' }]),
    )
    const [row] = await masterRows()
    expect(row[COL.prixAchat]).toBe('2.50')
  })

  it('garde le code-barres en chaîne, zéros de tête compris', async () => {
    await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café', Référence: 'REF-001', 'Code barre': '0003760001000001' }]),
    )
    const [row] = await masterRows()
    expect(row[COL.codeBarre]).toBe('0003760001000001')
  })

  it('met à jour un produit existant par Identifiant, sans créer de doublon', async () => {
    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importProductsIntoMaster(
      parsedProducts([{ Identifiant: '42', Nom: 'Café Latte', Référence: 'REF-001' }]),
    )

    expect(summary.updated).toBe(1)
    expect(summary.created).toBe(0)
    const rows = await masterRows()
    expect(rows).toHaveLength(1)
    expect(rows[0][COL.nom]).toBe('Café Latte')
  })

  it('met à jour un produit existant par Référence quand l’Identifiant est vide', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001' }]),
    )

    expect(summary.updated).toBe(1)
    const rows = await masterRows()
    expect(rows).toHaveLength(1)
    expect(rows[0][COL.nom]).toBe('Café Latte')
  })

  it('conserve les stocks internes lors de la mise à jour d’un produit existant', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({
      templateId,
      shopcaisseId: '42',
      reference: 'REF-001',
      csvData: {
        [COL.identifiant]: '42',
        [COL.reference]: 'REF-001',
        [COL.nom]: 'Café',
        [COL.stockActuel]: '5',
        [COL.stockSouhaite]: '8',
        [COL.mouvementStock]: '3',
        [COL.supprime]: '0',
      },
    })

    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café Latte', Référence: 'REF-001' }]))

    const [row] = await masterRows()
    expect(row[COL.stockActuel]).toBe('5')
    expect(row[COL.stockSouhaite]).toBe('8')
    expect(row[COL.mouvementStock]).toBe('3')
    expect(row[COL.nom]).toBe('Café Latte')
  })

  it('laisse les stocks vides pour un nouveau produit — jamais de quantité inventée', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const [row] = await masterRows()
    expect(row[COL.stockActuel]).toBeNull()
    expect(row[COL.stockSouhaite]).toBeNull()
    expect(row[COL.mouvementStock]).toBeNull()
  })

  it('conserve une ligne existante absente du nouvel import', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Thé', Référence: 'REF-002' }]))

    const rows = await masterRows()
    expect(rows.map((r) => r[COL.reference])).toEqual(['REF-001', 'REF-002'])
  })

  it('n’écrase pas originalCsvData d’un produit existant', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001' }]))

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.originalCsvData as Record<string, unknown>)[COL.nom]).toBe('Café')
  })

  it('signale l’ambiguïté et ne fusionne pas deux lignes de même Référence', async () => {
    const templateId = await ensureMasterTemplate()
    for (const nom of ['Café', 'Thé']) {
      await CatalogProduct.create({
        templateId,
        csvData: { [COL.reference]: 'REF-001', [COL.nom]: nom, [COL.supprime]: '0' },
      })
    }

    const summary = await importProductsIntoMaster(parsedProducts([{ Nom: 'Autre', Référence: 'REF-001' }]))

    expect(summary.ambiguous).toEqual([{ row: 0, rule: 'Référence' }])
    // Ni fusion, ni écrasement : les deux lignes restent, telles quelles.
    const rows = await masterRows()
    expect(rows.map((r) => r[COL.nom])).toEqual(['Café', 'Thé'])
    expect(summary.created).toBe(0)
    expect(summary.updated).toBe(0)
  })

  it('convertit Oui en 1 dans la colonne Supprimé', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001', Supprimé: 'Oui' }]))
    const [row] = await masterRows()
    expect(row[COL.supprime]).toBe('1')
  })

  it('tient isDeleted en miroir de la colonne Supprimé', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001', Supprimé: '1' }]))
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.isDeleted).toBe(true)
  })

  it('active le template maître', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.templateId).toBeTruthy()
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-import-products.service.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/shopcaisse-import.service"`.

- [ ] **Step 3 : Écrire le service**

```ts
// src/services/shopcaisse-import.service.ts
import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { COL, MASTER_COLUMNS, type MasterRow } from '@/lib/shopcaisse-columns'
import { buildIdentityIndex, matchRow, type IdentityRule } from '@/lib/shopcaisse-identity'
import { CatalogProduct } from '@/models/CatalogProduct'
import type { ParsedCsv } from '@/services/csv-parser.service'
import {
  ensureMasterTemplate,
  toMasterRow,
  withMovement,
} from '@/services/shopcaisse-master.service'

export interface ImportSummary {
  created: number
  updated: number
  /** Lignes du fichier (0-based) dont la correspondance était ambiguë : ni fusionnées, ni créées. */
  ambiguous: Array<{ row: number; rule: IdentityRule }>
  errors: Array<{ row: number; message: string }>
}

const BATCH_SIZE = 500

interface ExistingEntry {
  _id: Types.ObjectId
  row: MasterRow
}

/**
 * Aligne le tableau maître sur `export-produits.csv`.
 *
 * Hors transaction, comme `syncCatalogFromCsv` : un fichier de plusieurs
 * milliers de lignes dépasserait la limite de 16 Mo de l'oplog transactionnel.
 * Les écritures sont idempotentes, donc l'import est relançable.
 */
export async function importProductsIntoMaster(parsed: ParsedCsv): Promise<ImportSummary> {
  await connectToDatabase()
  const templateId = await ensureMasterTemplate()

  const summary: ImportSummary = { created: 0, updated: 0, ambiguous: [], errors: [] }

  const existing = await loadExisting()
  const index = buildIdentityIndex(existing.map((entry) => ({ row: entry.row, item: entry })))

  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  parsed.rows.forEach((source, rowIndex) => {
    try {
      const incoming = toMasterRow(source)
      const match = matchRow(index, incoming)

      if (match.status === 'ambiguous') {
        // On ne choisit pas à la place de l'utilisateur, et on ne crée pas non
        // plus une ligne de plus : ce serait fabriquer un troisième doublon.
        summary.ambiguous.push({ row: rowIndex, rule: match.rule })
        return
      }

      if (match.status === 'matched') {
        const merged = mergeProductRow(match.item.row, incoming)
        operations.push({
          updateOne: {
            filter: { _id: match.item._id },
            update: { $set: { templateId: new Types.ObjectId(templateId), ...writeFields(merged) } },
          },
        })
        summary.updated += 1
        return
      }

      const row = withMovement(incoming)
      operations.push({
        insertOne: {
          document: {
            templateId: new Types.ObjectId(templateId),
            ...writeFields(row),
            // Écrit à la création seulement : c'est le socle de comparaison.
            originalCsvData: row,
          },
        },
      })
      summary.created += 1
    } catch (error) {
      summary.errors.push({
        row: rowIndex,
        message: error instanceof Error ? error.message : 'Ligne illisible.',
      })
    }
  })

  await flush(operations)
  return summary
}

/**
 * Fusionne une ligne importée dans la ligne maître existante.
 *
 * Les trois colonnes de stock sont internes : le fichier produits ne les porte
 * pas, et les écraser effacerait un travail de saisie.
 */
function mergeProductRow(existing: MasterRow, incoming: MasterRow): MasterRow {
  const merged: MasterRow = { ...existing }
  for (const column of MASTER_COLUMNS) {
    if (column === COL.stockActuel || column === COL.stockSouhaite || column === COL.mouvementStock) {
      continue
    }
    merged[column] = incoming[column]
  }
  return withMovement(merged)
}

/**
 * Les champs d'identité sont dupliqués hors de csvData pour l'indexation
 * MongoDB (convention du modèle existant) ; csvData reste la valeur de référence.
 */
function writeFields(row: MasterRow) {
  return {
    shopcaisseId: row[COL.identifiant],
    reference: row[COL.reference],
    barcode: row[COL.codeBarre],
    name: row[COL.nom],
    supplier: row[COL.fournisseur],
    csvData: row,
    isDeleted: row[COL.supprime] === '1',
  }
}

async function loadExisting(): Promise<ExistingEntry[]> {
  // Le maître est chargé et indexé en mémoire une fois : une requête par ligne
  // serait ruineuse sur plusieurs milliers de produits.
  const products = await CatalogProduct.find({}).sort({ _id: 1 }).select('csvData').lean()
  return products.map((product) => ({
    _id: product._id as Types.ObjectId,
    row: toMasterRow((product.csvData ?? {}) as Record<string, unknown>),
  }))
}

async function flush(operations: Parameters<typeof CatalogProduct.bulkWrite>[0]): Promise<void> {
  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    await CatalogProduct.bulkWrite(operations.slice(index, index + BATCH_SIZE), { ordered: false })
  }
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-import-products.service.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/services/shopcaisse-import.service.ts tests/services/shopcaisse-import-products.service.test.ts
git commit -m "Ajoute l'import de export-produits.csv dans le tableau maître"
```

---

### Task 6 : Import du fichier stock dans `Stock actuel`

**Files:**
- Modify: `src/services/shopcaisse-import.service.ts` (ajout d'`importStockIntoMaster`)
- Test: `tests/services/shopcaisse-import-stock.service.test.ts`

**Interfaces:**
- Consomme : tout ce que consomme la Task 5, plus `readStockCell` (Task 2).
- Produit : `importStockIntoMaster(parsed: ParsedCsv): Promise<ImportSummary>` — même type de retour que `importProductsIntoMaster`. `created` vaut toujours 0 : un fichier stock ne crée pas de produit.

- [ ] **Step 1 : Écrire le test qui échoue**

Décision L5-1 : la `Quantité` du fichier stock est l'état connu, donc elle alimente `Stock actuel`. Le fichier stock ne crée jamais de produit — un produit dont on ne connaît que la quantité n'a ni famille, ni prix, ni TVA.

```ts
// tests/services/shopcaisse-import-stock.service.test.ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, STOCK_COLUMNS } from '@/lib/shopcaisse-columns'
import { importProductsIntoMaster, importStockIntoMaster } from '@/services/shopcaisse-import.service'
import type { ParsedCsv } from '@/services/csv-parser.service'

withTestDatabase()

function parsedStock(rows: Array<Record<string, string>>): ParsedCsv {
  return {
    columns: [...STOCK_COLUMNS],
    rows: rows.map((row) => Object.fromEntries(STOCK_COLUMNS.map((c) => [c, row[c] ?? '']))),
    delimiter: ';',
    encoding: 'utf-8',
    encodingConfident: true,
  }
}

function parsedProducts(rows: Array<Record<string, string>>): ParsedCsv {
  const columns = ['Identifiant', 'Nom', 'Référence', 'Code barre']
  return {
    columns,
    rows: rows.map((row) => Object.fromEntries(columns.map((c) => [c, row[c] ?? '']))),
    delimiter: ';',
    encoding: 'utf-8',
    encodingConfident: true,
  }
}

async function firstRow() {
  const product = await CatalogProduct.findOne({}).lean()
  return product!.csvData as Record<string, unknown>
}

describe('importStockIntoMaster', () => {
  it('range la Quantité importée dans Stock actuel', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Nom: 'Café', Quantité: '5' }]))

    expect(summary.updated).toBe(1)
    expect((await firstRow())[COL.stockActuel]).toBe('5')
  })

  it('ne touche pas à Stock souhaité', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: '5' }]))
    expect((await firstRow())[COL.stockSouhaite]).toBeNull()
  })

  it('recalcule le mouvement quand un stock souhaité était déjà saisi', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await CatalogProduct.updateOne({}, { $set: { [`csvData.${COL.stockSouhaite}`]: '8' } })

    await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: '5' }]))

    const row = await firstRow()
    expect(row[COL.stockActuel]).toBe('5')
    expect(row[COL.mouvementStock]).toBe('3')
  })

  it('apparie par Identifiant en priorité', async () => {
    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café', Référence: 'REF-001' }]))
    await importStockIntoMaster(parsedStock([{ Identifiant: '42', Quantité: '5' }]))
    expect((await firstRow())[COL.stockActuel]).toBe('5')
  })

  it('ne crée jamais de produit depuis le fichier stock', async () => {
    const summary = await importStockIntoMaster(parsedStock([{ Référence: 'REF-404', Nom: 'Fantôme', Quantité: '5' }]))

    expect(summary.created).toBe(0)
    expect(summary.updated).toBe(0)
    expect(summary.errors).toEqual([
      { row: 0, message: 'Produit introuvable dans le tableau maître : REF-404. Importez d’abord le fichier produits.' },
    ])
    expect(await CatalogProduct.countDocuments({})).toBe(0)
  })

  it('refuse une quantité non numérique et ne l’écrit pas', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: 'beaucoup' }]))

    expect(summary.errors).toEqual([
      { row: 0, message: 'Quantité non numérique : « beaucoup ».' },
    ])
    expect((await firstRow())[COL.stockActuel]).toBeNull()
  })

  it('laisse Stock actuel vide quand la Quantité est vide — jamais de zéro inventé', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importStockIntoMaster(parsedStock([{ Référence: 'REF-001', Quantité: '' }]))
    expect((await firstRow())[COL.stockActuel]).toBeNull()
  })

  it('signale l’ambiguïté sans écrire', async () => {
    await importProductsIntoMaster(
      parsedProducts([
        { Nom: 'Café', Référence: 'REF-001', 'Code barre': '111' },
        { Nom: 'Café', Référence: 'REF-002', 'Code barre': '111' },
      ]),
    )
    const summary = await importStockIntoMaster(parsedStock([{ Nom: 'Café', Quantité: '5' }]))

    // Nom seul n'identifie rien ; sans code-barres, aucune règle ne s'applique.
    expect(summary.updated).toBe(0)
    expect(summary.errors).toHaveLength(1)
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-import-stock.service.test.ts`
Expected: FAIL — `importStockIntoMaster is not a function`.

- [ ] **Step 3 : Ajouter le service**

Ajouter en fin de `src/services/shopcaisse-import.service.ts`, et compléter l'import de `readStockCell` en tête de fichier :

```ts
// en tête : ajouter à la ligne d'import existante de shopcaisse-stock
import { readStockCell } from '@/lib/shopcaisse-stock'
```

```ts
/**
 * Range les quantités d'un fichier stock ShopCaisse dans `Stock actuel`.
 *
 * `Stock actuel` et non `Stock souhaité` : le fichier décrit l'état connu de la
 * caisse, pas la cible voulue par l'utilisateur. L'écrire dans `Stock souhaité`
 * réduirait tous les mouvements à zéro.
 *
 * Ce fichier ne crée jamais de produit : une ligne sans famille, sans prix et
 * sans TVA ne décrit pas un article exportable.
 */
export async function importStockIntoMaster(parsed: ParsedCsv): Promise<ImportSummary> {
  await connectToDatabase()
  const templateId = await ensureMasterTemplate()

  const summary: ImportSummary = { created: 0, updated: 0, ambiguous: [], errors: [] }

  const existing = await loadExisting()
  const index = buildIdentityIndex(existing.map((entry) => ({ row: entry.row, item: entry })))

  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  parsed.rows.forEach((source, rowIndex) => {
    const incoming = toMasterRow(source)
    const match = matchRow(index, incoming)

    if (match.status === 'ambiguous') {
      summary.ambiguous.push({ row: rowIndex, rule: match.rule })
      return
    }

    if (match.status === 'new') {
      summary.errors.push({
        row: rowIndex,
        message: `Produit introuvable dans le tableau maître : ${describeRow(incoming)}. Importez d’abord le fichier produits.`,
      })
      return
    }

    const quantity = readStockCell(source[COL.quantite])
    if (quantity.kind === 'invalid') {
      summary.errors.push({ row: rowIndex, message: `Quantité non numérique : « ${quantity.raw} ».` })
      return
    }

    const row = withMovement({
      ...match.item.row,
      [COL.stockActuel]: quantity.kind === 'empty' ? null : String(quantity.value),
    })

    operations.push({
      updateOne: {
        filter: { _id: match.item._id },
        update: { $set: { templateId: new Types.ObjectId(templateId), ...writeFields(row) } },
      },
    })
    summary.updated += 1
  })

  await flush(operations)
  return summary
}

/** De quoi que l'utilisateur reconnaisse la ligne fautive dans son fichier. */
function describeRow(row: MasterRow): string {
  return row[COL.identifiant] ?? row[COL.reference] ?? row[COL.nom] ?? '(ligne sans identifiant)'
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-import-stock.service.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/services/shopcaisse-import.service.ts tests/services/shopcaisse-import-stock.service.test.ts
git commit -m "Ajoute l'import du fichier stock dans la colonne Stock actuel"
```

---

### Task 7 : Construction des deux CSV et contrôle d'alignement

**Files:**
- Create: `src/services/shopcaisse-export.service.ts`
- Test: `tests/services/shopcaisse-export.service.test.ts`

**Interfaces:**
- Consomme : `COL`, `PRODUCT_COLUMNS`, `STOCK_COLUMNS`, `MasterRow` (Task 1) ; `MasterEntry` (Task 4) ; `serializeCsvValue` de `@/services/catalog-export.service` (existant, réutilisé).
- Produit :
  - `PRODUCTS_FILE_NAME = 'export-produits.csv'`, `STOCK_FILE_NAME = 'export-stock.csv'`
  - `buildProductRows(entries: MasterEntry[]): MasterRow[]`
  - `buildStockRows(entries: MasterEntry[]): MasterRow[]`
  - `serializeCsv(columns: readonly string[], rows: MasterRow[]): string` — BOM, `;`, `\r\n`.
  - `interface AlignmentIssue { row: number; column: string; product: string; stock: string }` (`row` : numéro de ligne produit 1-based, hors en-tête)
  - `checkAlignment(productRows: MasterRow[], stockRows: MasterRow[]): AlignmentIssue[]`

- [ ] **Step 1 : Écrire le test qui échoue**

Couvre les tests obligatoires 13 à 19, 31 à 35.

```ts
// tests/services/shopcaisse-export.service.test.ts
import { describe, expect, it } from 'vitest'
import { COL, PRODUCT_COLUMNS, STOCK_COLUMNS, makeEmptyMasterRow, type MasterRow } from '@/lib/shopcaisse-columns'
import type { MasterEntry } from '@/services/shopcaisse-master.service'
import {
  buildProductRows,
  buildStockRows,
  checkAlignment,
  serializeCsv,
} from '@/services/shopcaisse-export.service'

function entry(id: string, values: Record<string, string | null>): MasterEntry {
  return { id, row: { ...makeEmptyMasterRow(), [COL.supprime]: '0', ...values } }
}

/** Les lignes de données du CSV, en-tête et BOM retirés. */
function dataLines(csv: string): string[] {
  return csv.replace(/^﻿/, '').split('\r\n').slice(1).filter(Boolean)
}

describe('buildProductRows', () => {
  it('produit les 19 colonnes ShopCaisse dans l’ordre', () => {
    const csv = serializeCsv(PRODUCT_COLUMNS, buildProductRows([entry('a', { [COL.nom]: 'Café' })]))
    expect(csv.replace(/^﻿/, '').split('\r\n')[0]).toBe(PRODUCT_COLUMNS.join(';'))
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
      ';Café Latte;Boissons;Entrée;Fournisseur A;20.0;10.0;SIMPLE;3760001000001;REF-001;Un café latte onctueux;UNIT;2.50;1;1;#190fa7;Dessert;;0',
    )
  })

  it('exporte Supprimé en binaire, jamais en Oui/Non', () => {
    const csv = serializeCsv(PRODUCT_COLUMNS, buildProductRows([
      entry('a', { [COL.nom]: 'A', [COL.supprime]: 'Oui' }),
      entry('b', { [COL.nom]: 'B', [COL.supprime]: 'Non' }),
    ]))
    expect(csv).not.toMatch(/;Oui/)
    expect(csv).not.toMatch(/;Non/)
    expect(dataLines(csv)[0].endsWith(';1')).toBe(true)
    expect(dataLines(csv)[1].endsWith(';0')).toBe(true)
  })

  it('conserve la ligne d’un produit marqué supprimé', () => {
    const rows = buildProductRows([entry('a', { [COL.nom]: 'Café', [COL.supprime]: '1' })])
    expect(rows).toHaveLength(1)
  })

  it('conserve les cellules vides', () => {
    const line = dataLines(serializeCsv(PRODUCT_COLUMNS, buildProductRows([entry('a', { [COL.nom]: 'Café' })])))[0]
    expect(line).toBe(';Café;;;;;;;;;;;;;;;;;0')
  })
})

describe('buildStockRows', () => {
  it('produit les 4 colonnes stock dans l’ordre', () => {
    const csv = serializeCsv(STOCK_COLUMNS, buildStockRows([entry('a', { [COL.nom]: 'Café' })]))
    expect(csv.replace(/^﻿/, '').split('\r\n')[0]).toBe('Identifiant;Référence;Nom;Quantité')
  })

  it('alimente Quantité depuis Mouvement stock, jamais depuis Stock souhaité', () => {
    const rows = buildStockRows([
      entry('a', { [COL.reference]: 'REF-001', [COL.nom]: 'Café', [COL.stockActuel]: '5', [COL.stockSouhaite]: '8', [COL.mouvementStock]: '3' }),
    ])
    expect(rows[0][COL.quantite]).toBe('3')
    expect(dataLines(serializeCsv(STOCK_COLUMNS, rows))[0]).toBe(';REF-001;Café;3')
  })

  it('exporte un mouvement nul comme 0', () => {
    const rows = buildStockRows([entry('a', { [COL.nom]: 'Café', [COL.mouvementStock]: '0' })])
    expect(rows[0][COL.quantite]).toBe('0')
  })

  it('exporte un mouvement négatif tel quel', () => {
    const rows = buildStockRows([entry('a', { [COL.nom]: 'Café', [COL.mouvementStock]: '-3' })])
    expect(rows[0][COL.quantite]).toBe('-3')
  })

  it('laisse la Quantité vide quand le mouvement est vide — jamais de zéro', () => {
    const rows = buildStockRows([entry('a', { [COL.nom]: 'Café' })])
    expect(rows[0][COL.quantite]).toBeNull()
    expect(dataLines(serializeCsv(STOCK_COLUMNS, rows))[0]).toBe(';;Café;')
  })

  it('garde la ligne d’un mouvement vide ou nul', () => {
    const rows = buildStockRows([
      entry('a', { [COL.nom]: 'A' }),
      entry('b', { [COL.nom]: 'B', [COL.mouvementStock]: '0' }),
    ])
    expect(rows).toHaveLength(2)
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

  it('sépare par point-virgule et termine les lignes en CRLF', () => {
    const csv = serializeCsv(STOCK_COLUMNS, buildStockRows([entry('a', { [COL.nom]: 'Café' })]))
    expect(csv.replace(/^﻿/, '')).toBe('Identifiant;Référence;Nom;Quantité\r\n;;Café;\r\n')
  })

  it('échappe une valeur contenant le séparateur', () => {
    const rows: MasterRow[] = [{ [COL.identifiant]: null, [COL.reference]: null, [COL.nom]: 'Café; sucre', [COL.quantite]: null }]
    expect(serializeCsv(STOCK_COLUMNS, rows)).toContain('"Café; sucre"')
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-export.service.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/shopcaisse-export.service"`.

- [ ] **Step 3 : Écrire le service**

```ts
// src/services/shopcaisse-export.service.ts
import { COL, PRODUCT_COLUMNS, STOCK_COLUMNS, type MasterRow } from '@/lib/shopcaisse-columns'
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
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-export.service.test.ts`
Expected: PASS (22 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/services/shopcaisse-export.service.ts tests/services/shopcaisse-export.service.test.ts
git commit -m "Ajoute la construction des deux CSV ShopCaisse et le contrôle d'alignement"
```

---

### Task 8 : Validation avant export et résumé

**Files:**
- Create: `src/services/shopcaisse-validation.service.ts`
- Test: `tests/services/shopcaisse-validation.service.test.ts`

**Interfaces:**
- Consomme : `COL` (Task 1) ; `readStockCell` (Task 2) ; `findConflicts`, `IdentityRule` (Task 3) ; `listMasterEntries`, `MasterEntry` (Task 4) ; `buildProductRows`, `buildStockRows`, `checkAlignment`, `AlignmentIssue` (Task 7).
- Produit :

```ts
interface ExportSummary {
  total: number
  existing: number
  newWithoutId: number
  deleted: number
  movementsPositive: number
  movementsNegative: number
  movementsZero: number
  movementsEmpty: number
  duplicates: number
  ambiguous: number
  productRowCount: number
  stockRowCount: number
  sameRowCount: boolean
  alignment: 'Conforme' | 'Erreur'
}
interface RowIssue {
  row: number                    // numéro de ligne 1-based du tableau maître
  id: string                     // id MongoDB, pour pointer la ligne dans l'UI
  identifiant: string | null
  reference: string | null
  nom: string | null
  reason: string
  rule: IdentityRule | null      // règle qui a détecté le conflit ; null si ce n'en est pas un
  relatedRows: number[]
}
interface MasterValidation {
  summary: ExportSummary
  blockers: RowIssue[]
  conflicts: RowIssue[]
  alignmentIssues: AlignmentIssue[]
  canExport: boolean
}
```
  - `validateMasterEntries(entries: MasterEntry[]): MasterValidation` (pur, testable sans base)
  - `validateMaster(): Promise<MasterValidation>` (lit la base via `listMasterEntries`)

- [ ] **Step 1 : Écrire le test qui échoue**

Couvre les tests obligatoires 20 à 30 et 38.

```ts
// tests/services/shopcaisse-validation.service.test.ts
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
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-validation.service.test.ts`
Expected: FAIL — `Failed to resolve import "@/services/shopcaisse-validation.service"`.

- [ ] **Step 3 : Écrire le service**

```ts
// src/services/shopcaisse-validation.service.ts
import { COL, type MasterRow } from '@/lib/shopcaisse-columns'
import { findConflicts, type IdentityRule } from '@/lib/shopcaisse-identity'
import { readStockCell } from '@/lib/shopcaisse-stock'
import {
  buildProductRows,
  buildStockRows,
  checkAlignment,
  type AlignmentIssue,
} from '@/services/shopcaisse-export.service'
import { listMasterEntries, type MasterEntry } from '@/services/shopcaisse-master.service'

export interface ExportSummary {
  total: number
  existing: number
  newWithoutId: number
  deleted: number
  movementsPositive: number
  movementsNegative: number
  movementsZero: number
  movementsEmpty: number
  duplicates: number
  ambiguous: number
  productRowCount: number
  stockRowCount: number
  sameRowCount: boolean
  alignment: 'Conforme' | 'Erreur'
}

export interface RowIssue {
  /** Numéro de ligne 1-based du tableau maître, tel qu'il s'affiche à l'écran. */
  row: number
  id: string
  identifiant: string | null
  reference: string | null
  nom: string | null
  reason: string
  /** Règle d'identification qui a détecté le conflit ; null hors conflit. */
  rule: IdentityRule | null
  relatedRows: number[]
}

export interface MasterValidation {
  summary: ExportSummary
  blockers: RowIssue[]
  conflicts: RowIssue[]
  alignmentIssues: AlignmentIssue[]
  canExport: boolean
}

export async function validateMaster(): Promise<MasterValidation> {
  return validateMasterEntries(await listMasterEntries())
}

/**
 * Contrôle le tableau maître avant export.
 *
 * Pur et séparé de la lecture en base : c'est la partie qui porte les règles
 * métier, et elle doit pouvoir se tester ligne par ligne sans Mongo.
 */
export function validateMasterEntries(entries: MasterEntry[]): MasterValidation {
  const productRows = buildProductRows(entries)
  const stockRows = buildStockRows(entries)
  const alignmentIssues = checkAlignment(productRows, stockRows)

  const blockers = entries.flatMap((entry, index) => rowBlockers(entry, index))
  const conflicts = collectConflicts(entries)

  const summary: ExportSummary = {
    ...countRows(entries),
    duplicates: conflicts.filter((issue) => issue.rule === 'Identifiant' || issue.rule === 'Référence').length,
    ambiguous: conflicts.filter((issue) => issue.rule === 'Nom + Code barre').length,
    productRowCount: productRows.length,
    stockRowCount: stockRows.length,
    sameRowCount: productRows.length === stockRows.length,
    alignment: alignmentIssues.length ? 'Erreur' : 'Conforme',
  }

  return {
    summary,
    blockers,
    conflicts,
    alignmentIssues,
    canExport: !blockers.length && !conflicts.length && !alignmentIssues.length,
  }
}

function countRows(entries: MasterEntry[]) {
  const counts = {
    total: entries.length,
    existing: 0,
    newWithoutId: 0,
    deleted: 0,
    movementsPositive: 0,
    movementsNegative: 0,
    movementsZero: 0,
    movementsEmpty: 0,
  }

  for (const { row } of entries) {
    if (isNewProduct(row)) counts.newWithoutId += 1
    else counts.existing += 1
    if (row[COL.supprime] === '1') counts.deleted += 1

    const movement = readStockCell(row[COL.mouvementStock])
    if (movement.kind !== 'number') counts.movementsEmpty += 1
    else if (movement.value > 0) counts.movementsPositive += 1
    else if (movement.value < 0) counts.movementsNegative += 1
    else counts.movementsZero += 1
  }

  return counts
}

/**
 * Un produit sans Identifiant ShopCaisse n'existe pas encore côté caisse.
 * On ne lui en fabrique jamais un : l'Identifiant est délivré par ShopCaisse.
 */
function isNewProduct(row: MasterRow): boolean {
  return !String(row[COL.identifiant] ?? '').trim()
}

function rowBlockers(entry: MasterEntry, index: number): RowIssue[] {
  const { row } = entry
  const issues: string[] = []

  for (const column of [COL.stockActuel, COL.stockSouhaite]) {
    const cell = readStockCell(row[column])
    if (cell.kind === 'invalid') issues.push(`${column} non numérique : « ${cell.raw} ».`)
  }

  if (isNewProduct(row)) {
    if (!String(row[COL.nom] ?? '').trim()) issues.push('Nom obligatoire pour un nouveau produit.')
    if (!String(row[COL.reference] ?? '').trim()) {
      issues.push('Référence obligatoire pour un nouveau produit.')
    }

    // §4 : un produit qui n'existe pas encore côté caisse n'a d'intérêt à
    // l'import que s'il apporte du stock. Un mouvement nul ou négatif sur un
    // produit inconnu de ShopCaisse ne veut rien dire.
    const target = readStockCell(row[COL.stockSouhaite])
    if (target.kind !== 'number' || target.value <= 0) {
      issues.push('Stock souhaité obligatoire et strictement positif pour un nouveau produit.')
    }
  }

  return issues.map((reason) => ({ ...describe(entry, index), reason, rule: null, relatedRows: [] }))
}

function collectConflicts(entries: MasterEntry[]): RowIssue[] {
  return findConflicts(entries.map((entry) => entry.row)).map((conflict) => ({
    ...describe(entries[conflict.row], conflict.row),
    rule: conflict.rule,
    reason: `${conflict.rule} en conflit : « ${conflict.value} » désigne aussi la ou les lignes ${conflict.relatedRows
      .map((row) => row + 1)
      .join(', ')}. Résolvez le conflit à la main avant l’export.`,
    relatedRows: conflict.relatedRows.map((row) => row + 1),
  }))
}

function describe(entry: MasterEntry, index: number) {
  return {
    row: index + 1,
    id: entry.id,
    identifiant: entry.row[COL.identifiant] ?? null,
    reference: entry.row[COL.reference] ?? null,
    nom: entry.row[COL.nom] ?? null,
  }
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-validation.service.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/services/shopcaisse-validation.service.ts tests/services/shopcaisse-validation.service.test.ts
git commit -m "Ajoute la validation du tableau maître avant export"
```

---

### Task 9 : Archive ZIP du lot et blocage de l'export

**Files:**
- Modify: `package.json` (dépendance `jszip`)
- Create: `src/services/shopcaisse-bundle.service.ts`
- Test: `tests/services/shopcaisse-bundle.service.test.ts`

**Interfaces:**
- Consomme : `PRODUCT_COLUMNS`, `STOCK_COLUMNS` (Task 1) ; `listMasterEntries` (Task 4) ; `buildProductRows`, `buildStockRows`, `serializeCsv`, `PRODUCTS_FILE_NAME`, `STOCK_FILE_NAME` (Task 7) ; `validateMasterEntries`, `MasterValidation` (Task 8) ; `jszip`.
- Produit :
  - `class ExportBlockedError extends Error { readonly validation: MasterValidation }`
  - `buildExportBundle(): Promise<{ zip: Buffer; fileName: string; validation: MasterValidation }>`

**Pourquoi un fichier séparé :** `shopcaisse-validation.service` importe déjà les constructeurs de lignes depuis `shopcaisse-export.service`. Y ajouter `buildExportBundle`, qui appelle la validation, créerait un cycle d'imports entre les deux modules. Le lot vit donc dans son propre module, en aval des deux.

- [ ] **Step 1 : Installer jszip**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm install jszip@3.10.1
```

- [ ] **Step 2 : Écrire le test qui échoue**

Couvre les tests obligatoires 15, 16, 29, 30, 34, 36, 37.

```ts
// tests/services/shopcaisse-bundle.service.test.ts
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, makeEmptyMasterRow } from '@/lib/shopcaisse-columns'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { PRODUCTS_FILE_NAME, STOCK_FILE_NAME } from '@/services/shopcaisse-export.service'
import { buildExportBundle, ExportBlockedError } from '@/services/shopcaisse-bundle.service'

withTestDatabase()

async function seed(rows: Array<Partial<Record<string, string>>>) {
  const templateId = await ensureMasterTemplate()
  for (const values of rows) {
    const csvData = { ...makeEmptyMasterRow(), [COL.supprime]: '0', ...values }
    await CatalogProduct.create({ templateId, csvData, isDeleted: csvData[COL.supprime] === '1' })
  }
}

/** Les fichiers de l'archive, décodés en texte. */
async function readZip(zip: Buffer): Promise<Record<string, string>> {
  const archive = await JSZip.loadAsync(zip)
  const out: Record<string, string> = {}
  for (const name of Object.keys(archive.files)) out[name] = await archive.files[name].async('string')
  return out
}

describe('buildExportBundle', () => {
  it('génère une archive contenant les deux fichiers, et rien d’autre', async () => {
    await seed([{ [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café' }])
    const { zip, fileName } = await buildExportBundle()

    const files = await readZip(zip)
    expect(Object.keys(files).sort()).toEqual([PRODUCTS_FILE_NAME, STOCK_FILE_NAME].sort())
    expect(fileName).toMatch(/^lot-shopcaisse-\d{4}-\d{2}-\d{2}\.zip$/)
  })

  it('écrit les deux fichiers en UTF-8 avec BOM et séparateur point-virgule', async () => {
    await seed([{ [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café à emporter' }])
    const files = await readZip((await buildExportBundle()).zip)

    for (const name of [PRODUCTS_FILE_NAME, STOCK_FILE_NAME]) {
      expect(files[name].startsWith('﻿')).toBe(true)
      expect(files[name]).toContain(';')
      expect(files[name]).toContain('Café à emporter')
    }
  })

  it('donne aux deux fichiers le même nombre de lignes et le même ordre', async () => {
    await seed([
      { [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café', [COL.mouvementStock]: '3' },
      { [COL.identifiant]: '2', [COL.reference]: 'REF-2', [COL.nom]: 'Thé' },
      { [COL.identifiant]: '3', [COL.reference]: 'REF-3', [COL.nom]: 'Vase', [COL.supprime]: '1' },
    ])
    const files = await readZip((await buildExportBundle()).zip)

    const lines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n').slice(1).filter(Boolean)
    const products = lines(files[PRODUCTS_FILE_NAME])
    const stock = lines(files[STOCK_FILE_NAME])

    expect(products).toHaveLength(3)
    expect(stock).toHaveLength(3)
    // Ligne à ligne, le même produit : le Nom est en 2e position côté produits, en 3e côté stock.
    expect(products.map((line) => line.split(';')[1])).toEqual(['Café', 'Thé', 'Vase'])
    expect(stock.map((line) => line.split(';')[2])).toEqual(['Café', 'Thé', 'Vase'])
  })

  it('renvoie le résumé de l’export', async () => {
    await seed([
      { [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café', [COL.mouvementStock]: '3' },
      { [COL.reference]: 'REF-2', [COL.nom]: 'Nouveau', [COL.stockSouhaite]: '2', [COL.mouvementStock]: '2' },
    ])
    const { validation } = await buildExportBundle()

    expect(validation.summary).toMatchObject({
      total: 2,
      existing: 1,
      newWithoutId: 1,
      movementsPositive: 2,
      alignment: 'Conforme',
      sameRowCount: true,
      productRowCount: 2,
      stockRowCount: 2,
    })
  })

  it('bloque l’export en cas de doublon non résolu', async () => {
    await seed([
      { [COL.identifiant]: '42', [COL.reference]: 'REF-1', [COL.nom]: 'A' },
      { [COL.identifiant]: '42', [COL.reference]: 'REF-2', [COL.nom]: 'B' },
    ])

    await expect(buildExportBundle()).rejects.toThrow(ExportBlockedError)
  })

  it('bloque l’export en cas d’ambiguïté et rend la validation avec l’erreur', async () => {
    await seed([
      { [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café', [COL.codeBarre]: '111' },
      { [COL.identifiant]: '2', [COL.reference]: 'REF-2', [COL.nom]: 'café', [COL.codeBarre]: '111' },
    ])

    const error = await buildExportBundle().catch((e: ExportBlockedError) => e)
    expect(error).toBeInstanceOf(ExportBlockedError)
    expect((error as ExportBlockedError).validation.conflicts).toHaveLength(2)
    expect((error as ExportBlockedError).validation.canExport).toBe(false)
  })

  it('bloque l’export quand une donnée obligatoire manque', async () => {
    await seed([{ [COL.nom]: 'Nouveau sans référence', [COL.stockSouhaite]: '2' }])
    await expect(buildExportBundle()).rejects.toThrow(ExportBlockedError)
  })

  it('exporte un catalogue vide sans jeter', async () => {
    await ensureMasterTemplate()
    const files = await readZip((await buildExportBundle()).zip)
    expect(files[PRODUCTS_FILE_NAME].replace(/^﻿/, '').split('\r\n').filter(Boolean)).toHaveLength(1)
  })
})
```

- [ ] **Step 3 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-bundle.service.test.ts`
Expected: FAIL — `buildExportBundle is not a function`.

- [ ] **Step 4 : Écrire le service de lot**

```ts
// src/services/shopcaisse-bundle.service.ts
import JSZip from 'jszip'
import { PRODUCT_COLUMNS, STOCK_COLUMNS } from '@/lib/shopcaisse-columns'
import {
  buildProductRows,
  buildStockRows,
  PRODUCTS_FILE_NAME,
  serializeCsv,
  STOCK_FILE_NAME,
} from '@/services/shopcaisse-export.service'
import { listMasterEntries } from '@/services/shopcaisse-master.service'
import { validateMasterEntries, type MasterValidation } from '@/services/shopcaisse-validation.service'

/**
 * L'export a été refusé. Porte la validation complète pour que l'appelant
 * puisse dire à l'utilisateur quelles lignes corriger, et non seulement « non ».
 */
export class ExportBlockedError extends Error {
  constructor(readonly validation: MasterValidation) {
    super('Export bloqué : corrigez les erreurs signalées avant de télécharger le lot.')
    this.name = 'ExportBlockedError'
  }
}

/**
 * Construit le lot ShopCaisse : les deux CSV, dans une archive, depuis une
 * seule et même liste de lignes maître.
 *
 * `listMasterEntries` est appelé une fois : relire la base pour chaque fichier
 * ouvrirait la porte à une écriture concurrente entre les deux lectures, et
 * donc à deux fichiers désalignés.
 */
export async function buildExportBundle(): Promise<{
  zip: Buffer
  fileName: string
  validation: MasterValidation
}> {
  const entries = await listMasterEntries()
  const validation = validateMasterEntries(entries)

  if (!validation.canExport) throw new ExportBlockedError(validation)

  const zip = new JSZip()
  zip.file(PRODUCTS_FILE_NAME, serializeCsv(PRODUCT_COLUMNS, buildProductRows(entries)))
  zip.file(STOCK_FILE_NAME, serializeCsv(STOCK_COLUMNS, buildStockRows(entries)))

  return {
    zip: await zip.generateAsync({ type: 'nodebuffer' }),
    fileName: `lot-shopcaisse-${new Date().toISOString().slice(0, 10)}.zip`,
    validation,
  }
}
```

- [ ] **Step 5 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-bundle.service.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add package.json package-lock.json src/services/shopcaisse-bundle.service.ts tests/services/shopcaisse-bundle.service.test.ts
git commit -m "Ajoute l'archive ZIP du lot ShopCaisse et le blocage de l'export"
```

---

### Task 10 : Routes API ShopCaisse

**Files:**
- Create: `src/lib/validations/shopcaisse.schema.ts`
- Create: `src/app/api/admin/shopcaisse/import/route.ts`
- Create: `src/app/api/admin/shopcaisse/export/route.ts`
- Create: `src/app/api/admin/shopcaisse/export-summary/route.ts`
- Test: `tests/services/shopcaisse-routes.test.ts`

**Interfaces:**
- Consomme : `importProductsIntoMaster`, `importStockIntoMaster` (Tasks 5-6) ; `buildExportBundle`, `ExportBlockedError` (Task 9) ; `validateMaster` (Task 8) ; `CsvImport` et `parseCsvBuffer` (existants) ; `objectIdSchema` de `@/lib/validations/csv-template.schema` (existant).
- Produit :
  - `POST /api/admin/shopcaisse/import` — corps `{ importId: string, kind: 'products' | 'stock' }` → `{ summary }` (201) ou `{ error, message }` (400).
  - `GET /api/admin/shopcaisse/export-summary` → `{ validation }`.
  - `GET /api/admin/shopcaisse/export` → ZIP (200) ou `{ error: 'export_blocked', validation }` (409).
  - `importCsvIntoMaster(importId: string, kind: 'products' | 'stock'): Promise<ImportSummary>` exporté depuis `shopcaisse-import.service.ts`.

- [ ] **Step 1 : Écrire le test qui échoue**

Les routes App Router s'appellent directement, comme des fonctions : c'est ce que font déjà les tests d'intégration du dépôt.

```ts
// tests/services/shopcaisse-routes.test.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvImport } from '@/models/CsvImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL } from '@/lib/shopcaisse-columns'
import { POST as importRoute } from '@/app/api/admin/shopcaisse/import/route'
import { GET as exportRoute } from '@/app/api/admin/shopcaisse/export/route'
import { GET as summaryRoute } from '@/app/api/admin/shopcaisse/export-summary/route'

withTestDatabase()

const FIXTURES = join(process.cwd(), 'tests/fixtures/shopcaisse')

async function upload(fixture: string): Promise<string> {
  const buffer = readFileSync(join(FIXTURES, fixture))
  const doc = await CsvImport.create({
    originalFileName: fixture,
    rawContent: buffer,
    fileSize: buffer.byteLength,
    mimeType: 'text/csv',
    encoding: 'utf-8',
    delimiter: ';',
    columns: [],
    rowCount: 1,
  })
  return String(doc._id)
}

function post(body: unknown) {
  return importRoute(
    new Request('http://localhost/api/admin/shopcaisse/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/admin/shopcaisse/import', () => {
  it('importe le fichier produits dans le maître', async () => {
    const response = await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    expect(response.status).toBe(201)

    const { summary } = await response.json()
    expect(summary.created).toBe(1)

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.csvData as Record<string, unknown>)[COL.nom]).toBe('Café Latte')
  })

  it('importe ensuite le fichier stock dans Stock actuel', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const response = await post({ importId: await upload('export-stock-modele.csv'), kind: 'stock' })

    expect(response.status).toBe(201)
    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.csvData as Record<string, unknown>)[COL.stockActuel]).toBe('2')
  })

  it('refuse un corps invalide', async () => {
    expect((await post({ importId: 'pas-un-id', kind: 'products' })).status).toBe(400)
    expect((await post({ importId: await upload('export-produits.csv'), kind: 'stocks' })).status).toBe(400)
  })

  it('refuse un import inexistant', async () => {
    const response = await post({ importId: '000000000000000000000000', kind: 'products' })
    expect(response.status).toBe(400)
    expect((await response.json()).message).toContain('introuvable')
  })
})

describe('GET /api/admin/shopcaisse/export-summary', () => {
  it('rend la validation sans télécharger', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const { validation } = await (await summaryRoute()).json()

    expect(validation.summary.total).toBe(1)
    expect(validation.summary.alignment).toBe('Conforme')
    expect(validation.canExport).toBe(true)
  })
})

describe('GET /api/admin/shopcaisse/export', () => {
  it('renvoie une archive ZIP contenant les deux fichiers', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const response = await exportRoute()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toContain('lot-shopcaisse-')

    const archive = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(Object.keys(archive.files).sort()).toEqual(['export-produits.csv', 'export-stock.csv'])
  })

  it('répond 409 et détaille les erreurs quand l’export est bloqué', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    // Un second produit au même Identifiant : conflit non résolu.
    const product = await CatalogProduct.findOne({}).lean()
    await CatalogProduct.create({
      templateId: product!.templateId,
      csvData: { ...(product!.csvData as Record<string, unknown>), [COL.identifiant]: 'X', [COL.reference]: 'REF-001' },
    })
    await CatalogProduct.updateOne({ _id: product!._id }, { $set: { [`csvData.${COL.identifiant}`]: 'X' } })

    const response = await exportRoute()
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('export_blocked')
    expect(body.validation.conflicts.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-routes.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/admin/shopcaisse/import/route"`.

- [ ] **Step 3 : Écrire le schéma Zod**

```ts
// src/lib/validations/shopcaisse.schema.ts
import { z } from 'zod'
import { objectIdSchema } from '@/lib/validations/csv-template.schema'

export const shopcaisseImportSchema = z.object({
  importId: objectIdSchema,
  kind: z.enum(['products', 'stock']),
})

export type ShopcaisseImportKind = z.infer<typeof shopcaisseImportSchema>['kind']
```

- [ ] **Step 4 : Ajouter le point d'entrée d'import au service**

En fin de `src/services/shopcaisse-import.service.ts`, ajouter (et importer `CsvImport` et `parseCsvBuffer` en tête) :

```ts
// en tête
import { CsvImport } from '@/models/CsvImport'
import { parseCsvBuffer } from '@/services/csv-parser.service'
```

```ts
/**
 * Rejoue les octets d'origine d'un import déjà stocké.
 *
 * Relire depuis la base plutôt que de reparser côté route : c'est la seule
 * façon de retrouver l'encodage exact et les valeurs telles qu'elles étaient
 * dans le fichier, exactement comme le fait `createTemplateFromImport`.
 */
export async function importCsvIntoMaster(
  importId: string,
  kind: 'products' | 'stock',
): Promise<ImportSummary> {
  await connectToDatabase()

  const csvImport = await CsvImport.findById(importId)
  if (!csvImport) throw new Error('Import CSV introuvable.')

  const parsed = parseCsvBuffer(Buffer.from(csvImport.rawContent))

  return kind === 'products' ? importProductsIntoMaster(parsed) : importStockIntoMaster(parsed)
}
```

- [ ] **Step 5 : Écrire les trois routes**

```ts
// src/app/api/admin/shopcaisse/import/route.ts
import { NextResponse } from 'next/server'
import { shopcaisseImportSchema } from '@/lib/validations/shopcaisse.schema'
import { importCsvIntoMaster } from '@/services/shopcaisse-import.service'

export async function POST(request: Request) {
  const parsed = shopcaisseImportSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const summary = await importCsvIntoMaster(parsed.data.importId, parsed.data.kind)
    return NextResponse.json({ summary }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import impossible.'
    return NextResponse.json({ error: 'import_failed', message }, { status: 400 })
  }
}
```

```ts
// src/app/api/admin/shopcaisse/export-summary/route.ts
import { NextResponse } from 'next/server'
import { validateMaster } from '@/services/shopcaisse-validation.service'

export async function GET() {
  try {
    return NextResponse.json({ validation: await validateMaster() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Résumé impossible.'
    return NextResponse.json({ error: 'summary_failed', message }, { status: 500 })
  }
}
```

```ts
// src/app/api/admin/shopcaisse/export/route.ts
import { NextResponse } from 'next/server'
import { buildExportBundle, ExportBlockedError } from '@/services/shopcaisse-bundle.service'

export async function GET() {
  try {
    const { zip, fileName } = await buildExportBundle()

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    // 409 et non 400 : la requête est correcte, c'est l'état du tableau maître
    // qui interdit l'export. La validation part avec, pour que l'utilisateur
    // sache quoi corriger.
    if (error instanceof ExportBlockedError) {
      return NextResponse.json(
        { error: 'export_blocked', message: error.message, validation: error.validation },
        { status: 409 },
      )
    }

    const message = error instanceof Error ? error.message : 'Export impossible.'
    return NextResponse.json({ error: 'export_failed', message }, { status: 500 })
  }
}
```

- [ ] **Step 6 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-routes.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 7 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/lib/validations/shopcaisse.schema.ts src/app/api/admin/shopcaisse src/services/shopcaisse-import.service.ts tests/services/shopcaisse-routes.test.ts
git commit -m "Ajoute les routes d'import et d'export du lot ShopCaisse"
```

---

### Task 11 : Édition du maître — colonnes en lecture seule, mouvement recalculé, `Supprimé` en miroir

**Files:**
- Modify: `src/services/catalog-product.service.ts:12-37` (`listCatalogProducts`), `:63-75` (`listAllCatalogProducts`), `:78-91` (`updateCatalogProductCells`)
- Test: `tests/services/catalog-product-edit.service.test.ts` (existant, à compléter)
- Test: `tests/services/catalog-product.service.test.ts` (existant, à mettre à jour)

**Interfaces:**
- Consomme : `COL` (Task 1) ; `computeMovement` (Task 2) ; `normalizeSupprime`, `toMasterRow`, `withMovement` (Task 4).
- Produit : `updateCatalogProductCells(id, cells)` conserve sa signature ; elle jette désormais sur une colonne en lecture seule ou une valeur de stock illisible.

- [ ] **Step 1 : Écrire les tests qui échouent**

Ajouter à `tests/services/catalog-product-edit.service.test.ts` (garder les tests existants) :

```ts
// imports à ajouter en tête du fichier
import { COL } from '@/lib/shopcaisse-columns'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
```

```ts
describe('updateCatalogProductCells — règles du tableau maître', () => {
  async function makeMasterProduct(values: Partial<Record<string, string>> = {}) {
    const templateId = await ensureMasterTemplate()
    const product = await CatalogProduct.create({
      templateId,
      csvData: { [COL.identifiant]: '42', [COL.nom]: 'Café', [COL.supprime]: '0', ...values },
    })
    return String(product._id)
  }

  async function readRow(id: string) {
    const product = await CatalogProduct.findById(id).lean()
    return product!.csvData as Record<string, unknown>
  }

  it('recalcule Mouvement stock quand Stock souhaité change', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5' })
    await updateCatalogProductCells(id, { [COL.stockSouhaite]: '8' })
    expect((await readRow(id))[COL.mouvementStock]).toBe('3')
  })

  it('recalcule Mouvement stock quand Stock actuel change', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5', [COL.stockSouhaite]: '8', [COL.mouvementStock]: '3' })
    await updateCatalogProductCells(id, { [COL.stockActuel]: '11' })
    expect((await readRow(id))[COL.mouvementStock]).toBe('-3')
  })

  it('vide Mouvement stock quand un des deux stocks est effacé', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5', [COL.stockSouhaite]: '8', [COL.mouvementStock]: '3' })
    await updateCatalogProductCells(id, { [COL.stockSouhaite]: null })
    expect((await readRow(id))[COL.mouvementStock]).toBeNull()
  })

  it('refuse une valeur de stock non numérique et n’écrit rien', async () => {
    const id = await makeMasterProduct({ [COL.stockActuel]: '5' })
    await expect(updateCatalogProductCells(id, { [COL.stockSouhaite]: 'huit' })).rejects.toThrow(
      'Stock souhaité non numérique : « huit ».',
    )
    expect((await readRow(id))[COL.stockSouhaite]).toBeUndefined()
  })

  it('refuse d’écrire dans Identifiant', async () => {
    const id = await makeMasterProduct()
    await expect(updateCatalogProductCells(id, { [COL.identifiant]: '99' })).rejects.toThrow(
      'Colonne en lecture seule : Identifiant.',
    )
  })

  it('refuse d’écrire dans Mouvement stock', async () => {
    const id = await makeMasterProduct()
    await expect(updateCatalogProductCells(id, { [COL.mouvementStock]: '99' })).rejects.toThrow(
      'Colonne en lecture seule : Mouvement stock.',
    )
  })

  it('normalise Supprimé et le reporte dans isDeleted', async () => {
    const id = await makeMasterProduct()
    await updateCatalogProductCells(id, { [COL.supprime]: 'Oui' })

    expect((await readRow(id))[COL.supprime]).toBe('1')
    expect((await CatalogProduct.findById(id).lean())!.isDeleted).toBe(true)
  })

  it('remet isDeleted à false quand on repasse Supprimé à Non', async () => {
    const id = await makeMasterProduct({ [COL.supprime]: '1' })
    await updateCatalogProductCells(id, { [COL.supprime]: 'Non' })

    expect((await readRow(id))[COL.supprime]).toBe('0')
    expect((await CatalogProduct.findById(id).lean())!.isDeleted).toBe(false)
  })

  it('laisse éditer librement une colonne produit', async () => {
    const id = await makeMasterProduct()
    await updateCatalogProductCells(id, { [COL.nom]: 'Café Latte', [COL.famille]: 'Boissons' })
    const row = await readRow(id)
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.famille]).toBe('Boissons')
  })
})
```

Ajouter à `tests/services/catalog-product.service.test.ts` :

```ts
describe('listCatalogProducts — lignes marquées supprimées', () => {
  it('conserve dans le tableau maître une ligne marquée supprimée', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({ templateId, csvData: { Nom: 'Vase' }, isDeleted: true })

    const result = await listCatalogProducts({ page: 1, pageSize: 50 })
    expect(result.total).toBe(1)
    expect(result.products).toHaveLength(1)
  })
})
```

- [ ] **Step 2 : Vérifier que les tests échouent**

Run: `npx vitest run tests/services/catalog-product-edit.service.test.ts tests/services/catalog-product.service.test.ts`
Expected: FAIL — le mouvement n'est pas recalculé, les colonnes en lecture seule s'écrivent, la ligne supprimée est absente.

Certains tests existants de ces fichiers peuvent supposer le filtre `isDeleted: false`. Les mettre à jour : le maître montre désormais toutes les lignes, la suppression étant portée par la colonne `Supprimé` (décision L5-3).

- [ ] **Step 3 : Modifier le service**

Remplacer les trois fonctions dans `src/services/catalog-product.service.ts`. Ajouter en tête :

```ts
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement, readStockCell } from '@/lib/shopcaisse-stock'
import { normalizeSupprime } from '@/services/shopcaisse-master.service'
```

`listCatalogProducts` — retirer le filtre des deux requêtes :

```ts
export async function listCatalogProducts(options: { page: number; pageSize: number }) {
  await connectToDatabase()

  const page = Math.max(1, options.page)
  const pageSize = Math.min(500, Math.max(1, options.pageSize))

  // Plus de filtre isDeleted : une ligne marquée « Supprimé » reste dans le
  // tableau maître et dans les deux exports — c'est ce marquage que ShopCaisse
  // doit lire pour supprimer l'article de son côté.
  const [products, total] = await Promise.all([
    CatalogProduct.find({})
      .sort({ _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select('csvData')
      .lean(),
    CatalogProduct.countDocuments({}),
  ])

  return {
    products: products.map((product) => ({
      id: String(product._id),
      csvData: (product.csvData ?? {}) as Record<string, unknown>,
    })),
    total,
    page,
    pageSize,
  }
}
```

`listAllCatalogProducts` — même retrait :

```ts
export async function listAllCatalogProducts(): Promise<
  Array<{ id: string; csvData: Record<string, unknown> }>
> {
  await connectToDatabase()
  const products = await CatalogProduct.find({}).sort({ _id: 1 }).select('csvData').lean()
  return products.map((product) => ({
    id: String(product._id),
    csvData: (product.csvData ?? {}) as Record<string, unknown>,
  }))
}
```

`updateCatalogProductCells` — devient le gardien des règles du maître :

```ts
/** Renseignées par l'application, jamais par l'utilisateur. */
const READ_ONLY_COLUMNS: readonly string[] = [COL.identifiant, COL.mouvementStock]

/**
 * Écrit des cellules du tableau maître.
 *
 * Lit le document avant d'écrire : `Mouvement stock` dépend des deux colonnes
 * de stock, et la modification n'en porte qu'une. Sans relecture, on
 * recalculerait le mouvement contre une valeur inconnue.
 *
 * Une valeur vide devient null (jamais 0), jamais inventée.
 */
export async function updateCatalogProductCells(
  id: string,
  cells: Record<string, string | null>,
): Promise<void> {
  if (!isValidObjectId(id)) throw new Error('Identifiant de produit invalide.')
  if (!Object.keys(cells).length) return

  for (const column of Object.keys(cells)) {
    // L'Identifiant est délivré par ShopCaisse ; le mouvement est un calcul.
    // Les laisser écrire produirait un fichier que la caisse rejetterait.
    if (READ_ONLY_COLUMNS.includes(column)) throw new Error(`Colonne en lecture seule : ${column}.`)
  }

  await connectToDatabase()

  const product = await CatalogProduct.findById(id).select('csvData').lean()
  if (!product) throw new Error('Produit introuvable.')

  const current = (product.csvData ?? {}) as Record<string, unknown>
  const set: Record<string, string | null | boolean> = {}
  const next = { ...current } as Record<string, string | null>

  for (const [column, value] of Object.entries(cells)) {
    const normalized =
      column === COL.supprime ? normalizeSupprime(value) : value === null || value === '' ? null : value
    set[`csvData.${column}`] = normalized
    next[column] = normalized
  }

  for (const column of [COL.stockActuel, COL.stockSouhaite]) {
    if (!(column in cells)) continue
    const cell = readStockCell(next[column])
    // On refuse avant d'écrire : une quantité illisible en base contaminerait
    // le mouvement et donc le fichier stock.
    if (cell.kind === 'invalid') throw new Error(`${column} non numérique : « ${cell.raw} ».`)
  }

  if (COL.stockActuel in cells || COL.stockSouhaite in cells) {
    const movement = computeMovement(next[COL.stockActuel], next[COL.stockSouhaite])
    set[`csvData.${COL.mouvementStock}`] = movement.kind === 'value' ? movement.text : null
  }

  // isDeleted suit la colonne : la page Comparer classe « supprimés » sur ce
  // champ, et les deux doivent raconter la même histoire (décision L5-3).
  if (COL.supprime in cells) set.isDeleted = next[COL.supprime] === '1'

  await CatalogProduct.updateOne({ _id: new Types.ObjectId(id) }, { $set: set })
}
```

- [ ] **Step 4 : Vérifier que les tests passent**

Run: `npx vitest run tests/services/catalog-product-edit.service.test.ts tests/services/catalog-product.service.test.ts`
Expected: PASS.

- [ ] **Step 5 : Vérifier qu'aucun autre test n'a régressé**

Run: `npm test`
Expected: PASS. Si `tests/services/catalog-export.service.test.ts` ou `tests/services/catalog-diff.service.test.ts` tombent, corriger le test et non le service : la ligne supprimée est désormais visible, c'est le comportement voulu.

- [ ] **Step 6 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/services/catalog-product.service.ts tests/services/catalog-product-edit.service.test.ts tests/services/catalog-product.service.test.ts
git commit -m "Applique les règles du tableau maître à l'édition des cellules"
```

---

### Task 12 : Import des deux fichiers depuis la page « Import CSV »

**Files:**
- Modify: `src/components/admin/CsvTemplateManager.tsx:41-65` (`importCsv`), `:86-106` (le bouton d'import)

**Interfaces:**
- Consomme : `POST /api/csv-imports` (existant), `POST /api/admin/shopcaisse/import` (Task 10).
- Produit : deux boutons distincts, `Importer les produits` et `Importer le stock`.

Pas de test automatisé : le projet n'a pas d'environnement DOM configuré dans `vitest.config.ts`, et toute la logique est déjà couverte côté service (Tasks 5, 6, 10). La vérification est le parcours manuel du Step 4.

- [ ] **Step 1 : Remplacer `importCsv` par un import typé**

Le flux générique `from-import` reste en place pour les CSV quelconques ; ce composant bascule sur les routes ShopCaisse.

```tsx
  async function importCsv(file: File, kind: 'products' | 'stock') {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploaded = await fetch('/api/csv-imports', { method: 'POST', body: formData }).then((r) => r.json())
      if (!uploaded.importId) throw new Error(uploaded.message ?? 'Import impossible.')

      const result = await fetch('/api/admin/shopcaisse/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: uploaded.importId, kind }),
      }).then((r) => r.json())
      if (!result.summary) throw new Error(result.message ?? 'Import impossible.')

      const { created, updated, ambiguous, errors } = result.summary
      const parts = [`${created} créé(s)`, `${updated} mis à jour`]
      if (ambiguous.length) parts.push(`${ambiguous.length} ligne(s) ambiguë(s), à résoudre dans « Comparer »`)
      if (errors.length) parts.push(`${errors.length} ligne(s) en erreur : ${errors[0].message}`)
      setMessage(`${kind === 'products' ? 'Produits' : 'Stock'} importé(s) — ${parts.join(', ')}.`)

      await refresh()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import impossible.')
    } finally {
      setBusy(false)
    }
  }
```

- [ ] **Step 2 : Deux entrées de fichier, deux boutons**

Remplacer l'unique `inputRef` par deux références. En tête du composant :

```tsx
  const productsInputRef = useRef<HTMLInputElement>(null)
  const stockInputRef = useRef<HTMLInputElement>(null)
```

Remplacer le bouton et l'input du bloc d'en-tête (`CsvTemplateManager.tsx:86-106`) par :

```tsx
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => productsInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Importer les produits
          </button>
          <button
            type="button"
            onClick={() => stockInputRef.current?.click()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Importer le stock
          </button>
        </div>
        <input
          ref={productsInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importCsv(file, 'products')
          }}
        />
        <input
          ref={stockInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importCsv(file, 'stock')
          }}
        />
```

- [ ] **Step 3 : Expliquer l'ordre des deux imports**

Sous le paragraphe « Template actif », ajouter le rappel de la contrainte ShopCaisse (§4 de la consigne) :

```tsx
          <p className="mt-1 text-sm text-slate-600">
            Importez d’abord <strong>export-produits.csv</strong>, puis le fichier stock : une quantité
            ne peut être rattachée qu’à un produit déjà présent dans le tableau maître.
          </p>
```

- [ ] **Step 4 : Vérifier dans l'application**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm run mongo:start
npm run dev
```

Sur `/admin/csv-template` : importer `docs/shopcaisse-metier/export-produits.csv` via « Importer les produits » → message « Produits importé(s) — 1 créé(s), 0 mis à jour ». Puis `docs/shopcaisse-metier/ export-stocks-modele.csv` via « Importer le stock » → « Stock importé(s) — 0 créé(s), 1 mis à jour ». Sur `/tous-les-produits`, la ligne « Café Latte » porte `Stock actuel = 2`.

- [ ] **Step 5 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/components/admin/CsvTemplateManager.tsx
git commit -m "Ajoute l'import séparé des fichiers produits et stock"
```

---

### Task 13 : Tableau maître — lecture seule, bascule Oui/Non, mouvement recalculé, export du lot

**Files:**
- Modify: `src/components/catalog/CatalogEditor.tsx`

**Interfaces:**
- Consomme : `COL`, `computeMovement` (Tasks 1-2) ; `GET /api/admin/shopcaisse/export-summary`, `GET /api/admin/shopcaisse/export` (Task 10) ; `PATCH /api/admin/catalog/products/[id]` (Task 11).
- Produit : rien pour les autres tâches.

Même remarque qu'en Task 12 : pas d'environnement DOM dans `vitest.config.ts`, la logique est couverte côté service, la vérification est le parcours manuel du Step 8.

- [ ] **Step 1 : Remplacer les imports d'en-tête**

`Trash2` disparaît : plus aucune suppression physique depuis cette page.

```tsx
import { Download, Filter, Package, Plus, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement } from '@/lib/shopcaisse-stock'
```

- [ ] **Step 2 : Déclarer les types et constantes du lot**

Au-dessus du composant, après la constante `operators` :

```tsx
/** Renseignées par l'application : l'Identifiant vient de ShopCaisse, le mouvement est un calcul. */
const READ_ONLY_COLUMNS: string[] = [COL.identifiant, COL.mouvementStock]

interface RowIssue {
  row: number
  id: string
  identifiant: string | null
  reference: string | null
  nom: string | null
  reason: string
  rule: string | null
  relatedRows: number[]
}

interface BundleValidation {
  summary: {
    total: number
    existing: number
    newWithoutId: number
    deleted: number
    movementsPositive: number
    movementsNegative: number
    movementsZero: number
    movementsEmpty: number
    duplicates: number
    ambiguous: number
    productRowCount: number
    stockRowCount: number
    sameRowCount: boolean
    alignment: 'Conforme' | 'Erreur'
  }
  blockers: RowIssue[]
  conflicts: RowIssue[]
  canExport: boolean
}
```

Après `const savingRef = useRef<Record<string, boolean>>({})` :

```tsx
  const [bundle, setBundle] = useState<BundleValidation | null>(null)
  const [bundleBusy, setBundleBusy] = useState(false)
```

- [ ] **Step 3 : Recalculer le mouvement à la saisie, remplacer la suppression par la bascule**

Remplacer `saveCell` et `removeProduct` par :

```tsx
  async function saveCell(product: Product, column: string, value: string) {
    const key = `${product.id}:${column}`
    savingRef.current[key] = true
    const cell = value === '' ? null : value

    // Optimiste, mouvement compris : l'utilisateur doit voir le résultat de sa
    // saisie sans attendre l'aller-retour serveur, qui refait le même calcul.
    setProducts((cur) =>
      cur.map((p) => {
        if (p.id !== product.id) return p
        const csvData: Record<string, unknown> = { ...p.csvData, [column]: cell }
        if (column === COL.stockActuel || column === COL.stockSouhaite) {
          const movement = computeMovement(csvData[COL.stockActuel], csvData[COL.stockSouhaite])
          csvData[COL.mouvementStock] = movement.kind === 'value' ? movement.text : null
        }
        return { ...p, csvData }
      }),
    )

    try {
      const res = await fetch(`/api/admin/catalog/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: { [column]: cell } }),
      })
      if (!res.ok) throw new Error((await res.json()).message ?? 'Enregistrement impossible.')
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.')
      // Le serveur a refusé : on recharge plutôt que de laisser à l'écran une
      // valeur que la base ne porte pas.
      await load()
    } finally {
      savingRef.current[key] = false
    }
  }

  /**
   * L'ancien « Effacer » ne supprime plus la ligne : il bascule la colonne
   * `Supprimé`. La ligne reste dans le maître et dans les deux exports — c'est
   * ce marquage que ShopCaisse lit pour supprimer l'article de son côté.
   */
  async function toggleSupprime(product: Product) {
    const next = String(product.csvData[COL.supprime] ?? '0') === '1' ? '0' : '1'
    await saveCell(product, COL.supprime, next)
  }
```

- [ ] **Step 4 : Remplacer les deux boutons d'export par le bouton principal**

Remplacer le `<div className="flex flex-wrap gap-2">` de l'en-tête (les deux liens « Exporter… ») par :

```tsx
          <button
            type="button"
            disabled={bundleBusy}
            onClick={async () => {
              setBundleBusy(true)
              setError('')
              try {
                const res = await fetch('/api/admin/shopcaisse/export-summary')
                const data = await res.json()
                if (!res.ok) throw new Error(data.message ?? 'Résumé impossible.')
                setBundle(data.validation)
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Résumé impossible.')
              } finally {
                setBundleBusy(false)
              }
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            <Download className="h-4 w-4" /> Exporter le lot ShopCaisse
          </button>
```

- [ ] **Step 5 : Afficher le résumé avant le téléchargement**

Juste après le bloc `{error && …}`, insérer :

```tsx
        {bundle && (
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <Package className="h-5 w-5" /> Lot ShopCaisse
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Archive ZIP contenant <strong>export-produits.csv</strong> et <strong>export-stock.csv</strong>.
                </p>
              </div>
              <button type="button" onClick={() => setBundle(null)} aria-label="Fermer le résumé" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {([
                ['Produits au total', bundle.summary.total],
                ['Produits existants', bundle.summary.existing],
                ['Nouveaux sans Identifiant', bundle.summary.newWithoutId],
                ['Marqués comme supprimés', bundle.summary.deleted],
                ['Mouvements positifs', bundle.summary.movementsPositive],
                ['Mouvements négatifs', bundle.summary.movementsNegative],
                ['Mouvements nuls', bundle.summary.movementsZero],
                ['Mouvements vides', bundle.summary.movementsEmpty],
                ['Doublons', bundle.summary.duplicates],
                ['Lignes ambiguës', bundle.summary.ambiguous],
              ] as Array<[string, number]>).map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-100 pb-1">
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>

            <p className={`rounded-2xl px-4 py-3 text-sm ${bundle.summary.alignment === 'Conforme' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
              Alignement des exports : <strong>{bundle.summary.alignment}</strong> — {bundle.summary.productRowCount} ligne(s)
              dans export-produits.csv, {bundle.summary.stockRowCount} dans export-stock.csv.{' '}
              {bundle.summary.sameRowCount
                ? 'Les deux fichiers ont le même nombre de lignes.'
                : 'Les deux fichiers n’ont pas le même nombre de lignes.'}
            </p>

            {bundle.summary.newWithoutId > 0 && (
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {bundle.summary.newWithoutId} nouveau(x) produit(s) sans Identifiant. ShopCaisse ne sait pas rattacher un
                mouvement de stock à un produit qu’il ne connaît pas encore : importez d’abord export-produits.csv dans
                ShopCaisse, réexportez les produits pour récupérer leurs nouveaux Identifiants, puis régénérez et importez
                le fichier stock.
              </p>
            )}

            {[...bundle.blockers, ...bundle.conflicts].length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-red-700">Lignes à corriger avant l’export</h3>
                <ul className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  {[...bundle.blockers, ...bundle.conflicts].map((issue, i) => (
                    <li key={`${issue.id}:${i}`} className="border-b border-red-100 py-1 last:border-0">
                      Ligne {issue.row} — {issue.nom ?? '(sans nom)'} ({issue.reference ?? 'sans référence'}) : {issue.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {bundle.canExport ? (
              <a
                href="/api/admin/shopcaisse/export"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Download className="h-4 w-4" /> Télécharger le lot (ZIP)
              </a>
            ) : (
              <p className="text-sm font-semibold text-red-700">
                Téléchargement bloqué tant que les erreurs ci-dessus ne sont pas corrigées.
              </p>
            )}
          </section>
        )}
```

- [ ] **Step 6 : Rendre chaque cellule selon sa nature**

Remplacer le `columns.map((column) => …)` du `<tbody>` par :

```tsx
                      {columns.map((column) => {
                        if (column === COL.supprime) {
                          const deleted = cellString(product.csvData[COL.supprime]) === '1'
                          return (
                            <td key={column} className="p-1.5 align-top">
                              <button
                                type="button"
                                onClick={() => toggleSupprime(product)}
                                title="Marquer comme supprimé dans ShopCaisse"
                                className={`min-w-20 rounded-lg px-3 py-1.5 text-sm font-semibold ${
                                  deleted
                                    ? 'bg-red-100 text-red-800 hover:bg-red-200'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                {deleted ? 'Oui' : 'Non'}
                              </button>
                            </td>
                          )
                        }

                        if (READ_ONLY_COLUMNS.includes(column)) {
                          return (
                            <td key={column} className="p-1.5 align-top">
                              <span className="block min-w-44 rounded-lg bg-slate-50 px-2 py-1.5 text-slate-600">
                                {cellString(product.csvData[column]) || '—'}
                              </span>
                            </td>
                          )
                        }

                        return (
                          <td key={column} className="p-1.5 align-top">
                            <input
                              defaultValue={row[column] ?? ''}
                              onBlur={(e) => {
                                if (e.target.value !== cellString(product.csvData[column])) {
                                  saveCell(product, column, e.target.value)
                                }
                              }}
                              className="min-w-44 w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 outline-none hover:border-slate-300 hover:bg-white focus:border-slate-600 focus:bg-white"
                            />
                          </td>
                        )
                      })}
```

`Mouvement stock` est lu depuis `product.csvData` et non depuis `row` : `row` est figé au rendu, et le recalcul optimiste de l'étape 3 n'y apparaîtrait pas.

- [ ] **Step 7 : Signaler les lignes en défaut, retirer la colonne « Action »**

Supprimer le `<th …>Action</th>` de `<thead>` et le `<td className="sticky right-0 …">` qui portait le bouton corbeille : la colonne `Supprimé` porte désormais l'action.

Remplacer l'ouverture du `<tr>` par :

```tsx
                  const issue = bundle
                    ? [...bundle.blockers, ...bundle.conflicts].find((i) => i.id === product.id)
                    : undefined
                  const isNew = !cellString(product.csvData[COL.identifiant])
                  return (
                    <tr
                      key={product.id}
                      title={issue?.reason}
                      className={`border-b border-slate-200 hover:bg-slate-50 ${
                        issue ? 'bg-red-50' : isNew ? 'bg-amber-50' : ''
                      }`}
                    >
```

- [ ] **Step 8 : Vérifier dans l'application**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm run mongo:start
npm run dev
```

Sur `/tous-les-produits`, après avoir importé les deux fichiers :
- `Identifiant` et `Mouvement stock` sont grisés et non éditables ;
- saisir `Stock souhaité = 8` sur une ligne à `Stock actuel = 5` affiche `3` dans `Mouvement stock` sans rechargement ;
- effacer `Stock souhaité` vide le mouvement ;
- saisir `huit` affiche une erreur et la valeur revient à son état en base ;
- la colonne `Supprimé` bascule entre `Oui` et `Non` au clic, la ligne reste ;
- une ligne sans Identifiant est ambrée ;
- « Exporter le lot ShopCaisse » affiche le résumé, puis « Télécharger le lot (ZIP) » livre une archive à deux fichiers.

- [ ] **Step 9 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/components/catalog/CatalogEditor.tsx
git commit -m "Adapte le tableau maître : lecture seule, bascule Supprimé, export du lot"
```

---

### Task 14 : Page « Comparer » — contrôle « Alignement des exports », doublons et ambiguïtés

**Files:**
- Modify: `src/app/api/admin/catalog/diff/route.ts`
- Modify: `src/components/catalog/CatalogDiffView.tsx`
- Test: `tests/services/shopcaisse-routes.test.ts` (existant depuis la Task 10, à compléter)

**Interfaces:**
- Consomme : `diffCatalogAgainstSource` (existant) ; `validateMaster`, `MasterValidation` (Task 8).
- Produit : `GET /api/admin/catalog/diff` → `{ diff, validation }`.

- [ ] **Step 1 : Écrire le test qui échoue**

Ajouter à `tests/services/shopcaisse-routes.test.ts` :

```ts
// import à ajouter en tête
import { GET as diffRoute } from '@/app/api/admin/catalog/diff/route'
```

```ts
describe('GET /api/admin/catalog/diff', () => {
  it('rend la validation d’export à côté du diff', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const body = await (await diffRoute()).json()

    expect(body.diff).toBeTruthy()
    expect(body.validation.summary.alignment).toBe('Conforme')
    expect(body.validation.summary.productRowCount).toBe(1)
    expect(body.validation.summary.stockRowCount).toBe(1)
  })

  it('expose les doublons pour affichage dans la page Comparer', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const product = await CatalogProduct.findOne({}).lean()
    await CatalogProduct.create({
      templateId: product!.templateId,
      csvData: { ...(product!.csvData as Record<string, unknown>), [COL.nom]: 'Autre' },
    })

    const body = await (await diffRoute()).json()
    expect(body.validation.conflicts.length).toBeGreaterThan(0)
    expect(body.validation.conflicts[0]).toMatchObject({ rule: 'Référence', reference: 'REF-001' })
    expect(body.validation.canExport).toBe(false)
  })
})
```

- [ ] **Step 2 : Vérifier que le test échoue**

Run: `npx vitest run tests/services/shopcaisse-routes.test.ts`
Expected: FAIL — `body.validation` vaut `undefined`.

- [ ] **Step 3 : Étendre la route**

```ts
// src/app/api/admin/catalog/diff/route.ts
import { NextResponse } from 'next/server'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'
import { validateMaster } from '@/services/shopcaisse-validation.service'

export async function GET() {
  try {
    // Les deux lectures alimentent la même page : la comparaison à l'original
    // d'un côté, l'état d'export du maître de l'autre.
    const [diff, validation] = await Promise.all([diffCatalogAgainstSource(), validateMaster()])
    return NextResponse.json({ diff, validation })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Comparaison impossible.'
    const status = /template/i.test(message) ? 404 : 500
    return NextResponse.json({ error: 'diff_failed', message }, { status })
  }
}
```

- [ ] **Step 4 : Vérifier que le test passe**

Run: `npx vitest run tests/services/shopcaisse-routes.test.ts`
Expected: PASS.

- [ ] **Step 5 : Afficher le contrôle dans la page**

Dans `src/components/catalog/CatalogDiffView.tsx`, ajouter les types et l'état :

```tsx
import { AlertTriangle, FileMinus2, FilePen, FilePlus2, Scale } from 'lucide-react'
```

```tsx
interface RowIssue {
  row: number
  id: string
  identifiant: string | null
  reference: string | null
  nom: string | null
  reason: string
  rule: string | null
  relatedRows: number[]
}

interface Validation {
  summary: {
    productRowCount: number
    stockRowCount: number
    sameRowCount: boolean
    alignment: 'Conforme' | 'Erreur'
    duplicates: number
    ambiguous: number
    newWithoutId: number
  }
  blockers: RowIssue[]
  conflicts: RowIssue[]
  alignmentIssues: Array<{ row: number; column: string; product: string; stock: string }>
  canExport: boolean
}
```

Remplacer l'état et le chargement :

```tsx
  const [diff, setDiff] = useState<Diff | null>(null)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch('/api/admin/catalog/diff')
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.message ?? 'Comparaison impossible.')
          setDiff(data.diff)
          setValidation(data.validation)
        })
        .catch((e: Error) => setError(e.message))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])
```

- [ ] **Step 6 : Insérer la section « Alignement des exports »**

Juste après le `<div>` du titre `Comparer avec l’original`, insérer :

```tsx
      {validation && (
        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Scale className="h-5 w-5" /> Alignement des exports
          </h2>

          <p className={`rounded-2xl px-4 py-3 text-sm ${validation.summary.alignment === 'Conforme' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
            Statut : <strong>{validation.summary.alignment}</strong> — export-produits.csv :{' '}
            <strong>{validation.summary.productRowCount}</strong> ligne(s), export-stock.csv :{' '}
            <strong>{validation.summary.stockRowCount}</strong> ligne(s).{' '}
            {validation.summary.sameRowCount
              ? 'Même nombre de lignes, même ordre, mêmes produits.'
              : 'Les deux fichiers n’ont pas le même nombre de lignes.'}
          </p>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {([
              ['Doublons détectés', validation.summary.duplicates],
              ['Lignes ambiguës', validation.summary.ambiguous],
              ['Nouveaux sans Identifiant', validation.summary.newWithoutId],
              ['Différences d’alignement', validation.alignmentIssues.length],
            ] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>

          {validation.alignmentIssues.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-red-200">
              <table className="min-w-full text-sm">
                <thead className="bg-red-50 text-left text-red-800">
                  <tr>
                    <th className="px-4 py-2 font-medium">Ligne</th>
                    <th className="px-4 py-2 font-medium">Colonne</th>
                    <th className="px-4 py-2 font-medium">export-produits.csv</th>
                    <th className="px-4 py-2 font-medium">export-stock.csv</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.alignmentIssues.map((issue, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="px-4 py-2 text-slate-800">{issue.row}</td>
                      <td className="px-4 py-2 text-slate-700">{issue.column}</td>
                      <td className="px-4 py-2 text-slate-700">{issue.product || '—'}</td>
                      <td className="px-4 py-2 text-slate-700">{issue.stock || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {[...validation.conflicts, ...validation.blockers].length > 0 && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" /> Doublons et lignes à résoudre à la main
              </h3>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-2 font-medium">Ligne</th>
                      <th className="px-4 py-2 font-medium">Identifiant</th>
                      <th className="px-4 py-2 font-medium">Référence</th>
                      <th className="px-4 py-2 font-medium">Nom</th>
                      <th className="px-4 py-2 font-medium">Règle</th>
                      <th className="px-4 py-2 font-medium">Motif du conflit</th>
                      <th className="px-4 py-2 font-medium">Lignes liées</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...validation.conflicts, ...validation.blockers].map((issue, i) => (
                      <tr key={`${issue.id}:${i}`} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-800">{issue.row}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.identifiant ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.reference ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.nom ?? '(sans nom)'}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.rule ?? 'Donnée obligatoire'}</td>
                        <td className="px-4 py-2 text-red-700">{issue.reason}</td>
                        <td className="px-4 py-2 text-slate-700">
                          {issue.relatedRows.length ? issue.relatedRows.join(', ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm font-semibold text-red-700">
                Téléchargement du lot bloqué tant que ces lignes ne sont pas corrigées dans le tableau maître.
              </p>
            </div>
          )}
        </section>
      )}
```

- [ ] **Step 7 : Vérifier dans l'application**

Sur `/admin/catalog/diff`, après import : le contrôle affiche `Conforme`, `1` ligne de chaque côté, et zéro doublon. Créer un doublon en dupliquant une `Référence` depuis `/tous-les-produits` : le statut reste `Conforme` (l'alignement l'est) mais la table des doublons apparaît, avec le numéro de ligne, la règle `Référence`, le motif et les lignes liées, et le message de blocage s'affiche.

- [ ] **Step 8 : Commit**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add src/app/api/admin/catalog/diff/route.ts src/components/catalog/CatalogDiffView.tsx tests/services/shopcaisse-routes.test.ts
git commit -m "Ajoute le contrôle d'alignement des exports et les doublons à la page Comparer"
```

---

### Task 15 : Vérification complète et non-régression

**Files:**
- Modify: tout fichier que les trois commandes désignent.

**Interfaces:**
- Consomme : l'ensemble des tâches précédentes.
- Produit : un dépôt dont `npm test`, `npm run lint` et `npm run build` passent.

- [ ] **Step 1 : Lancer la suite complète**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm test
```

Expected: PASS. Points de rupture attendus, avec la correction à appliquer :
- `tests/services/catalog-export.service.test.ts` et `tests/services/catalog-product.service.test.ts` : le filtre `isDeleted: false` a disparu de la liste produits (décision L5-3). Mettre le **test** à jour, pas le service. `exportCatalogCsv` conserve son filtre : c'est la route générique héritée, hors du lot ShopCaisse.
- `tests/services/from-import.integration.test.ts` et `tests/services/catalog-sync.service.test.ts` : le flux générique n'est pas modifié. S'ils tombent, c'est une régression réelle — corriger le code.

- [ ] **Step 2 : Lint**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm run lint
```

Expected: aucune erreur. Attentions probables : un import inutilisé (`Trash2` en Task 13), une variable `row` devenue inutile, un `any` implicite dans les `.map` de résumé.

- [ ] **Step 3 : Build**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm run build
```

Expected: build réussi. Si Next signale que `shopcaisse-columns` ou `shopcaisse-stock` sont importés côté client depuis `CatalogEditor.tsx` : c'est attendu et permis, ces deux modules sont purs et n'importent ni `mongoose` ni `@/lib/mongodb`. **Ne jamais importer un `*.service.ts` depuis un composant client** — cela ferait entrer Mongoose dans le bundle.

- [ ] **Step 4 : Parcours de bout en bout**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
npm run mongo:start
npm run dev
```

1. `/admin/csv-template` → « Importer les produits » avec `docs/shopcaisse-metier/export-produits.csv`.
2. → « Importer le stock » avec `docs/shopcaisse-metier/ export-stocks-modele.csv`. La ligne porte `Stock actuel = 2`.
3. `/tous-les-produits` : les 22 colonnes maître sont là ; `Identifiant` et `Mouvement stock` sont en lecture seule.
4. Saisir `Stock souhaité = 8`, `Stock actuel = 5` → `Mouvement stock = 3`.
5. Basculer `Supprimé` sur `Oui` : la ligne reste au tableau.
6. `/admin/catalog/diff` : « Alignement des exports » indique `Conforme`, même nombre de lignes.
7. `/tous-les-produits` → « Exporter le lot ShopCaisse » → résumé → « Télécharger le lot (ZIP) ».
8. Ouvrir l'archive : `export-produits.csv` porte 19 colonnes, aucune colonne de stock, `Supprimé = 1` ; `export-stock.csv` porte 4 colonnes et `Quantité = 3` ; même nombre de lignes, même ordre.
9. Dupliquer une `Référence` → l'export est refusé, la page Comparer nomme les deux lignes.

- [ ] **Step 5 : Commit final**

```bash
cd "/Users/daviddevillers/sites/lecteur-csv 2"
git add -A
git commit -m "Corrige les tests hérités après le passage au tableau maître ShopCaisse"
```

---

## Couverture des 38 tests obligatoires de la consigne

| # | Test | Tâche |
|---|---|---|
| 1-4 | Import produits, mapping par intitulé, cellules vides, code-barres en chaîne | Task 5 |
| 5 | Création du tableau maître | Tasks 4, 5 |
| 6-8 | MAJ par Identifiant, par Référence, sans doublon | Tasks 3, 5 |
| 9-12 | Mouvement positif, négatif, nul, vide | Task 2 |
| 13-14 | Génération des deux CSV | Task 7 |
| 15-19 | Même nombre de lignes, même ordre, mêmes Identifiant/Référence/Nom | Tasks 7, 9 |
| 20-24 | Nouveau produit : Identifiant vide, Référence unique, blocages | Task 8 |
| 25-27 | Doublons par Identifiant, par Référence, ambiguïté | Tasks 3, 8 |
| 28 | Doublons affichés dans Comparer | Task 14 |
| 29-30 | Blocage sur ambiguïté, sur désalignement | Tasks 8, 9 |
| 31-33 | Oui→1, Non→0, lignes supprimées conservées | Tasks 4, 7, 11 |
| 34-35 | BOM UTF-8, séparateur `;` | Tasks 7, 9 |
| 36-37 | Archive ZIP, deux fichiers présents | Task 9 |
| 38 | Résumé d'export correct | Tasks 8, 9 |
