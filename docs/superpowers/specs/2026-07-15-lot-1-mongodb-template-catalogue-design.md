# Lot 1 — Socle MongoDB, template CSV actif et catalogue produits

Date : 2026-07-15
Statut : en attente de relecture

## 1. Contexte

L'application est aujourd'hui entièrement cliente. Les six pages de `src/app/`
rendent toutes le même composant `csv-editor.tsx` (695 lignes, `'use client'`),
qui analyse le CSV avec Papaparse dans le navigateur et conserve son état dans
`sessionStorage`. Le serveur ignore qu'un import a eu lieu. Il n'existe ni route
API, ni base de données, ni authentification, ni test.

L'objectif final est une architecture à trois niveaux — template CSV, catalogue
produits, imports de factures PDF — où la source de vérité est **le template
actif plus `CatalogProduct`**, les données de facture restant sans effet sur le
catalogue jusqu'à validation par un administrateur.

Ce périmètre représente une cinquantaine de fichiers. Il est découpé en trois
lots :

- **Lot 1 (ce document)** : socle MongoDB, template actif, catalogue, export.
  Livrable et vérifiable sans aucun PDF.
- **Lot 2** : import et extraction des factures PDF, modèle `InvoiceImport`.
- **Lot 3** : interface de validation administrateur, application
  transactionnelle, rejet, suppression, authentification.

## 2. Périmètre du lot 1

Inclus :

- connexion MongoDB mutualisée et adaptée au rechargement à chaud de Next.js ;
- modèles `CsvTemplate`, `CatalogProduct`, `CsvImport` ;
- téléversement du CSV vers le serveur, avec détection réelle de l'encodage ;
- action « Définir comme template actif » ;
- activation transactionnelle garantissant un seul template actif ;
- synchronisation du catalogue depuis les lignes du CSV ;
- lecture des cinq vues existantes depuis MongoDB ;
- page `/catalogue` avec résumé et tableau ;
- export CSV du catalogue au format ShopCaisse ;
- validation Zod de toutes les entrées ;
- tests Vitest sur replica set en mémoire.

Exclus, et pourquoi :

- **Extraction PDF et `InvoiceImport`** — lot 2. Le modèle `InvoiceImport`
  n'est pas créé ; les champs `createdFromInvoiceId` et
  `lastUpdatedFromInvoiceId` de `CatalogProduct` existent mais restent `null`.
  Mongoose accepte une `ref` vers un modèle non enregistré tant qu'aucun
  `populate` ne la traverse, ce que le lot 1 ne fait jamais.
- **Authentification administrateur** — lot 3. Elle n'a de sens que face à
  l'interface de validation des factures. Livrée seule et sans usage, elle
  donnerait une fausse impression de sécurité.
- **Écriture du catalogue depuis les vues** — voir décision D5.
- **Gestion des photos** — hors périmètre, sur demande explicite.
- **Modification de la logique des familles** — `product-views.ts` n'est pas
  touché, sur demande explicite.

## 3. Décisions d'architecture

La spec d'origine était muette ou contradictoire sur plusieurs points. D1 à D5
sont les cinq résolutions déjà validées ; D6 à D8 sont des trous relevés lors de
la rédaction, résolus ici et à confirmer.

### D1 — Un seul catalogue vivant, `templateId` re-pointé

`CatalogProduct.templateId` est requis. Au ré-import d'un CSV, un nouveau
template est créé : dupliquer le catalogue par template contredirait la règle
« source de vérité = template actif + CatalogProduct », qui suppose un
catalogue unique.

La synchronisation fait donc correspondre les produits **globalement**, sans
filtrer par `templateId`, et met à jour `templateId` vers le template actif. Un
produit n'existe qu'une fois.

### D2 — `isDeleted` n'est jamais positionné automatiquement

La spec définit le champ sans jamais dire quand le déclencher. Un produit
présent au catalogue mais absent du nouveau CSV **n'est pas supprimé ni marqué**.
Il est signalé dans le résumé de synchronisation sous `missingFromCsv`.

Marquer automatiquement serait destructif et contredirait la règle interdisant
d'inventer ou de déduire une donnée. Le champ reste en base pour un usage
manuel ultérieur.

### D3 — `originalCsvData` est écrit à la création seulement

