# Export ShopCaisse au format des fichiers de référence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produire dans le ZIP deux CSV dont les en-têtes, l'ordre, l'encodage et les fins de ligne correspondent exactement aux exports ShopCaisse Produits et Visualisation des stocks fournis.

**Architecture:** Les fichiers réels deviennent des fixtures contractuelles. Le catalogue conserve séparément la ligne brute de Visualisation des stocks, tandis que le tableau maître garde ses trois colonnes de calcul. L'export fusionne la ligne stock conservée avec les données produit courantes et la cible de stock, sans inventer les cellules absentes.

**Tech Stack:** Next.js 16, TypeScript 5.9, Mongoose 9, PapaParse, JSZip, Vitest 4.

---

## Structure de fichiers

- Create: `tests/fixtures/shopcaisse/produits-reference-20260719.csv` — copie contractuelle du fichier Produits fourni.
- Create: `tests/fixtures/shopcaisse/stocks-reference-20260719.csv` — copie contractuelle du fichier Visualisation des stocks fourni.
- Modify: `src/lib/shopcaisse-columns.ts` — schémas produits et stocks exacts et normalisation d'une ligne stock.
- Modify: `src/models/CatalogProduct.ts` — conservation séparée des 13 cellules stock source.
- Modify: `src/services/shopcaisse-import.service.ts` — persistance de la ligne stock complète.
- Modify: `src/services/shopcaisse-master.service.ts` — exposition de la ligne stock à l'export.
- Modify: `src/services/shopcaisse-export.service.ts` — construction des 19/13 colonnes et sérialisation LF.
- Modify: `tests/lib/shopcaisse-columns.test.ts` — en-têtes verrouillés par fixtures.
- Modify: `tests/services/shopcaisse-import-stock.service.test.ts` — conservation des 13 cellules.
- Modify: `tests/services/shopcaisse-export.service.test.ts` — mapping et sérialisation.
- Modify: `tests/services/shopcaisse-bundle.service.test.ts` — contrat du ZIP complet.

### Task 1: Verrouiller les deux schémas avec les fichiers fournis

**Files:**
- Create: `tests/fixtures/shopcaisse/produits-reference-20260719.csv`
- Create: `tests/fixtures/shopcaisse/stocks-reference-20260719.csv`
- Modify: `tests/lib/shopcaisse-columns.test.ts`
- Modify: `src/lib/shopcaisse-columns.ts`

- [ ] **Step 1: Copier les deux références sans transformation**

```bash
cp /Users/daviddevillers/Downloads/Produits_du_20260719_0549.csv tests/fixtures/shopcaisse/produits-reference-20260719.csv
cp /Users/daviddevillers/Downloads/Visualisation_des_stocks_du_20260719.csv tests/fixtures/shopcaisse/stocks-reference-20260719.csv
```

- [ ] **Step 2: Écrire les tests d'en-têtes qui échouent**

Ajouter dans `tests/lib/shopcaisse-columns.test.ts` une lecture du premier enregistrement, BOM retiré, puis vérifier :

```ts
expect(PRODUCT_COLUMNS).toEqual(headerOf('produits-reference-20260719.csv'))
expect(STOCK_COLUMNS).toEqual(headerOf('stocks-reference-20260719.csv'))
expect(PRODUCT_COLUMNS).toHaveLength(19)
expect(STOCK_COLUMNS).toHaveLength(13)
```

- [ ] **Step 3: Vérifier RED**

Run: `npx vitest run tests/lib/shopcaisse-columns.test.ts`

Expected: FAIL — l'ordre produit diverge et `STOCK_COLUMNS` ne contient que quatre colonnes.

- [ ] **Step 4: Définir les schémas exacts**

Dans `src/lib/shopcaisse-columns.ts`, ordonner `PRODUCT_COLUMNS` comme la fixture et définir :

```ts
export const STOCK_COLUMNS: readonly string[] = [
  'Identifiant',
  'Nom',
  'Référence',
  'En stock',
  'Mon Magasin',
  'Réservés client',
  'Réservés fournisseur',
  'Stock effectif',
  "Prix d'achat H.T.",
  'Valeur H.T.',
  'Prix par défaut',
  'Fournisseur',
  'Famille',
]

export type StockVisualisationRow = Record<string, string | null>

export function toStockVisualisationRow(source: Record<string, unknown>): StockVisualisationRow {
  return Object.fromEntries(STOCK_COLUMNS.map((column) => {
    const value = source[column]
    return [column, value === undefined || value === null || String(value) === '' ? null : String(value)]
  }))
}
```

