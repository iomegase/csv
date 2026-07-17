# Bouton de purge des données — design

## Intention

Un bouton « Tout effacer » qui vide entièrement l'application : les 4 collections
(`CatalogProduct`, `CsvImport`, `CsvTemplate`, `InvoiceImport`). Déclenché depuis
l'en-tête du tableau maître, protégé par la saisie d'un mot.

## Décisions

- **Portée** : les 4 collections. Remise à zéro complète.
- **Emplacement** : en-tête de `/tous-les-produits`, à côté de « Exporter le lot ».
- **Garde-fou** : boîte de dialogue où il faut taper `EFFACER` pour activer la
  confirmation. Le mot est aussi exigé côté serveur (défense en profondeur).
- **Après purge** : la page se recharge ; le catalogue vide fait retomber sur
  l'écran « Aucun catalogue actif ».

## Architecture

### Service — `src/services/data-purge.service.ts`

```ts
purgeAllData(): Promise<{ deleted: { catalogProducts: number; csvImports: number; csvTemplates: number; invoices: number } }>
```

Vide les 4 collections avec `deleteMany({})` et renvoie le nombre supprimé par
collection.

### Route — `POST /api/admin/purge`

Corps `{ confirm: string }` validé par Zod. `confirm !== 'EFFACER'` → **400**
sans rien toucher. Sinon `purgeAllData()` → `{ deleted }`.

### UI — `src/components/catalog/PurgeDataButton.tsx` (composant client isolé)

Bouton rouge « Tout effacer ». Au clic, une modale demande de taper `EFFACER` ;
le bouton de confirmation ne s'active qu'une fois le mot exact saisi. Au succès,
`window.location.reload()`. Sorti de `CatalogEditor` pour garder la logique
destructrice isolée et relisible.

Inséré dans l'en-tête de `CatalogEditor`, à côté de « Exporter le lot ShopCaisse ».

## Tests

- `tests/services/data-purge.service.test.ts` : les 4 collections remplies puis
  vidées, décomptes renvoyés.
- `tests/services/purge.route.test.ts` : mauvais mot → 400 et rien d'effacé ;
  bon mot → purge effective.