Renseigné lors de la création du produit, jamais écrasé ensuite. Il conserve
l'état du CSV à la première rencontre du produit ; l'écraser à chaque
synchronisation viderait le mot « original » de son sens.

### D4 — Correspondance nom + fournisseur exacte, jamais approximative

L'égalité porte sur les valeurs normalisées (accents retirés, casse repliée,
espaces réduits) — jamais sur une similarité, une distance d'édition ou un
préfixe.

Si plusieurs produits du catalogue correspondent au même critère, **aucune
fusion** : la ligne est traitée comme un nouveau produit et signalée dans le
résumé sous `ambiguous`.

### D5 — Vues en lecture seule sur MongoDB

`csv-editor.tsx` permet aujourd'hui de modifier des cellules, d'ajouter et de
supprimer des lignes. La spec ne prévoit aucune route d'écriture
(`/api/catalog/products` est en `GET` seul).

En lot 1, les lignes lues depuis MongoDB **ne sont pas réécrites**. L'édition
locale reste locale, et un bandeau l'indique explicitement pour que
l'utilisateur ne croie pas modifier le catalogue. L'écriture relèvera d'un lot
ultérieur.




### D6 — Réactivation refusée par défaut si les colonnes divergent

`PATCH /api/csv-templates/[templateId]/activate` ne fait que déplacer le
drapeau `isActive`. Elle **ne resynchronise pas** le catalogue : aucun fichier
source n'est rejoué, aucune donnée produit n'est touchée.

Le problème que la spec d'origine laissait dans l'ombre : les clés de `csvData`
sont les noms de colonnes du CSV qui a alimenté le catalogue. Si le template
réactivé a des colonnes différentes, l'export lira des clés absentes et
produira un CSV troué, silencieusement.

**Résolution — refus par défaut, forçage explicite.** Avant d'activer, la route
compare les colonnes du template visé aux clés réellement présentes dans le
catalogue. Si des colonnes manquent, elle répond **409** en les nommant, et
n'active rien :

```json
{
  "error": "template_columns_missing_from_catalog",
  "missingColumns": ["Code barre", "Prix d'achat"],
  "hint": "Réactivez malgré tout avec force: true, ou rejouez l'import d'origine via from-import."
}
```

Un corps `{ "force": true }` passe outre et active quand même. L'export troué
devient ainsi impossible par accident, tout en restant atteignable sciemment.

La vérification porte sur les **clés effectivement présentes dans `csvData`**,
échantillonnées sur le catalogue, et non sur les colonnes du template
précédent : un produit peut avoir été créé par une facture (lot 3) sans porter
toutes les colonnes.

Le contrôle est **dans la transaction d'activation**, pour qu'une
synchronisation concurrente ne puisse pas invalider le constat entre la
vérification et l'écriture.

En complément, et parce que le forçage reste possible : l'export lit `csvData`
par nom de colonne du template actif, une colonne absente donnant une cellule
vide — cohérent avec le traitement de `null`. `/catalogue` affiche en
permanence un avertissement nommant les colonnes manquantes le cas échéant.

Resynchroniser depuis un ancien import reste possible en repassant par
`from-import`, qui rejoue le fichier d'origine.

### D7 — Quatrième collection `CsvImport`, fichier brut sur disque

La spec nomme une route `from-import` mais ne définit aucune collection
d'imports. Elle est créée.

Le fichier brut est stocké **sur disque** sous `uploads/csv/<uuid>.csv`, et
`CsvImport` n'en conserve que les métadonnées et les colonnes — pas les lignes.
Deux raisons : un document MongoDB est plafonné à 16 Mo, qu'un gros catalogue
pourrait dépasser ; et conserver les octets exacts est la seule façon de
re-décoder fidèlement lors de la création du template.
### D8 — Infrastructure

MongoDB est piloté par `MONGODB_URI`. En développement, une instance dédiée sur
le port 27018 en replica set à un nœud (`rs-lecteur-csv`), montée par
`scripts/mongo-dev.sh` et séparée du service brew du 27017, qui tourne en
standalone et héberge d'autres projets. En production, MongoDB Atlas.

Les transactions **exigent un replica set** : un standalone répond
`NoReplicationEnabled`. Le commit et le rollback ont été vérifiés sur
l'instance 27018.
## 4. Détection de l'encodage