Dans `PRODUCT_COLUMNS`, placer `Gestion du stock`, `Affichage du stock`, le prix TTC, `Couleur de fond`, `Texte du bouton`, `Supprimé`, puis `Prix d'achat` en dernière position.

- [ ] **Step 5: Vérifier GREEN et committer**

Run: `npx vitest run tests/lib/shopcaisse-columns.test.ts`

Expected: PASS.

```bash
git add src/lib/shopcaisse-columns.ts tests/lib/shopcaisse-columns.test.ts tests/fixtures/shopcaisse
git commit -m "Verrouille les formats CSV ShopCaisse de référence"
```

### Task 2: Conserver les 13 cellules de l'import stock

**Files:**
- Modify: `src/models/CatalogProduct.ts`
- Modify: `src/services/shopcaisse-import.service.ts`
- Modify: `src/services/shopcaisse-master.service.ts`
- Modify: `tests/services/shopcaisse-import-stock.service.test.ts`

- [ ] **Step 1: Écrire le test de persistance qui échoue**

Après l'import d'une ligne portant les 13 colonnes, vérifier :

```ts
const product = await CatalogProduct.findOne({ shopcaisseId: '42' }).lean()
expect(product?.shopcaisseStockData).toEqual({
  Identifiant: '42',
  Nom: 'Café',
  Référence: 'REF-42',
  'En stock': '5',
  'Mon Magasin': '5',
  'Réservés client': '1',
  'Réservés fournisseur': '2',
  'Stock effectif': '2',
  "Prix d'achat H.T.": '3,50',
  'Valeur H.T.': '17,50',
  'Prix par défaut': '8,90',
  Fournisseur: 'Maison A',
  Famille: 'Décoration',
})
```

- [ ] **Step 2: Vérifier RED**

Run: `npx vitest run tests/services/shopcaisse-import-stock.service.test.ts`

Expected: FAIL — `shopcaisseStockData` est absent.

- [ ] **Step 3: Ajouter le stockage séparé**

Ajouter au modèle :

```ts
shopcaisseStockData: { type: Schema.Types.Mixed, default: null },
```

Dans `importStockIntoMaster`, conserver la ligne normalisée dans le même `updateOne` :

```ts
const stockRow = toStockVisualisationRow(source)
// ...
update: {
  $set: {
    templateId: new Types.ObjectId(templateId),
    ...writeFields(row),
    shopcaisseStockData: stockRow,
  },
},
```

Étendre `MasterEntry` avec `stockRow: StockVisualisationRow | null`, sélectionner `shopcaisseStockData` dans `listMasterEntries`, puis le normaliser avec `toStockVisualisationRow`.

- [ ] **Step 4: Vérifier GREEN et committer**

Run: `npx vitest run tests/services/shopcaisse-import-stock.service.test.ts`

Expected: PASS.

```bash
git add src/models/CatalogProduct.ts src/services/shopcaisse-import.service.ts src/services/shopcaisse-master.service.ts tests/services/shopcaisse-import-stock.service.test.ts
git commit -m "Conserve les lignes de stock ShopCaisse importées"
```

### Task 3: Générer les deux lignes au format exact

**Files:**
- Modify: `src/services/shopcaisse-export.service.ts`
- Modify: `tests/services/shopcaisse-export.service.test.ts`
- Modify: `tests/services/shopcaisse-validation.service.test.ts`
- Modify: `tests/services/shopcaisse-bundle.service.test.ts`

- [ ] **Step 1: Écrire les tests d'export qui échouent**

Tester que la ligne produit suit la fixture et que la ligne stock :

```ts
expect(Object.keys(rows[0])).toEqual([...STOCK_COLUMNS])
expect(rows[0]['En stock']).toBe('8')
expect(rows[0]['Mon Magasin']).toBe('5')
expect(rows[0]['Réservés client']).toBe('1')
expect(rows[0]['Prix par défaut']).toBe('8,90')
```

Le `MasterEntry` du test porte `Stock actuel = 5`, `Stock souhaité = 8` et une `stockRow` source complète.

