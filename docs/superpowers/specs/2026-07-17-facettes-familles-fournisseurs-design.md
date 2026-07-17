# Pages « Familles » et « Fournisseurs » — design

## Intention

Lister sur deux nouvelles pages les valeurs distinctes existantes de la colonne
`Famille` d'une part, `Fournisseur` d'autre part, chacune avec le nombre de
produits qui la portent. Deux pages séparées, accessibles depuis le menu latéral.

## Décisions

- **Deux pages** distinctes (`/familles`, `/fournisseurs`), pas une page à deux sections.
- **Contenu par ligne** : la valeur + le nombre de produits. Non cliquable.
- **Entrées de menu** ajoutées à `AppSidebar`.
- **Lignes supprimées comptées** : ces décomptes portent sur tout le tableau
  maître, ligne marquée `Supprimé` comprise, comme partout depuis la décision L5-3.
- **Valeurs vides exclues** : « existant » = renseigné. Une famille/fournisseur
  vide n'apparaît pas dans la liste.

## Architecture

Pages en composant serveur (comme `catalogue/page.tsx`), qui appellent
directement une fonction de service — pas de route API ni de JavaScript client,
ces listes étant en lecture seule.

### Service — `src/services/catalog-facets.service.ts`

```ts
countCatalogValues(column: string): Promise<Array<{ value: string; count: number }>>
```

- Agrège le catalogue par `csvData.<column>` (`$group` + `$sum: 1`).
- Exclut les valeurs nulles / vides / composées uniquement d'espaces.
- Trie par valeur, ordre alphabétique français.

### Présentation — `src/components/catalog/FacetList.tsx`

Reçoit `{ title, description, valueLabel, entries }` et rend un tableau à deux
colonnes (valeur | nombre de produits), un total en tête, et un état vide.

### Pages

- `src/app/familles/page.tsx` → `countCatalogValues('Famille')` → `<FacetList title="Familles" … />`
- `src/app/fournisseurs/page.tsx` → `countCatalogValues('Fournisseur')` → `<FacetList title="Fournisseurs" … />`

`export const dynamic = 'force-dynamic'` : le catalogue change à chaque import.

### Menu — `src/components/AppSidebar.tsx`

Deux entrées : « Familles » (icône `Tags`), « Fournisseurs » (icône `Truck`).

## Test — `tests/services/catalog-facets.service.test.ts`

- Regroupe les produits d'une même valeur et compte correctement.
- Exclut les valeurs vides / nulles / espaces.
- Trie par ordre alphabétique.
- Compte les lignes marquées supprimées.
- Rend un tableau vide sur un catalogue vide.