Le navigateur décode le fichier en UTF-8 avant que Papaparse ne le voie :
l'encodage d'origine est perdu côté client. Inscrire `utf-8` dans le template
serait donc une valeur inventée, alors que les exports ShopCaisse sont
fréquemment en windows-1252 — c'est la cause habituelle des accents cassés.

Le serveur reçoit les octets bruts, détecte l'encodage avec `chardet`, décode
avec `iconv-lite`, puis analyse le texte avec Papaparse. L'encodage détecté est
enregistré sur `CsvImport` puis recopié sur `CsvTemplate`.

Si `chardet` ne renvoie rien d'exploitable, l'encodage retenu est `utf-8` et le
fait est signalé à l'utilisateur — jamais silencieusement.

## 5. Modèle de données

### `CsvTemplate`

Conforme à la spec d'origine : `name`, `sourceFileName`, `columns`
(`{ name, position, detectedType }`, `_id: false`), `delimiter` (défaut `;`),
`encoding` (défaut `utf-8`), `isActive` (indexé), horodatages.

Ajout : `sourceImportId` (ref `CsvImport`), pour la traçabilité vers l'import
d'origine.

`name` est requis par la spec sans que son origine soit précisée. Il est dérivé
du nom de fichier privé de son extension, suffixé de la date d'import
(`Produits_du_20260714_0459 — 15/07/2026`), et reste modifiable par
l'utilisateur au moment de l'activation. Il sert à l'affichage uniquement :
aucune logique ne s'appuie dessus.

Un index partiel garantit l'unicité au niveau de la base, et pas seulement dans
le code applicatif :

```ts
CsvTemplateSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
)
```

Cet index est la seule garantie réelle contre deux templates actifs en cas
d'appels concurrents ; la transaction seule ne suffirait pas à l'empêcher.

`detectedType` est déduit des **200 premières valeurs non vides** de la colonne,
avec `parseLocalizedNumber` de `product-views.ts` pour les nombres au format
français. Le type n'est retenu que si **toutes** les valeurs échantillonnées s'y
conforment ; sinon `unknown`. Une colonne entièrement vide donne `unknown`, pas
`string` — jamais de type deviné.

`detectedType` est informatif. Il ne convertit ni ne valide aucune valeur à
l'import comme à l'export : `csvData` conserve ce que le CSV contenait.

### `CatalogProduct`

Conforme à la spec d'origine. `csvData` utilise exactement les noms de colonnes
du template. Les champs scalaires (`shopcaisseId`, `reference`, `barcode`,
`name`, `supplier`) sont extraits de `csvData` pour l'indexation et la
correspondance ; `csvData` reste la valeur de référence.

### `CsvImport`

`originalFileName`, `storedFileName`, `filePath`, `fileSize`, `mimeType`,
`encoding`, `delimiter`, `columns` (`[String]`), `rowCount`, horodatages.

## 6. Colonnes d'identité

`product-views.ts` ne détecte que `name`, `stock`, `salePrice` et `family`. La
correspondance des produits exige en plus l'identifiant ShopCaisse, la
référence, le code-barres et le fournisseur.

Ces alias vont dans un **nouveau module `lib/catalog-columns.ts`**, qui réutilise
`normalizeHeader` sans modifier `COLUMN_ALIASES` ni la logique des familles.

## 7. Flux

```
Fichier CSV choisi dans l'éditeur
        ↓  POST /api/csv-imports  (octets bruts)
Détection encodage → décodage → analyse Papaparse
        ↓
CsvImport (métadonnées) + fichier brut sur disque
        ↓  POST /api/csv-templates/from-import  { importId }
Transaction : désactivation de l'ancien template, création du nouveau, activation
        ↓
Synchronisation du catalogue (hors transaction, voir §8)
        ↓
CatalogProduct créés ou mis à jour + résumé
        ↓
Vues et /catalogue lisent MongoDB · GET /api/catalog/export
```

## 8. Périmètre transactionnel

**Dans la transaction** : la désactivation de l'ancien template, la création du
nouveau et son activation. C'est l'invariant « un seul template actif », et il
doit être indivisible.

**Hors transaction** : la synchronisation du catalogue. Un CSV de plusieurs
milliers de lignes dépasserait la limite de 16 Mo de l'oplog transactionnel et
le délai de 60 secondes par défaut d'une transaction MongoDB. La
synchronisation procède par lots de `bulkWrite` idempotents.