- [ ] **Step 2: Vérifier RED**

Run: `npx vitest run tests/services/shopcaisse-export.service.test.ts`

Expected: FAIL — les quatre anciennes colonnes et le mapping `Quantité` sont encore produits.

- [ ] **Step 3: Implémenter la fusion sans invention**

Remplacer `buildStockRows` par une construction dans l'ordre de `STOCK_COLUMNS` :

```ts
export function buildStockRows(entries: MasterEntry[]): StockVisualisationRow[] {
  return entries.map((entry) => {
    const row = toStockVisualisationRow(entry.stockRow ?? {})
    const target = readStockCell(entry.row[COL.stockSouhaite])

    row['Identifiant'] = entry.row[COL.identifiant] ?? null
    row['Nom'] = entry.row[COL.nom] ?? null
    row['Référence'] = entry.row[COL.reference] ?? null
    row['En stock'] = target.kind === 'number'
      ? target.value.toString()
      : entry.row[COL.stockActuel] ?? row['En stock']
    row["Prix d'achat H.T."] = entry.row[COL.prixAchat] ?? row["Prix d'achat H.T."]
    row['Prix par défaut'] = entry.row[COL.prixTtc] ?? row['Prix par défaut']
    row['Fournisseur'] = entry.row[COL.fournisseur] ?? row['Fournisseur']
    row['Famille'] = entry.row[COL.famille] ?? row['Famille']

    return row
  })
}
```

Adapter les helpers de tests pour fournir `stockRow: null` par défaut. Conserver le contrôle d'alignement sur `Identifiant`, `Nom`, `Référence`.

- [ ] **Step 4: Vérifier GREEN et committer**

Run: `npx vitest run tests/services/shopcaisse-export.service.test.ts tests/services/shopcaisse-validation.service.test.ts tests/services/shopcaisse-bundle.service.test.ts`

Expected: PASS.

```bash
git add src/services/shopcaisse-export.service.ts tests/services/shopcaisse-export.service.test.ts tests/services/shopcaisse-validation.service.test.ts tests/services/shopcaisse-bundle.service.test.ts
git commit -m "Aligne les deux exports sur les CSV ShopCaisse"
```

### Task 4: Reproduire l'encodage et les fins de ligne puis vérifier le ZIP

**Files:**
- Modify: `src/services/shopcaisse-export.service.ts`
- Modify: `tests/services/shopcaisse-export.service.test.ts`
- Modify: `tests/services/shopcaisse-bundle.service.test.ts`

- [ ] **Step 1: Écrire le test LF qui échoue**

```ts
expect(csv.startsWith('\uFEFF')).toBe(true)
expect(csv).not.toContain('\r\n')
expect(csv.endsWith('\n')).toBe(true)
```

Dans le test du bundle, ouvrir les deux fichiers et comparer leurs premières lignes aux fixtures de référence.

- [ ] **Step 2: Vérifier RED**

Run: `npx vitest run tests/services/shopcaisse-export.service.test.ts tests/services/shopcaisse-bundle.service.test.ts`

Expected: FAIL — le sérialiseur utilise encore CRLF.

- [ ] **Step 3: Sérialiser en LF**

```ts
return `\uFEFF${lines.join('\n')}\n`
```

- [ ] **Step 4: Vérifier les tests ciblés**

Run: `npx vitest run tests/lib/shopcaisse-columns.test.ts tests/services/shopcaisse-import-stock.service.test.ts tests/services/shopcaisse-export.service.test.ts tests/services/shopcaisse-validation.service.test.ts tests/services/shopcaisse-bundle.service.test.ts tests/services/shopcaisse-routes.test.ts`

Expected: PASS.

- [ ] **Step 5: Vérifier toute la suite et le build**

Run: `npm test`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: Contrôler un ZIP réel et committer**

Ouvrir le ZIP produit par le test d'intégration et vérifier : deux fichiers seulement, BOM `EF BB BF`, 19/13 colonnes, séparateur `;`, LF sans CRLF.

```bash
git add src/services/shopcaisse-export.service.ts tests/services/shopcaisse-export.service.test.ts tests/services/shopcaisse-bundle.service.test.ts
git commit -m "Reproduit l'encodage des exports ShopCaisse"
```
