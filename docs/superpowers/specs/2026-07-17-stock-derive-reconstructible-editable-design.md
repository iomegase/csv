# Lot 4 — Source de vérité figée, copie de travail éditable, comparaison

Date : 2026-07-17

## Contexte

`/tous-les-produits` édite aujourd'hui un fichier chargé dans le navigateur
(`sessionStorage`), sans lien avec la base ; le catalogue MongoDB, lui, accumule
sans jamais se purger. Le pilote veut un flux unique, branché sur la base, dont
le but final est de **préparer un CSV prêt à réimporter dans ShopCaisse**.

## Objectif (modèle retenu)

Deux couches, comme un versionnement :

- **Source de vérité (original figé)** : le CSV importé, immuable. Sert de
  référence de comparaison.
- **Copie de travail (le catalogue)** : initialisée depuis l'original, puis
  modifiée par toutes les opérations — application de factures, édition de
  cellules, ajout et suppression d'articles.

À terme, **comparer la copie de travail à l'original** produit la liste des
changements : articles ajoutés, articles supprimés, intitulés/valeurs modifiés.
L'admin édite la copie de travail, vérifie le diff, puis **exporte le CSV
ShopCaisse**.

> Ce modèle **remplace** l'idée antérieure « Synchroniser reconstruit en
> écrasant / supprimer l'import purge le stock » : la copie de travail est
> persistante et accumule les changements ; on ne les écrase pas en routine.

## Décisions

- **E1 — Original immuable.** À l'activation d'un import CSV, son contenu est figé
  comme source de vérité (réutilise `CsvImport.rawContent`, déjà immuable). Au
  niveau produit, `CatalogProduct.originalCsvData` (déjà présent, écrit à la
  création) porte la valeur d'origine de chaque article.
- **E2 — Copie de travail = catalogue.** `CatalogProduct.csvData` est la copie de
  travail éditable et persistante. Elle reçoit factures + éditions + ajouts +
  suppressions.
- **E3 — Vue unique DB éditable.** `/tous-les-produits` et ses pages filtrées, et
  `/catalogue`, lisent le catalogue. Éditer une cellule écrit dans `csvData`
  (`PATCH`). Ajout/suppression d'article = endpoints dédiés.
- **E4 — Suppression douce.** Supprimer un article de la copie de travail le
  marque `isDeleted = true` (champ existant) au lieu de l'effacer, pour que la
  comparaison puisse le présenter comme « supprimé ».
- **E5 — Les éditions manuelles persistent.** Aucune opération de routine ne les
  écrase. Une action explicite « Réinitialiser depuis la source de vérité »
  (optionnelle, avec confirmation) permet de repartir de l'original — c'est le
  seul chemin destructif.
- **E6 — Comparaison.** Un service diffe la copie de travail et l'original par
  identité (Nom, cohérent R1) et renvoie : `ajoutés`, `supprimés`, `modifiés`
  (diff champ par champ). Une page présente ce diff avant export.
- **E7 — Ne rien inventer** (hérité R1.3) : les valeurs sont rangées dans leurs
  colonnes ; les champs absents restent vides.
- **E8 — Export inchangé.** Export ShopCaisse depuis la copie de travail
  (`/api/catalog/export`, existant).

## Périmètre

### 1. Vue « Produits » DB, éditable

- Rewire `/tous-les-produits` + 4 vues filtrées (`/sans-stock`, `/sans-prix`,
  `/avec-stock-et-prix`, `/sans-famille`) pour lire le catalogue via
  `/api/catalog/products` au lieu du `sessionStorage`. Filtres évalués sur la DB.
- Édition de cellule → `PATCH /api/admin/catalog/products/[id]` (met à jour
  `csvData`).
- Ajout d'article → `POST /api/admin/catalog/products`. Suppression →
  `DELETE …/[id]` (soft delete, `isDeleted = true`).
- Conserver l'export (page/complet) depuis le catalogue.

### 2. Comparaison original ↔ copie de travail

- `src/services/catalog-diff.service.ts` : `diffCatalogAgainstSource()` compare
  le catalogue (y compris `isDeleted`) à l'original (import actif re-parsé),
  apparie par Nom, et renvoie :

```ts
interface CatalogDiff {
  added: Array<{ id: string; name: string | null }>            // dans travail, absent original
  removed: Array<{ name: string | null; original: Record<string, unknown> }> // original, absent/supprimé travail
  modified: Array<{ id: string; name: string | null; fields: Array<{ column: string; from: unknown; to: unknown }> }>
}
```

- `GET /api/admin/catalog/diff` → `{ diff }`.
- Page « Comparer » (`/admin/catalog/diff` ou onglet) affichant les trois listes.

### 3. Réinitialisation explicite (E5)

- `POST /api/admin/catalog/reset-from-source` : purge la copie de travail et la
  recharge depuis l'original (import actif), puis rejoue les factures appliquées
  (appariement par Nom, sans le garde-fou une-seule-fois). Confirmation requise
  (« écrase les modifications manuelles »).
- Réutilise un cœur commun extrait d'`applyInvoiceToCatalog`
  (`applyItemsToCatalog`) pour le rejeu.

### 4. Cohérence menu

- « Produits » → `/tous-les-produits` (copie de travail éditable).
- « Comparer » → page de diff.
- « Stock »/`/catalogue` : même source ; à fusionner ou différencier clairement
  (ex. `/catalogue` = lecture seule + export, `/tous-les-produits` = édition).

## Décisions confirmées (2026-07-17)

- **E9 — Modèle versionnement retenu.** L'idée initiale « Synchroniser reconstruit
  en écrasant » et « supprimer l'import purge le stock » est **abandonnée**. La
  copie de travail persiste ; le seul chemin destructif est le bouton explicite
  « Réinitialiser depuis la source » (E5).
- **E10 — Édition libre de toutes les colonnes** dans `/tous-les-produits`
  (stock, intitulé, prix, famille, …), plus ajout/suppression d'articles. C'est
  un atelier complet de préparation du CSV d'export.

## Hors périmètre (YAGNI)

- Sorties/ventes (mouvements `−`).
- Historique horodaté des modifications (au-delà du diff original↔travail).
- Édition concurrente multi-utilisateurs.
- Réimport automatique dans ShopCaisse (l'export CSV reste manuel).

## Dépendance

Lot 3 fusionné dans `main` (accès libre, application des factures par Nom).

## Vérifications

- `npm test`, `npm run lint`, `npm run build`.
- Parcours : import CSV → copie de travail = original ; appliquer facture →
  travail modifié ; éditer / ajouter / supprimer un article → persiste ;
  « Comparer » liste ajouts/suppressions/modifications ; export ShopCaisse
  conforme ; « Réinitialiser » revient à original + factures.