Conséquence assumée, et c'est un écart par rapport à une lecture littérale de
la spec : si la synchronisation échoue en cours de route, le template est actif
mais le catalogue partiellement synchronisé. L'opération étant idempotente,
elle est relançable sans dommage, et le résumé indique l'échec. L'alternative —
tout dans une transaction — casserait sur les gros fichiers, ce qui est un
défaut pire.

L'application des factures, elle, sera bien intégralement transactionnelle
(lot 3) : elle porte sur les seules lignes approuvées, en volume très inférieur.

## 9. Correspondance à la synchronisation

Ordre de priorité, première correspondance retenue :

1. identifiant ShopCaisse
2. référence
3. code-barres
4. nom + fournisseur (exact, normalisé — voir D4)
5. aucune → nouveau produit

Le catalogue est chargé en mémoire et indexé par clé avant le parcours des
lignes, pour éviter une requête par ligne. Les valeurs vides ne sont jamais des
clés de correspondance : un produit sans code-barres ne correspond pas à un
autre produit sans code-barres.

Résumé retourné :

```ts
type CatalogSyncSummary = {
  created: number
  updated: number
  unchanged: number
  ambiguous: Array<{ row: number; matchedBy: string; candidateIds: string[] }>
  missingFromCsv: string[]   // au catalogue, absents du CSV — non supprimés (D2)
  errors: Array<{ row: number; message: string }>
}
```

## 10. Services

| Service | Responsabilité |
|---|---|
| `csv-parser.service.ts` | Détecter l'encodage, décoder, analyser, déduire les types |
| `csv-import.service.ts` | Stocker le fichier, créer le `CsvImport` |
| `csv-template.service.ts` | Créer, activer transactionnellement, lire le template actif |
| `catalog-product.service.ts` | Lire et paginer les produits, extraire les champs d'identité |
| `catalog-sync.service.ts` | Faire correspondre, créer, mettre à jour, produire le résumé |
| `catalog-export.service.ts` | Sérialiser le catalogue selon le template actif |

`invoice-*.service.ts` et `invoice-file-storage.service.ts` relèvent des lots 2
et 3.

## 11. Routes API

| Route | Rôle |
|---|---|
| `POST /api/csv-imports` | Téléverser le CSV brut, créer le `CsvImport` |
| `POST /api/csv-templates/from-import` | Créer et activer le template, synchroniser |
| `GET /api/csv-templates/active` | Lire le template actif |
| `PATCH /api/csv-templates/[templateId]/activate` | Réactiver un template ; 409 si ses colonnes manquent au catalogue, sauf `force: true` (D6) |
| `GET /api/catalog/products` | Lire le catalogue, paginé |
| `GET /api/catalog/export` | Exporter le CSV du catalogue |

Toutes les entrées sont validées par Zod. Tout identifiant est vérifié par
`mongoose.isValidObjectId` avant requête. Les schémas vivent dans
`lib/validations/`.

## 12. Export

L'export serveur reproduit exactement le format de l'export client actuel, pour
ne pas produire deux CSV différents selon le bouton utilisé : colonnes du
template dans l'ordre des `position`, séparateur du template, fins de ligne
`\r\n`, BOM UTF-8 par défaut (`?bom=false` pour s'en passer).

`null` produit une cellule vide. L'échappement suit `serializeCsvValue` de la
spec : guillemets doublés, encadrement si la valeur contient le séparateur, un
guillemet ou un saut de ligne.

## 13. Interface

- **`csv-editor.tsx`** — `importCsv` téléverse le fichier en plus de l'analyse
  locale actuelle (l'objet `File` y est disponible). Un bouton « Définir comme
  template actif » apparaît après un import réussi. Quand un template actif
  existe, les lignes proviennent de `/api/catalog/products` ; sinon, repli sur
  `sessionStorage`. Un bandeau indique la source affichée et, en mode MongoDB,
  que l'édition n'est pas persistée (D5).

  Conversion `csvData` → `CsvRow` : le composant attend
  `Record<string, string>`. `null` devient `''` et les nombres sont convertis en
  chaîne **pour l'affichage seulement**. L'export du catalogue est produit par
  le serveur depuis `csvData`, donc la distinction entre `null` et chaîne vide
  est préservée là où elle compte.

- **`/catalogue`** — `CatalogSummary` (template actif, nombre de produits, date
  de synchronisation), `CatalogProductsTable`, `ExportCatalogButton`.

  `CatalogSummary` compare les colonnes du template actif à celles réellement
  présentes dans `csvData` et avertit en les nommant lorsque des colonnes
  manquent (D6) — le cas se produit après réactivation d'un template dont les
  colonnes diffèrent de celles du CSV ayant alimenté le catalogue.

## 14. Erreurs

Traités en lot 1 : aucun template actif ; import introuvable ; fichier non CSV ;
fichier trop volumineux (limite configurable, défaut 10 Mo) ; fichier vide ;
aucun en-tête exploitable ; encodage indétectable ; identifiant Mongo invalide ;
base indisponible ; échec de transaction ; échec de synchronisation ; échec
d'export.

Message imposé en l'absence de template actif :

> Aucun template CSV actif. Importez un fichier CSV ShopCaisse et définissez-le
> comme source de vérité avant d'importer une facture.

Les erreurs liées aux PDF et aux factures relèvent des lots 2 et 3.

## 15. Tests

Vitest avec `mongodb-memory-server` en **`MongoMemoryReplSet`** — un serveur
mémoire standalone refuserait les transactions, exactement comme le `mongod` du
port 27017.

Couverture, avec la numérotation de la spec d'origine :

1. le dernier CSV importé crée un template actif *(spec 1)*
2. un seul template peut être actif, y compris sous appels concurrents *(spec 2)*
3. les colonnes et leur ordre sont conservés *(spec 3)*
4. les lignes du CSV alimentent `CatalogProduct` *(spec 4)*
5. une transaction d'activation échouée ne laisse aucun état partiel *(spec 14)*
6. l'export du catalogue respecte le template actif *(spec 22)*
7. un CSV en windows-1252 conserve ses accents
8. la correspondance suit l'ordre de priorité
9. deux noms similaires ne sont jamais fusionnés *(D4)*
10. une correspondance ambiguë crée un nouveau produit et est signalée *(D4)*
11. `originalCsvData` n'est pas écrasé au ré-import *(D3)*
12. un produit absent du CSV n'est ni supprimé ni marqué *(D2)*
13. `null` produit une cellule vide à l'export
14. les colonnes supplémentaires du CSV survivent au cycle import → export
15. réactiver un template aux colonnes absentes du catalogue répond 409 et
    n'active rien *(D6)*
16. le même appel avec `force: true` active le template *(D6)*

Les tests 5 à 13 et 15 à 21 de la spec d'origine portent sur les factures et
relèvent des lots 2 et 3.

## 16. Dépendances ajoutées

`mongoose`, `zod`, `chardet`, `iconv-lite` ; en développement `vitest`,
`mongodb-memory-server`.

## 17. Fichiers

```
src/
  lib/
    mongodb.ts                       (nouveau)
    catalog-columns.ts               (nouveau)
    validations/
      csv-template.schema.ts         (nouveau)
      catalog.schema.ts              (nouveau)
  models/
    CsvTemplate.ts                   (nouveau)
    CatalogProduct.ts                (nouveau)
    CsvImport.ts                     (nouveau)
  services/
    csv-parser.service.ts            (nouveau)
    csv-import.service.ts            (nouveau)
    csv-template.service.ts          (nouveau)
    catalog-product.service.ts       (nouveau)
    catalog-sync.service.ts          (nouveau)
    catalog-export.service.ts        (nouveau)
  app/
    catalogue/page.tsx               (nouveau)
    api/
      csv-imports/route.ts           (nouveau)
      csv-templates/active/route.ts  (nouveau)
      csv-templates/from-import/route.ts        (nouveau)
      csv-templates/[templateId]/activate/route.ts  (nouveau)
      catalog/products/route.ts      (nouveau)
      catalog/export/route.ts        (nouveau)
  components/
    catalog/
      CatalogSummary.tsx             (nouveau)
      CatalogProductsTable.tsx       (nouveau)
      ExportCatalogButton.tsx        (nouveau)
    csv-editor.tsx                   (modifié — téléversement, lecture Mongo, bandeau)

  lib/product-views.ts               (inchangé)
  lib/csv.ts                         (inchangé)
```

Environ 22 fichiers, dont un seul modifié.
