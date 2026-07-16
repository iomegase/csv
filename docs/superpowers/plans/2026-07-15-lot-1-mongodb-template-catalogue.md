# Lot 1 — Socle MongoDB, template CSV actif et catalogue — Plan d'implémentation

> **Pour les agents :** SOUS-COMPÉTENCE REQUISE — utiliser
> `superpowers:subagent-driven-development` (recommandé) ou
> `superpowers:executing-plans` pour dérouler ce plan tâche par tâche. Les étapes
> utilisent la syntaxe à cases (`- [ ]`).

**Goal :** doter le lecteur CSV d'une persistance MongoDB à deux niveaux — un
template CSV actif décrivant la structure ShopCaisse, et un catalogue produits
qui en porte les valeurs — avec import serveur, synchronisation et export.

**Architecture :** le CSV brut est téléversé, son encodage détecté sur les octets
réels, puis analysé côté serveur. Il donne un `CsvImport`, dont on tire un
`CsvTemplate` activé de façon transactionnelle, qui alimente le catalogue
`CatalogProduct`. Les vues existantes lisent le catalogue quand un template est
actif, et retombent sur `sessionStorage` sinon.

**Tech Stack :** Next.js 16.2.10 (App Router, Turbopack), React 19.2.7,
TypeScript, Tailwind, Mongoose, Zod, chardet, iconv-lite, Papaparse, Vitest,
mongodb-memory-server.

Spec de référence :
`docs/superpowers/specs/2026-07-15-lot-1-mongodb-template-catalogue-design.md`

## Contraintes globales

- **Node 22.15.0, Next 16.2.10, React 19.2.7.** Dans les route handlers de
  Next 16, `params` est une **`Promise`** : la signature est
  `{ params }: { params: Promise<{ templateId: string }> }` et impose un `await`.
  La signature synchrone de Next 14 compile mais échoue à l'exécution.
- **Les transactions exigent un replica set.** Développement :
  `npm run mongo:start` (port 27018, `rs-lecteur-csv`). Tests :
  `MongoMemoryReplSet`, jamais `MongoMemoryServer`.
- **Ne jamais inventer une donnée.** Une valeur absente est `null`, jamais `0`,
  `N/A`, `Inconnu` ni `Non renseigné`. À l'export, `null` donne une cellule vide.
- **Ne pas modifier la logique des familles** de `src/lib/product-views.ts`.
  Seule exception autorisée, tâche 3 : ajouter le mot-clé `export` devant
  `findColumn`. Aucun changement de comportement.
- **Ne rien créer autour des photos.**
- **Format d'export ShopCaisse** identique à l'export client actuel : séparateur
  du template, fins de ligne `\r\n`, BOM UTF-8 par défaut.
- Tout identifiant Mongo est validé par `mongoose.isValidObjectId` avant requête.
- Toute entrée de route est validée par Zod.
- `csvData` utilise **exactement** les noms de colonnes du template.

---

### Tâche 1 : Socle — dépendances, connexion MongoDB, harnais de test

**Fichiers :**
- Modifier : `package.json`
- Créer : `vitest.config.ts`
- Créer : `src/lib/mongodb.ts`
- Créer : `tests/helpers/db.ts`
- Test : `tests/lib/mongodb.test.ts`

**Interfaces :**
- Produit : `connectToDatabase(): Promise<typeof mongoose>` ;
  `disconnectFromDatabase(): Promise<void>` ; helper de test
  `withTestDatabase()`.

- [ ] **Étape 1 : Installer les dépendances**

```bash
npm install mongoose zod chardet iconv-lite
npm install -D vitest vite-tsconfig-paths mongodb-memory-server
```

- [ ] **Étape 2 : Configurer Vitest**

Créer `vitest.config.ts` :

```ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: 'node',
    // Chaque fichier de test démarre son propre replica set en mémoire ;
    // les laisser tourner en parallèle épuiserait la RAM et les ports.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
```

Ajouter dans `package.json`, section `scripts` :

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Étape 3 : Écrire le test qui échoue**

Créer `tests/lib/mongodb.test.ts` :

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectToDatabase, disconnectFromDatabase } from '@/lib/mongodb'

let replSet: MongoMemoryReplSet

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  process.env.MONGODB_URI = replSet.getUri('lecteur-csv-test')
})

afterAll(async () => {
  await disconnectFromDatabase()
  await replSet.stop()
})

describe('connectToDatabase', () => {
  it('se connecte et réutilise la même connexion', async () => {
    const first = await connectToDatabase()
    const second = await connectToDatabase()

    expect(first.connection.readyState).toBe(1)
    expect(second).toBe(first)
  })

  it('expose un replica set, donc des transactions utilisables', async () => {
    await connectToDatabase()
    const session = await mongoose.startSession()

    // Le vrai test du replica set : sur un standalone, startTransaction est
    // accepté mais le commit échoue avec NoReplicationEnabled. On vérifie que
    // le commit a eu lieu (le document existe après coup) plutôt que la valeur
    // de retour de withTransaction : celle-ci vaut ce que renvoie le callback,
    // donc undefined ici, et n'indique rien du succès.
    await session.withTransaction(async () => {
      await mongoose.connection.db!.collection('probe').insertOne({ ok: 1 }, { session })
    })
    await session.endSession()

    const count = await mongoose.connection.db!.collection('probe').countDocuments({ ok: 1 })
    expect(count).toBe(1)
  })

  it('échoue clairement sans MONGODB_URI', async () => {
    const saved = process.env.MONGODB_URI
    delete process.env.MONGODB_URI
    await disconnectFromDatabase()

    await expect(connectToDatabase()).rejects.toThrow(/MONGODB_URI/)

    process.env.MONGODB_URI = saved
  })
})
```

- [ ] **Étape 4 : Vérifier l'échec**

Lancer : `npx vitest run tests/lib/mongodb.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/lib/mongodb'`.

- [ ] **Étape 5 : Implémenter la connexion**

Créer `src/lib/mongodb.ts` :

```ts
import mongoose from 'mongoose'

interface MongooseCache {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

// Next.js réévalue les modules à chaque rechargement à chaud. Sans ce cache
// porté par globalThis, chaque édition de fichier ouvrirait une connexion de
// plus jusqu'à saturer le pool de MongoDB.
declare global {
  // eslint-disable-next-line no-var
  var _mongooseCache: MongooseCache | undefined
}

const cache: MongooseCache = globalThis._mongooseCache ?? { conn: null, promise: null }
globalThis._mongooseCache = cache

export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn) return cache.conn

  if (!cache.promise) {
    // Lu à l'appel et non au chargement du module : les tests renseignent
    // l'URI après l'import.
    const uri = process.env.MONGODB_URI

    if (!uri) {
      throw new Error(
        'MONGODB_URI manquant. Copiez .env.example vers .env.local, puis lancez npm run mongo:start.',
      )
    }

    cache.promise = mongoose.connect(uri, { bufferCommands: false })
  }

  try {
    cache.conn = await cache.promise
  } catch (error) {
    // Sans cette remise à zéro, une première connexion en échec serait
    // renvoyée indéfiniment par le cache.
    cache.promise = null
    throw error
  }

  return cache.conn
}

export async function disconnectFromDatabase(): Promise<void> {
  if (!cache.conn) return
  await mongoose.disconnect()
  cache.conn = null
  cache.promise = null
}
```

- [ ] **Étape 6 : Créer le helper de test**

Créer `tests/helpers/db.ts` :

```ts
import { afterAll, afterEach, beforeAll } from 'vitest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { connectToDatabase, disconnectFromDatabase } from '@/lib/mongodb'

/**
 * Démarre un MongoDB en mémoire en replica set à un nœud pour le fichier de
 * test courant, et vide les collections entre chaque test.
 *
 * Le replica set est obligatoire : un MongoMemoryServer standalone refuserait
 * les transactions, exactement comme le mongod du port 27017.
 */
export function withTestDatabase() {
  let replSet: MongoMemoryReplSet

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    process.env.MONGODB_URI = replSet.getUri('lecteur-csv-test')
    await connectToDatabase()
  })

  afterEach(async () => {
    const collections = await mongoose.connection.db!.collections()
    // deleteMany plutôt que drop : drop supprimerait aussi les index, dont
    // l'index unique partiel sur isActive que plusieurs tests vérifient.
    await Promise.all(collections.map((collection) => collection.deleteMany({})))
  })

  afterAll(async () => {
    await disconnectFromDatabase()
    await replSet.stop()
  })
}
```

- [ ] **Étape 7 : Vérifier le succès**

Lancer : `npx vitest run tests/lib/mongodb.test.ts`
Attendu : 3 tests PASS.

- [ ] **Étape 8 : Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/mongodb.ts tests/
git commit -m "Ajoute le socle MongoDB et le harnais de test sur replica set"
```

---

### Tâche 2 : Modèles Mongoose

**Fichiers :**
- Créer : `src/models/CsvTemplate.ts`
- Créer : `src/models/CatalogProduct.ts`
- Créer : `src/models/CsvImport.ts`
- Test : `tests/models/csv-template.test.ts`

**Interfaces :**
- Consomme : `withTestDatabase()` (tâche 1).
- Produit : modèles `CsvTemplate`, `CatalogProduct`, `CsvImport` ; types
  `CsvColumn = { name: string; position: number; detectedType: DetectedType }`,
  `DetectedType = 'string' | 'number' | 'boolean' | 'date' | 'json' | 'unknown'`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/models/csv-template.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'

withTestDatabase()

describe('CsvTemplate', () => {
  const base = {
    name: 'Produits',
    sourceFileName: 'produits.csv',
    columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
  }

  it('applique les valeurs par défaut ShopCaisse', async () => {
    const template = await CsvTemplate.create(base)

    expect(template.delimiter).toBe(';')
    expect(template.encoding).toBe('utf-8')
    expect(template.isActive).toBe(false)
  })

  it("interdit deux templates actifs au niveau de la base", async () => {
    await CsvTemplate.create({ ...base, isActive: true })

    // L'index partiel unique est la seule garantie contre deux activations
    // concurrentes : le code applicatif seul ne suffirait pas.
    await expect(CsvTemplate.create({ ...base, isActive: true })).rejects.toThrow(
      /E11000|duplicate key/,
    )
  })

  it('autorise plusieurs templates inactifs', async () => {
    await CsvTemplate.create({ ...base, isActive: false })
    await CsvTemplate.create({ ...base, isActive: false })

    expect(await CsvTemplate.countDocuments({})).toBe(2)
  })

  it('refuse un detectedType hors énumération', async () => {
    await expect(
      CsvTemplate.create({
        ...base,
        columns: [{ name: 'Nom', position: 0, detectedType: 'devine' }],
      }),
    ).rejects.toThrow(/detectedType/)
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/models/csv-template.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/models/CsvTemplate'`.

- [ ] **Étape 3 : Implémenter `CsvTemplate`**

Créer `src/models/CsvTemplate.ts` :

```ts
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

export const DETECTED_TYPES = [
  'string',
  'number',
  'boolean',
  'date',
  'json',
  'unknown',
] as const

export type DetectedType = (typeof DETECTED_TYPES)[number]

const CsvColumnSchema = new Schema(
  {
    name: { type: String, required: true },
    position: { type: Number, required: true },
    detectedType: { type: String, enum: DETECTED_TYPES, default: 'unknown' },
  },
  { _id: false },
)

const CsvTemplateSchema = new Schema(
  {
    name: { type: String, required: true },
    sourceFileName: { type: String, required: true },
    sourceImportId: { type: Schema.Types.ObjectId, ref: 'CsvImport', default: null },
    columns: { type: [CsvColumnSchema], required: true },
    delimiter: { type: String, default: ';' },
    encoding: { type: String, default: 'utf-8' },
    // Pas d'`index: true` ici : il créerait un index { isActive: 1 } simple, en
    // conflit d'options avec l'index partiel unique ci-dessous sur la même clé
    // (MongoDB refuse deux index identiques aux options divergentes). L'index
    // partiel suffit : les requêtes portent sur { isActive: true }.
    isActive: { type: Boolean, default: false },
  },
  { timestamps: true },
)

// Garantit « un seul template actif » dans la base elle-même. La transaction
// d'activation sérialise le cas normal ; cet index est ce qui rattrape deux
// activations réellement concurrentes.
CsvTemplateSchema.index(
  { isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } },
)

export type CsvTemplateDoc = InferSchemaType<typeof CsvTemplateSchema>
export type CsvColumn = { name: string; position: number; detectedType: DetectedType }

export const CsvTemplate =
  (models.CsvTemplate as Model<CsvTemplateDoc>) ||
  model<CsvTemplateDoc>('CsvTemplate', CsvTemplateSchema)
```

- [ ] **Étape 4 : Implémenter `CatalogProduct`**

Créer `src/models/CatalogProduct.ts` :

```ts
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

const CatalogProductSchema = new Schema(
  {
    templateId: { type: Schema.Types.ObjectId, ref: 'CsvTemplate', required: true, index: true },

    // Champs d'identité extraits de csvData pour l'indexation et la
    // correspondance. csvData reste la valeur de référence.
    shopcaisseId: { type: String, default: null, index: true },
    reference: { type: String, default: null, index: true },
    barcode: { type: String, default: null, index: true },
    name: { type: String, default: null, index: true },
    supplier: { type: String, default: null, index: true },

    csvData: { type: Schema.Types.Mixed, required: true },
    originalCsvData: { type: Schema.Types.Mixed, default: null },

    // Renseignés par le lot 3. Le modèle InvoiceImport n'existe pas encore :
    // la ref reste inerte tant qu'aucun populate ne la traverse.
    createdFromInvoiceId: { type: Schema.Types.ObjectId, ref: 'InvoiceImport', default: null },
    lastUpdatedFromInvoiceId: { type: Schema.Types.ObjectId, ref: 'InvoiceImport', default: null },

    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
)

export type CatalogProductDoc = InferSchemaType<typeof CatalogProductSchema>

export const CatalogProduct =
  (models.CatalogProduct as Model<CatalogProductDoc>) ||
  model<CatalogProductDoc>('CatalogProduct', CatalogProductSchema)
```

- [ ] **Étape 5 : Implémenter `CsvImport`**

Créer `src/models/CsvImport.ts` :

```ts
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

const CsvImportSchema = new Schema(
  {
    originalFileName: { type: String, required: true },
    storedFileName: { type: String, required: true },
    filePath: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, required: true },
    encoding: { type: String, required: true },
    delimiter: { type: String, required: true },
    columns: { type: [String], required: true },
    rowCount: { type: Number, required: true },
  },
  { timestamps: true },
)

export type CsvImportDoc = InferSchemaType<typeof CsvImportSchema>

export const CsvImport =
  (models.CsvImport as Model<CsvImportDoc>) ||
  model<CsvImportDoc>('CsvImport', CsvImportSchema)
```

- [ ] **Étape 6 : Vérifier le succès**

Lancer : `npx vitest run tests/models/csv-template.test.ts`
Attendu : 4 tests PASS.

> Si le test d'unicité échoue, c'est que l'index n'était pas construit au
> moment de l'insertion. Ajouter `await CsvTemplate.init()` en tête du test :
> Mongoose construit ses index de façon asynchrone.

- [ ] **Étape 7 : Commit**

```bash
git add src/models tests/models
git commit -m "Ajoute les modèles CsvTemplate, CatalogProduct et CsvImport"
```

---

### Tâche 3 : Colonnes d'identité

**Fichiers :**
- Créer : `src/lib/catalog-columns.ts`
- Modifier : `src/lib/product-views.ts` (ajout du mot-clé `export` sur
  `findColumn`, ligne 86 — aucun changement de comportement)
- Test : `tests/lib/catalog-columns.test.ts`

**Interfaces :**
- Consomme : `normalizeHeader`, `findColumn` de `@/lib/product-views`.
- Produit : `type CatalogIdentityMapping = { shopcaisseId, reference, barcode, name, supplier: string }` ;
  `detectIdentityMapping(columns: string[]): CatalogIdentityMapping` ;
  `normalizeMatchValue(value: unknown): string` ;
  `nameSupplierKey(name: unknown, supplier: unknown): string`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/lib/catalog-columns.test.ts` :

```ts
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
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/lib/catalog-columns.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/lib/catalog-columns'`.

- [ ] **Étape 3 : Exporter `findColumn`**

Dans `src/lib/product-views.ts`, ligne 86, remplacer :

```ts
function findColumn(columns: string[], aliases: string[]): string {
```

par :

```ts
export function findColumn(columns: string[], aliases: string[]): string {
```

C'est la seule modification autorisée de ce fichier. Ne toucher ni à
`COLUMN_ALIASES`, ni à `isWithoutFamily`, ni à `rowMatchesProductView`.

- [ ] **Étape 4 : Implémenter le module**

Créer `src/lib/catalog-columns.ts` :

```ts
import { findColumn } from '@/lib/product-views'

export interface CatalogIdentityMapping {
  shopcaisseId: string
  reference: string
  barcode: string
  name: string
  supplier: string
}

// Alias volontairement stricts. « marque » ou « fabricant » ne sont PAS des
// alias de fournisseur : les confondre inventerait une donnée.
const IDENTITY_ALIASES: Record<keyof CatalogIdentityMapping, string[]> = {
  shopcaisseId: ['identifiant', 'identifiant produit', 'id produit', 'id shopcaisse', 'id'],
  reference: ['reference', 'reference produit', 'ref', 'code article', 'sku'],
  barcode: ['code barre', 'code barres', 'codebarre', 'ean', 'ean13', 'gencod', 'gencode'],
  name: ['nom', 'designation', 'libelle', 'produit', 'nom du produit', 'article'],
  supplier: ['fournisseur'],
}

export function detectIdentityMapping(columns: string[]): CatalogIdentityMapping {
  return {
    shopcaisseId: findColumn(columns, IDENTITY_ALIASES.shopcaisseId),
    reference: findColumn(columns, IDENTITY_ALIASES.reference),
    barcode: findColumn(columns, IDENTITY_ALIASES.barcode),
    name: findColumn(columns, IDENTITY_ALIASES.name),
    supplier: findColumn(columns, IDENTITY_ALIASES.supplier),
  }
}

/**
 * Clé de correspondance « nom + fournisseur ».
 *
 * Les deux valeurs sont exigées : un nom seul n'identifie pas un produit.
 * Le séparateur \u0000 ne peut pas apparaître dans une valeur normalisée ; avec
 * un espace, « vase » + « decoratif a » et « vase decoratif » + « a » donneraient
 * la même clé et fusionneraient deux produits distincts, ce que D4 interdit.
 */
export function nameSupplierKey(name: unknown, supplier: unknown): string {
  const normalizedName = normalizeMatchValue(name)
  const normalizedSupplier = normalizeMatchValue(supplier)
  if (!normalizedName || !normalizedSupplier) return ''
  return `${normalizedName}\u0000${normalizedSupplier}`
}

/**
 * Normalise une valeur pour la comparaison entre produits : accents retirés,
 * casse repliée, espaces réduits.
 *
 * Sert uniquement à l'égalité exacte. Aucune similarité ni distance d'édition :
 * deux produits ne doivent jamais fusionner parce que leurs noms se ressemblent.
 */
export function normalizeMatchValue(value: unknown): string {
  if (value === null || value === undefined) return ''

  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Étape 5 : Vérifier le succès**

Lancer : `npx vitest run tests/lib/catalog-columns.test.ts`
Attendu : 5 tests PASS.

- [ ] **Étape 6 : Vérifier la non-régression des familles**

Lancer : `npx tsc --noEmit`
Attendu : aucune sortie.

- [ ] **Étape 7 : Commit**

```bash
git add src/lib/catalog-columns.ts src/lib/product-views.ts tests/lib/catalog-columns.test.ts
git commit -m "Ajoute la détection des colonnes d'identité produit"
```

---

### Tâche 4 : Analyse CSV serveur — encodage, séparateur, types

**Fichiers :**
- Créer : `src/services/csv-parser.service.ts`
- Test : `tests/services/csv-parser.service.test.ts`

**Interfaces :**
- Consomme : `DetectedType` de `@/models/CsvTemplate` ;
  `parseLocalizedNumber` de `@/lib/product-views`.
- Produit :
  `parseCsvBuffer(buffer: Buffer): ParsedCsv` où
  `ParsedCsv = { columns: string[]; rows: Record<string,string>[]; delimiter: string; encoding: string; encodingConfident: boolean }` ;
  `inferColumnType(values: string[]): DetectedType`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/csv-parser.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { inferColumnType, parseCsvBuffer } from '@/services/csv-parser.service'

describe('parseCsvBuffer', () => {
  it('analyse un CSV UTF-8 point-virgule', () => {
    const buffer = Buffer.from('Nom;Prix\r\nVase;12,50\r\n', 'utf-8')
    const parsed = parseCsvBuffer(buffer)

    expect(parsed.columns).toEqual(['Nom', 'Prix'])
    expect(parsed.delimiter).toBe(';')
    expect(parsed.rows).toEqual([{ Nom: 'Vase', Prix: '12,50' }])
  })

  it('conserve les accents d’un fichier windows-1252', () => {
    // Le cas ShopCaisse : décodé en UTF-8 par erreur, « Décoratif » devient
    // « D�coratif ». C'est la raison d'être de la détection serveur.
    const buffer = iconv.encode('Nom;Famille\r\nVase Décoratif;Objets déco\r\n', 'windows-1252')
    const parsed = parseCsvBuffer(buffer)

    expect(parsed.rows[0].Nom).toBe('Vase Décoratif')
    expect(parsed.rows[0].Famille).toBe('Objets déco')
  })

  it('retire le BOM de l’en-tête', () => {
    const buffer = Buffer.from('﻿Nom;Prix\r\nVase;12,50\r\n', 'utf-8')
    expect(parseCsvBuffer(buffer).columns).toEqual(['Nom', 'Prix'])
  })

  it('détecte un séparateur virgule', () => {
    const buffer = Buffer.from('Nom,Prix\r\nVase,12.50\r\n', 'utf-8')
    expect(parseCsvBuffer(buffer).delimiter).toBe(',')
  })

  it('rejette un fichier sans en-tête exploitable', () => {
    expect(() => parseCsvBuffer(Buffer.from('', 'utf-8'))).toThrow(/en-tête/)
  })

  it('conserve les colonnes supplémentaires', () => {
    const buffer = Buffer.from('Nom;Colonne Maison\r\nVase;valeur\r\n', 'utf-8')
    expect(parseCsvBuffer(buffer).rows[0]['Colonne Maison']).toBe('valeur')
  })
})

describe('inferColumnType', () => {
  it('reconnaît les nombres au format français', () => {
    expect(inferColumnType(['12,50', '3', '1 200,00'])).toBe('number')
  })

  it('reconnaît les booléens', () => {
    expect(inferColumnType(['oui', 'non', 'VRAI'])).toBe('boolean')
  })

  it('reconnaît les dates', () => {
    expect(inferColumnType(['2026-07-15', '2026-01-02'])).toBe('date')
    expect(inferColumnType(['15/07/2026'])).toBe('date')
  })

  it('retombe sur string dès qu’une valeur diverge', () => {
    expect(inferColumnType(['12,50', 'gratuit'])).toBe('string')
  })

  it('rend unknown pour une colonne vide plutôt que de deviner', () => {
    expect(inferColumnType([])).toBe('unknown')
    expect(inferColumnType(['', '  '])).toBe('unknown')
  })

  it('ne prend pas 0 et 1 pour des booléens', () => {
    expect(inferColumnType(['0', '1'])).toBe('number')
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/csv-parser.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/csv-parser.service.ts` :

```ts
import chardet from 'chardet'
import iconv from 'iconv-lite'
import Papa from 'papaparse'
import type { DetectedType } from '@/models/CsvTemplate'
import { parseLocalizedNumber } from '@/lib/product-views'

export interface ParsedCsv {
  columns: string[]
  rows: Record<string, string>[]
  delimiter: string
  encoding: string
  /** false quand chardet n'a rien reconnu et qu'on est retombé sur utf-8. */
  encodingConfident: boolean
}

const SAMPLE_SIZE = 200

const BOOLEAN_VALUES = new Set(['true', 'false', 'vrai', 'faux', 'oui', 'non'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FR_DATE = /^\d{2}\/\d{2}\/\d{4}$/

export function detectEncoding(buffer: Buffer): { encoding: string; confident: boolean } {
  const detected = chardet.detect(buffer)

  if (!detected || !iconv.encodingExists(detected)) {
    // Repli explicite, jamais silencieux : l'appelant remonte le doute à
    // l'utilisateur via encodingConfident.
    return { encoding: 'utf-8', confident: false }
  }

  return { encoding: detected.toLowerCase(), confident: true }
}

export function parseCsvBuffer(buffer: Buffer): ParsedCsv {
  const { encoding, confident } = detectEncoding(buffer)
  const text = iconv.decode(buffer, encoding)

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    // Le BOM survit au décodage et collerait à la première colonne, la rendant
    // introuvable par nom.
    transformHeader: (header) => header.replace(/^﻿/, '').trim(),
  })

  const columns = (result.meta.fields ?? []).filter(Boolean)

  if (!columns.length) {
    throw new Error("Le fichier ne contient pas de ligne d'en-tête exploitable.")
  }

  const rows = result.data.map((row) =>
    Object.fromEntries(columns.map((column) => [column, String(row[column] ?? '')])),
  )

  return {
    columns,
    rows,
    delimiter: result.meta.delimiter || ';',
    encoding,
    encodingConfident: confident,
  }
}

export function inferColumnType(values: string[]): DetectedType {
  const sample = values
    .slice(0, SAMPLE_SIZE)
    .map((value) => String(value ?? '').trim())
    .filter((value) => value !== '')

  // Une colonne entièrement vide n'est pas une colonne de texte : on ne sait
  // rien d'elle.
  if (!sample.length) return 'unknown'

  const every = (predicate: (value: string) => boolean) => sample.every(predicate)

  // Les booléens passent avant les nombres : sinon « 0 »/« 1 » seraient
  // ambigus. On ne les traite volontairement pas comme des booléens.
  if (every((value) => BOOLEAN_VALUES.has(value.toLocaleLowerCase('fr')))) return 'boolean'
  // Les dates passent AVANT les nombres : parseLocalizedNumber('15/07/2026')
  // retire les barres obliques et rend 15072026, pas null. Tester le nombre en
  // premier classerait donc toute colonne de dates françaises en « number ».
  if (every((value) => ISO_DATE.test(value) || FR_DATE.test(value))) return 'date'
  if (every((value) => parseLocalizedNumber(value) !== null)) return 'number'
  if (every(isJsonValue)) return 'json'

  return 'string'
}

function isJsonValue(value: string): boolean {
  if (!value.startsWith('{') && !value.startsWith('[')) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function buildColumnDefinitions(parsed: ParsedCsv) {
  return parsed.columns.map((name, position) => ({
    name,
    position,
    detectedType: inferColumnType(parsed.rows.map((row) => row[name])),
  }))
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/services/csv-parser.service.test.ts`
Attendu : 12 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/services/csv-parser.service.ts tests/services/csv-parser.service.test.ts
git commit -m "Ajoute l'analyse CSV serveur avec détection d'encodage"
```

---

### Tâche 5 : Téléversement du CSV — service et route

**Fichiers :**
- Créer : `src/lib/messages.ts`
- Créer : `src/services/csv-import.service.ts`
- Créer : `src/lib/validations/csv-template.schema.ts`
- Créer : `src/app/api/csv-imports/route.ts`
- Test : `tests/services/csv-import.service.test.ts`

**Interfaces :**
- Consomme : `parseCsvBuffer`, `buildColumnDefinitions` (tâche 4) ; `CsvImport`
  (tâche 2).
- Produit : `createCsvImport(input: { buffer: Buffer; originalFileName: string; mimeType: string }): Promise<CsvImportResult>` où
  `CsvImportResult = { importId: string; columns: string[]; rowCount: number; encoding: string; encodingConfident: boolean; delimiter: string }` ;
  `MAX_CSV_BYTES` ; `assertCsvFile(fileName: string, mimeType: string, size: number): void`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/csv-import.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { withTestDatabase } from '../helpers/db'
import { assertCsvFile, createCsvImport } from '@/services/csv-import.service'
import { CsvImport } from '@/models/CsvImport'

withTestDatabase()

const csv = () => Buffer.from('Nom;Prix\r\nVase;12,50\r\n', 'utf-8')

describe('assertCsvFile', () => {
  it('accepte un CSV', () => {
    expect(() => assertCsvFile('produits.csv', 'text/csv', 1000)).not.toThrow()
  })

  it('refuse une extension non CSV', () => {
    expect(() => assertCsvFile('facture.pdf', 'application/pdf', 1000)).toThrow(/CSV/)
  })

  it('refuse un fichier vide', () => {
    expect(() => assertCsvFile('produits.csv', 'text/csv', 0)).toThrow(/vide/)
  })

  it('refuse un fichier trop volumineux', () => {
    expect(() => assertCsvFile('produits.csv', 'text/csv', 11 * 1024 * 1024)).toThrow(/volumineux/)
  })
})

describe('createCsvImport', () => {
  it('enregistre les métadonnées et écrit le fichier brut sur disque', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    expect(result.columns).toEqual(['Nom', 'Prix'])
    expect(result.rowCount).toBe(1)

    const doc = await CsvImport.findById(result.importId)
    expect(doc).not.toBeNull()

    // Les octets exacts doivent survivre : c'est ce qui permettra de
    // re-décoder fidèlement à la création du template.
    expect(await readFile(doc!.filePath)).toEqual(csv())
    await rm(doc!.filePath, { force: true })
  })

  it('ne stocke pas les lignes dans le document', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    const doc = await CsvImport.findById(result.importId).lean()
    expect(doc).not.toHaveProperty('rows')
    await rm((doc as { filePath: string }).filePath, { force: true })
  })

  it('nettoie le nom de fichier pour empêcher une traversée de répertoire', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: '../../../etc/passwd.csv',
      mimeType: 'text/csv',
    })

    const doc = await CsvImport.findById(result.importId)
    expect(doc!.filePath).not.toContain('..')
    expect(doc!.originalFileName).toBe('passwd.csv')
    await rm(doc!.filePath, { force: true })
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/csv-import.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/csv-import.service.ts` :

```ts
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connectToDatabase } from '@/lib/mongodb'
import { CsvImport } from '@/models/CsvImport'
import { parseCsvBuffer } from '@/services/csv-parser.service'

export const MAX_CSV_BYTES = Number(process.env.MAX_CSV_BYTES ?? 10 * 1024 * 1024)

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'csv')

export interface CsvImportResult {
  importId: string
  columns: string[]
  rowCount: number
  encoding: string
  encodingConfident: boolean
  delimiter: string
}

export function assertCsvFile(fileName: string, mimeType: string, size: number): void {
  if (size === 0) {
    throw new Error('Le fichier est vide.')
  }

  if (size > MAX_CSV_BYTES) {
    throw new Error(
      `Fichier trop volumineux : ${Math.round(size / 1024 / 1024)} Mo pour une limite de ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} Mo.`,
    )
  }

  if (!/\.csv$/i.test(fileName)) {
    // Le message doit contenir « CSV » en majuscules : le test l'assert avec
    // /CSV/, une regex sensible à la casse.
    throw new Error('Le fichier doit être un CSV (extension .csv attendue).')
  }

  // Les navigateurs et tableurs annoncent le CSV sous des types très variables,
  // et parfois sous application/octet-stream. On vérifie donc que le type n'est
  // pas manifestement autre chose, plutôt que d'exiger une liste blanche stricte.
  const forbidden = ['application/pdf', 'image/', 'application/zip']
  if (forbidden.some((prefix) => mimeType.startsWith(prefix))) {
    throw new Error(`Type de fichier refusé : ${mimeType}. Un CSV est attendu.`)
  }
}

export async function createCsvImport(input: {
  buffer: Buffer
  originalFileName: string
  mimeType: string
}): Promise<CsvImportResult> {
  // basename neutralise « ../ » : un nom de fichier vient du client et ne doit
  // jamais pouvoir désigner un chemin hors du dossier d'upload.
  const safeName = basename(input.originalFileName)

  assertCsvFile(safeName, input.mimeType, input.buffer.byteLength)

  const parsed = parseCsvBuffer(input.buffer)

  await connectToDatabase()
  await mkdir(UPLOAD_DIR, { recursive: true })

  const storedFileName = `${randomUUID()}.csv`
  const filePath = join(UPLOAD_DIR, storedFileName)

  await writeFile(filePath, input.buffer)

  try {
    const doc = await CsvImport.create({
      originalFileName: safeName,
      storedFileName,
      filePath,
      fileSize: input.buffer.byteLength,
      mimeType: input.mimeType,
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      columns: parsed.columns,
      rowCount: parsed.rows.length,
    })

    return {
      importId: String(doc._id),
      columns: parsed.columns,
      rowCount: parsed.rows.length,
      encoding: parsed.encoding,
      encodingConfident: parsed.encodingConfident,
      delimiter: parsed.delimiter,
    }
  } catch (error) {
    // Sans ce nettoyage, un échec Mongo laisserait un fichier orphelin sur
    // disque, sans document pour le retrouver.
    await rm(filePath, { force: true })
    throw error
  }
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/services/csv-import.service.test.ts`
Attendu : 7 tests PASS.

- [ ] **Étape 5 : Créer le module des messages partagés**

Créer `src/lib/messages.ts` :

```ts
/**
 * Message imposé par la spec. Défini une seule fois : routes, services et
 * pages doivent en afficher exactement le même texte.
 */
export const NO_ACTIVE_TEMPLATE_MESSAGE =
  'Aucun template CSV actif. Importez un fichier CSV ShopCaisse et définissez-le comme source de vérité avant d’importer une facture.'
```

- [ ] **Étape 6 : Créer les schémas Zod**

Créer `src/lib/validations/csv-template.schema.ts` :

```ts
import { z } from 'zod'
import { isValidObjectId } from 'mongoose'

export const objectIdSchema = z
  .string()
  .refine((value) => isValidObjectId(value), { message: 'Identifiant MongoDB invalide.' })

export const fromImportSchema = z.object({
  importId: objectIdSchema,
  name: z.string().trim().min(1).max(200).optional(),
})

export const activateTemplateSchema = z.object({
  force: z.boolean().optional().default(false),
})

export type FromImportInput = z.infer<typeof fromImportSchema>
export type ActivateTemplateInput = z.infer<typeof activateTemplateSchema>
```

- [ ] **Étape 7 : Créer la route de téléversement**

Créer `src/app/api/csv-imports/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { createCsvImport } from '@/services/csv-import.service'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const file = formData.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'missing_file', message: 'Aucun fichier reçu sous la clé « file ».' },
        { status: 400 },
      )
    }

    const result = await createCsvImport({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalFileName: file.name,
      mimeType: file.type || 'application/octet-stream',
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import impossible.'
    return NextResponse.json({ error: 'csv_import_failed', message }, { status: 400 })
  }
}
```

- [ ] **Étape 8 : Vérifier la route à la main**

```bash
npm run mongo:start
npm run dev &
sleep 5
curl -s -F "file=@exemple-produits.csv" http://localhost:3000/api/csv-imports | head -20
```

Attendu : un JSON avec `importId`, `columns`, `rowCount`, `encoding`.

- [ ] **Étape 9 : Commit**

```bash
git add src/lib/messages.ts src/services/csv-import.service.ts src/lib/validations src/app/api/csv-imports tests/services/csv-import.service.test.ts
git commit -m "Ajoute le téléversement CSV serveur avec stockage du fichier brut"
```

---

### Tâche 6 : Service template — création, activation transactionnelle, contrôle D6

**Fichiers :**
- Créer : `src/services/csv-template.service.ts`
- Test : `tests/services/csv-template.service.test.ts`

**Interfaces :**
- Consomme : `CsvTemplate`, `CsvImport`, `CatalogProduct` (tâche 2) ;
  `parseCsvBuffer`, `buildColumnDefinitions` (tâche 4).
- Produit :
  `createTemplateFromImport(importId: string, name?: string): Promise<{ templateId: string; parsed: ParsedCsv }>` ;
  `activateTemplate(templateId: string, options?: { force?: boolean }): Promise<void>` ;
  `getActiveTemplate(): Promise<CsvTemplateDoc & { _id: ObjectId } | null>` ;
  `findMissingColumns(templateId: string): Promise<string[]>` ;
  classe `TemplateColumnsMissingError` portant `missingColumns: string[]`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/csv-template.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import {
  TemplateColumnsMissingError,
  activateTemplate,
  getActiveTemplate,
} from '@/services/csv-template.service'

withTestDatabase()

async function makeTemplate(columnNames: string[], isActive = false) {
  return CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    isActive,
    columns: columnNames.map((name, position) => ({ name, position, detectedType: 'string' })),
  })
}

describe('activateTemplate', () => {
  it("désactive l'ancien template et active le nouveau", async () => {
    const ancien = await makeTemplate(['Nom'], true)
    const nouveau = await makeTemplate(['Nom'])

    await activateTemplate(String(nouveau._id))

    expect((await CsvTemplate.findById(ancien._id))!.isActive).toBe(false)
    expect((await CsvTemplate.findById(nouveau._id))!.isActive).toBe(true)
    expect(await CsvTemplate.countDocuments({ isActive: true })).toBe(1)
  })

  it('refuse un template dont les colonnes manquent au catalogue', async () => {
    const source = await makeTemplate(['Nom'], true)
    await CatalogProduct.create({
      templateId: source._id,
      csvData: { Nom: 'Vase' },
    })

    const cible = await makeTemplate(['Nom', 'Code barre', "Prix d'achat"])

    const error = await activateTemplate(String(cible._id)).catch((e) => e)

    expect(error).toBeInstanceOf(TemplateColumnsMissingError)
    expect(error.missingColumns).toEqual(['Code barre', "Prix d'achat"])

    // Le refus ne doit rien avoir activé.
    expect((await CsvTemplate.findById(cible._id))!.isActive).toBe(false)
    expect((await CsvTemplate.findById(source._id))!.isActive).toBe(true)
  })

  it('active malgré tout avec force', async () => {
    const source = await makeTemplate(['Nom'], true)
    await CatalogProduct.create({ templateId: source._id, csvData: { Nom: 'Vase' } })
    const cible = await makeTemplate(['Nom', 'Code barre'])

    await activateTemplate(String(cible._id), { force: true })

    expect((await CsvTemplate.findById(cible._id))!.isActive).toBe(true)
  })

  it('n’applique aucun contrôle quand le catalogue est vide', async () => {
    const template = await makeTemplate(['Nom', 'Code barre'])
    await activateTemplate(String(template._id))
    expect((await CsvTemplate.findById(template._id))!.isActive).toBe(true)
  })

  it('ne laisse aucun état partiel si le template cible n’existe pas', async () => {
    const ancien = await makeTemplate(['Nom'], true)
    const absent = '507f1f77bcf86cd799439011'

    await expect(activateTemplate(absent)).rejects.toThrow(/introuvable/)

    // La transaction doit avoir annulé la désactivation de l'ancien.
    expect((await CsvTemplate.findById(ancien._id))!.isActive).toBe(true)
  })
})

describe('getActiveTemplate', () => {
  it('rend null quand aucun template n’est actif', async () => {
    await makeTemplate(['Nom'])
    expect(await getActiveTemplate()).toBeNull()
  })

  it('rend le template actif', async () => {
    const actif = await makeTemplate(['Nom'], true)
    expect(String((await getActiveTemplate())!._id)).toBe(String(actif._id))
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/csv-template.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/csv-template.service.ts` :

```ts
import mongoose, { isValidObjectId } from 'mongoose'
import { readFile } from 'node:fs/promises'
import { connectToDatabase } from '@/lib/mongodb'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CsvImport } from '@/models/CsvImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { buildColumnDefinitions, parseCsvBuffer, type ParsedCsv } from '@/services/csv-parser.service'

/** Levée quand les colonnes du template visé manquent au catalogue (D6). */
export class TemplateColumnsMissingError extends Error {
  constructor(readonly missingColumns: string[]) {
    super(
      `Colonnes absentes du catalogue : ${missingColumns.join(', ')}. ` +
        'Réactivez avec force: true, ou rejouez l’import d’origine.',
    )
    this.name = 'TemplateColumnsMissingError'
  }
}

const CATALOG_SAMPLE_SIZE = 100

export async function getActiveTemplate() {
  await connectToDatabase()
  return CsvTemplate.findOne({ isActive: true }).lean()
}

/**
 * Colonnes du template absentes des clés réellement présentes dans csvData.
 *
 * L'échantillon porte sur le catalogue et non sur le template précédent : un
 * produit peut avoir été créé par une facture sans porter toutes les colonnes.
 */
async function computeMissingColumns(
  columnNames: string[],
  session?: mongoose.ClientSession,
): Promise<string[]> {
  const sample = await CatalogProduct.find({ isDeleted: false })
    .limit(CATALOG_SAMPLE_SIZE)
    .select('csvData')
    .session(session ?? null)
    .lean()

  // Catalogue vide : rien à contredire, donc rien à refuser.
  if (!sample.length) return []

  const present = new Set<string>()
  for (const product of sample) {
    for (const key of Object.keys((product.csvData ?? {}) as Record<string, unknown>)) {
      present.add(key)
    }
  }

  return columnNames.filter((name) => !present.has(name))
}

export async function findMissingColumns(templateId: string): Promise<string[]> {
  await connectToDatabase()
  const template = await CsvTemplate.findById(templateId).lean()
  if (!template) throw new Error('Template introuvable.')
  return computeMissingColumns(template.columns.map((column) => column.name))
}

export async function activateTemplate(
  templateId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isValidObjectId(templateId)) {
    throw new Error('Identifiant de template invalide.')
  }

  await connectToDatabase()
  const session = await mongoose.startSession()

  try {
    await session.withTransaction(async () => {
      const template = await CsvTemplate.findById(templateId).session(session)

      if (!template) {
        throw new Error('Template introuvable.')
      }

      // Le contrôle est DANS la transaction : une synchronisation concurrente
      // ne peut pas invalider le constat entre la vérification et l'écriture.
      if (!options.force) {
        const missing = await computeMissingColumns(
          template.columns.map((column) => column.name),
          session,
        )
        if (missing.length) throw new TemplateColumnsMissingError(missing)
      }

      await CsvTemplate.updateMany(
        { _id: { $ne: template._id } },
        { $set: { isActive: false } },
        { session },
      )

      await CsvTemplate.findByIdAndUpdate(
        template._id,
        { $set: { isActive: true } },
        { session, runValidators: true },
      )
    })
  } finally {
    await session.endSession()
  }
}

export async function createTemplateFromImport(
  importId: string,
  name?: string,
): Promise<{ templateId: string; parsed: ParsedCsv }> {
  if (!isValidObjectId(importId)) {
    throw new Error('Identifiant d’import invalide.')
  }

  await connectToDatabase()

  const csvImport = await CsvImport.findById(importId)
  if (!csvImport) {
    throw new Error('Import CSV introuvable.')
  }

  // Rejoue les octets d'origine : c'est la seule façon de retrouver l'encodage
  // exact et les valeurs telles qu'elles étaient dans le fichier.
  const buffer = await readFile(csvImport.filePath)
  const parsed = parseCsvBuffer(buffer)

  const template = await CsvTemplate.create({
    name: name?.trim() || defaultTemplateName(csvImport.originalFileName),
    sourceFileName: csvImport.originalFileName,
    sourceImportId: csvImport._id,
    columns: buildColumnDefinitions(parsed),
    delimiter: parsed.delimiter,
    encoding: parsed.encoding,
    isActive: false,
  })

  return { templateId: String(template._id), parsed }
}

function defaultTemplateName(fileName: string): string {
  const base = fileName.replace(/\.csv$/i, '')
  const date = new Date().toLocaleDateString('fr-FR')
  return `${base} — ${date}`
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/services/csv-template.service.test.ts`
Attendu : 7 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/services/csv-template.service.ts tests/services/csv-template.service.test.ts
git commit -m "Ajoute le service template avec activation transactionnelle et contrôle des colonnes"
```

---

### Tâche 7 : Synchronisation du catalogue

**Fichiers :**
- Créer : `src/services/catalog-sync.service.ts`
- Test : `tests/services/catalog-sync.service.test.ts`

**Interfaces :**
- Consomme : `detectIdentityMapping`, `normalizeMatchValue`, `nameSupplierKey`
  (tâche 3) ; `CatalogProduct` (tâche 2) ; `ParsedCsv` (tâche 4).
- Produit :
  `syncCatalogFromCsv(templateId: string, parsed: ParsedCsv): Promise<CatalogSyncSummary>` où
  `CatalogSyncSummary = { created: number; updated: number; ambiguous: Array<{ row: number; matchedBy: MatchKey; candidateIds: string[] }>; missingFromCsv: string[]; errors: Array<{ row: number; message: string }> }`.

  La spec listait un champ `unchanged`. Il est retiré : le distinguer d'`updated`
  imposerait de charger tout `csvData` en mémoire pour une comparaison profonde,
  pour une information sans usage. Un champ qui vaudrait toujours 0 serait pire
  que son absence.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/catalog-sync.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { syncCatalogFromCsv } from '@/services/catalog-sync.service'
import type { ParsedCsv } from '@/services/csv-parser.service'

withTestDatabase()

const COLUMNS = ['Identifiant', 'Nom', 'Fournisseur', 'Référence', 'Code barre']

function parsed(rows: Record<string, string>[]): ParsedCsv {
  return { columns: COLUMNS, rows, delimiter: ';', encoding: 'utf-8', encodingConfident: true }
}

async function makeTemplate() {
  const template = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
  })
  return String(template._id)
}

const row = (over: Partial<Record<string, string>> = {}) => ({
  Identifiant: '',
  Nom: 'Vase',
  Fournisseur: 'Fournisseur A',
  Référence: '',
  'Code barre': '',
  ...over,
})

describe('syncCatalogFromCsv', () => {
  it('crée les produits et remplit csvData avec les noms de colonnes du template', async () => {
    const templateId = await makeTemplate()

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'VASE-001' })]))

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.csvData).toMatchObject({ Nom: 'Vase', Référence: 'VASE-001' })
    expect(product!.reference).toBe('VASE-001')
  })

  it('met à jour par référence sans dupliquer', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'VASE-001' })]))

    const summary = await syncCatalogFromCsv(
      templateId,
      parsed([row({ Référence: 'VASE-001', Nom: 'Vase rouge' })]),
    )

    expect(summary.updated).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
    expect((await CatalogProduct.findOne({}).lean())!.csvData).toMatchObject({ Nom: 'Vase rouge' })
  })

  it('respecte l’ordre de priorité : identifiant avant référence', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Identifiant: 'A1', Référence: 'REF-1' })]))

    // Même identifiant, référence différente : c'est l'identifiant qui gagne.
    const summary = await syncCatalogFromCsv(
      templateId,
      parsed([row({ Identifiant: 'A1', Référence: 'REF-2' })]),
    )

    expect(summary.updated).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })

  it('ne fusionne jamais deux produits aux noms similaires', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase décoratif' })]))

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase décoratif bleu' })]))

    expect(summary.created).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(2)
  })

  it('fait correspondre nom + fournisseur malgré casse et accents', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase décoratif' })]))

    const summary = await syncCatalogFromCsv(
      templateId,
      parsed([row({ Nom: '  VASE DECORATIF  ' })]),
    )

    expect(summary.updated).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })

  it('ne fait pas correspondre deux produits sur une valeur vide partagée', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase', Fournisseur: '' })]))

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Bol', Fournisseur: '' })]))

    expect(summary.created).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(2)
  })

  it('signale une correspondance ambiguë et crée un nouveau produit (D4)', async () => {
    const templateId = await makeTemplate()
    // Deux produits partageant le même code-barres : le catalogue est ambigu.
    await CatalogProduct.create([
      { templateId, barcode: '370', csvData: { Nom: 'A', 'Code barre': '370' } },
      { templateId, barcode: '370', csvData: { Nom: 'B', 'Code barre': '370' } },
    ])

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ 'Code barre': '370' })]))

    expect(summary.ambiguous).toHaveLength(1)
    expect(summary.ambiguous[0].matchedBy).toBe('barcode')
    expect(summary.ambiguous[0].candidateIds).toHaveLength(2)
    expect(summary.created).toBe(1)
  })

  it('n’écrase pas originalCsvData au ré-import (D3)', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1', Nom: 'Nom initial' })]))

    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1', Nom: 'Nom modifié' })]))

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.originalCsvData as Record<string, unknown>).Nom).toBe('Nom initial')
    expect((product!.csvData as Record<string, unknown>).Nom).toBe('Nom modifié')
  })

  it('ne supprime ni ne marque un produit absent du CSV (D2)', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1' }), row({ Référence: 'R2' })]))

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1' })]))

    expect(summary.missingFromCsv).toHaveLength(1)
    expect(await CatalogProduct.countDocuments({ isDeleted: true })).toBe(0)
    expect(await CatalogProduct.countDocuments({})).toBe(2)
  })

  it('re-pointe templateId vers le template actif (D1)', async () => {
    const premier = await makeTemplate()
    await syncCatalogFromCsv(premier, parsed([row({ Référence: 'R1' })]))

    const second = await makeTemplate()
    await syncCatalogFromCsv(second, parsed([row({ Référence: 'R1' })]))

    const product = await CatalogProduct.findOne({}).lean()
    expect(String(product!.templateId)).toBe(second)
  })

  it('conserve les colonnes supplémentaires dans csvData', async () => {
    const templateId = await makeTemplate()
    const withExtra = { ...row({ Référence: 'R1' }), 'Colonne Maison': 'valeur' }

    await syncCatalogFromCsv(templateId, {
      ...parsed([withExtra]),
      columns: [...COLUMNS, 'Colonne Maison'],
    })

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.csvData as Record<string, unknown>)['Colonne Maison']).toBe('valeur')
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/catalog-sync.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/catalog-sync.service.ts` :

```ts
import { Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { detectIdentityMapping, nameSupplierKey, normalizeMatchValue } from '@/lib/catalog-columns'
import type { ParsedCsv } from '@/services/csv-parser.service'

export type MatchKey = 'shopcaisseId' | 'reference' | 'barcode' | 'nameSupplier'

export interface CatalogSyncSummary {
  created: number
  updated: number
  ambiguous: Array<{ row: number; matchedBy: MatchKey; candidateIds: string[] }>
  /** Produits du catalogue absents du CSV. Jamais supprimés ni marqués (D2). */
  missingFromCsv: string[]
  errors: Array<{ row: number; message: string }>
}

const BATCH_SIZE = 500

interface IndexedProduct {
  _id: Types.ObjectId
  shopcaisseId: string | null
  reference: string | null
  barcode: string | null
  name: string | null
  supplier: string | null
}

/**
 * Aligne le catalogue sur les lignes d'un CSV.
 *
 * Volontairement hors transaction : un CSV de plusieurs milliers de lignes
 * dépasserait la limite de 16 Mo de l'oplog transactionnel et le délai de 60 s
 * par défaut. Les écritures sont idempotentes, donc l'opération est relançable
 * après échec partiel.
 */
export async function syncCatalogFromCsv(
  templateId: string,
  parsed: ParsedCsv,
): Promise<CatalogSyncSummary> {
  await connectToDatabase()

  const mapping = detectIdentityMapping(parsed.columns)
  const summary: CatalogSyncSummary = {
    created: 0,
    updated: 0,
    ambiguous: [],
    missingFromCsv: [],
    errors: [],
  }

  // Le catalogue est chargé et indexé en mémoire une fois : une requête par
  // ligne serait ruineuse sur plusieurs milliers de produits.
  const existing = (await CatalogProduct.find({ isDeleted: false })
    .select('shopcaisseId reference barcode name supplier')
    .lean()) as unknown as IndexedProduct[]

  const indexes: Record<MatchKey, Map<string, Types.ObjectId[]>> = {
    shopcaisseId: new Map(),
    reference: new Map(),
    barcode: new Map(),
    nameSupplier: new Map(),
  }

  for (const product of existing) {
    addToIndex(indexes.shopcaisseId, normalizeMatchValue(product.shopcaisseId), product._id)
    addToIndex(indexes.reference, normalizeMatchValue(product.reference), product._id)
    addToIndex(indexes.barcode, normalizeMatchValue(product.barcode), product._id)
    addToIndex(
      indexes.nameSupplier,
      nameSupplierKey(product.name, product.supplier),
      product._id,
    )
  }

  const seen = new Set<string>()
  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []

  parsed.rows.forEach((row, rowIndex) => {
    try {
      const identity = {
        shopcaisseId: readCell(row, mapping.shopcaisseId),
        reference: readCell(row, mapping.reference),
        barcode: readCell(row, mapping.barcode),
        name: readCell(row, mapping.name),
        supplier: readCell(row, mapping.supplier),
      }

      const csvData = Object.fromEntries(
        parsed.columns.map((column) => [column, normalizeCsvValue(row[column])]),
      )

      const match = findMatch(indexes, identity)

      if (match.status === 'ambiguous') {
        summary.ambiguous.push({
          row: rowIndex,
          matchedBy: match.matchedBy,
          candidateIds: match.candidateIds.map(String),
        })
      }

      if (match.status === 'matched') {
        seen.add(String(match.id))
        operations.push({
          updateOne: {
            filter: { _id: match.id },
            update: {
              $set: {
                templateId: new Types.ObjectId(templateId),
                ...identity,
                csvData,
              },
              // originalCsvData n'est écrit qu'à la création (D3) : $setOnInsert
              // ne s'applique pas ici puisque le document existe déjà.
            },
          },
        })
        summary.updated += 1
        return
      }

      // Ambigu ou sans correspondance : nouveau produit. Jamais de fusion (D4).
      operations.push({
        insertOne: {
          document: {
            templateId: new Types.ObjectId(templateId),
            ...identity,
            csvData,
            originalCsvData: csvData,
            isDeleted: false,
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

  for (let index = 0; index < operations.length; index += BATCH_SIZE) {
    await CatalogProduct.bulkWrite(operations.slice(index, index + BATCH_SIZE), { ordered: false })
  }

  summary.missingFromCsv = existing
    .filter((product) => !seen.has(String(product._id)))
    .map((product) => String(product._id))

  return summary
}

function addToIndex(index: Map<string, Types.ObjectId[]>, key: string, id: Types.ObjectId) {
  // Une valeur vide n'identifie personne : deux produits sans code-barres ne
  // sont pas le même produit.
  if (!key) return
  const bucket = index.get(key)
  if (bucket) bucket.push(id)
  else index.set(key, [id])
}

type MatchOutcome =
  | { status: 'matched'; id: Types.ObjectId; matchedBy: MatchKey }
  | { status: 'ambiguous'; matchedBy: MatchKey; candidateIds: Types.ObjectId[] }
  | { status: 'new' }

function findMatch(
  indexes: Record<MatchKey, Map<string, Types.ObjectId[]>>,
  identity: { shopcaisseId: string | null; reference: string | null; barcode: string | null; name: string | null; supplier: string | null },
): MatchOutcome {
  const candidates: Array<[MatchKey, string]> = [
    ['shopcaisseId', normalizeMatchValue(identity.shopcaisseId)],
    ['reference', normalizeMatchValue(identity.reference)],
    ['barcode', normalizeMatchValue(identity.barcode)],
    ['nameSupplier', nameSupplierKey(identity.name, identity.supplier)],
  ]

  for (const [matchedBy, key] of candidates) {
    if (!key) continue

    const bucket = indexes[matchedBy].get(key)
    if (!bucket?.length) continue

    // Plusieurs candidats : on ne choisit pas à la place de l'utilisateur.
    if (bucket.length > 1) return { status: 'ambiguous', matchedBy, candidateIds: bucket }

    return { status: 'matched', id: bucket[0], matchedBy }
  }

  return { status: 'new' }
}

function readCell(row: Record<string, string>, column: string): string | null {
  if (!column) return null
  const value = row[column]
  return value === undefined || value === null || value.trim() === '' ? null : value.trim()
}

/** Une valeur absente vaut null, jamais 0 ni « N/A ». */
function normalizeCsvValue(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  return value as string
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/services/catalog-sync.service.test.ts`
Attendu : 11 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/services/catalog-sync.service.ts tests/services/catalog-sync.service.test.ts
git commit -m "Ajoute la synchronisation du catalogue depuis le CSV"
```

---

### Tâche 8 : Routes template — from-import, active, activate

**Fichiers :**
- Créer : `src/app/api/csv-templates/from-import/route.ts`
- Créer : `src/app/api/csv-templates/active/route.ts`
- Créer : `src/app/api/csv-templates/[templateId]/activate/route.ts`
- Test : `tests/services/from-import.integration.test.ts`

**Interfaces :**
- Consomme : `createTemplateFromImport`, `activateTemplate`, `getActiveTemplate`,
  `TemplateColumnsMissingError` (tâche 6) ; `syncCatalogFromCsv` (tâche 7) ;
  `fromImportSchema`, `activateTemplateSchema` (tâche 5).

- [ ] **Étape 1 : Écrire le test d'intégration qui échoue**

Créer `tests/services/from-import.integration.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { rm } from 'node:fs/promises'
import { withTestDatabase } from '../helpers/db'
import { createCsvImport } from '@/services/csv-import.service'
import { createTemplateFromImport, activateTemplate } from '@/services/csv-template.service'
import { syncCatalogFromCsv } from '@/services/catalog-sync.service'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvImport } from '@/models/CsvImport'

withTestDatabase()

const CSV = 'Identifiant;Nom;Famille;Fournisseur;Référence;Code barre\r\nA1;Vase;Objets déco;Fournisseur A;VASE-001;370\r\n'

describe('chaîne complète import → template → catalogue', () => {
  it('crée le template actif et alimente le catalogue', async () => {
    const imported = await createCsvImport({
      buffer: Buffer.from(CSV, 'utf-8'),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    const { templateId, parsed } = await createTemplateFromImport(imported.importId)
    const summary = await syncCatalogFromCsv(templateId, parsed)
    await activateTemplate(templateId, { force: true })

    const template = await CsvTemplate.findById(templateId).lean()

    // Les colonnes et leur ordre sont conservés à l'identique (spec 3).
    expect(template!.columns.map((c) => c.name)).toEqual([
      'Identifiant',
      'Nom',
      'Famille',
      'Fournisseur',
      'Référence',
      'Code barre',
    ])
    expect(template!.columns.map((c) => c.position)).toEqual([0, 1, 2, 3, 4, 5])
    expect(template!.delimiter).toBe(';')
    expect(template!.isActive).toBe(true)

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.csvData).toMatchObject({ Nom: 'Vase', Famille: 'Objets déco' })

    const doc = await CsvImport.findById(imported.importId)
    await rm(doc!.filePath, { force: true })
  })

  it('un seul template reste actif après plusieurs imports', async () => {
    for (const _ of [1, 2, 3]) {
      const imported = await createCsvImport({
        buffer: Buffer.from(CSV, 'utf-8'),
        originalFileName: 'produits.csv',
        mimeType: 'text/csv',
      })
      const { templateId, parsed } = await createTemplateFromImport(imported.importId)
      await syncCatalogFromCsv(templateId, parsed)
      await activateTemplate(templateId, { force: true })
      const doc = await CsvImport.findById(imported.importId)
      await rm(doc!.filePath, { force: true })
    }

    expect(await CsvTemplate.countDocuments({ isActive: true })).toBe(1)
    expect(await CsvTemplate.countDocuments({})).toBe(3)
    // Un seul produit : les trois imports décrivent le même (D1).
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/from-import.integration.test.ts`
Attendu : ÉCHEC.

- [ ] **Étape 3 : Créer la route `from-import`**

Créer `src/app/api/csv-templates/from-import/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { fromImportSchema } from '@/lib/validations/csv-template.schema'
import { activateTemplate, createTemplateFromImport } from '@/services/csv-template.service'
import { syncCatalogFromCsv } from '@/services/catalog-sync.service'

export async function POST(request: Request) {
  const parsedBody = fromImportSchema.safeParse(await request.json().catch(() => null))

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsedBody.error.issues },
      { status: 400 },
    )
  }

  try {
    const { templateId, parsed } = await createTemplateFromImport(
      parsedBody.data.importId,
      parsedBody.data.name,
    )

    // La synchronisation précède l'activation : le contrôle des colonnes de
    // activateTemplate compare aux clés du catalogue, qui doivent donc déjà
    // porter les colonnes du nouveau template.
    const summary = await syncCatalogFromCsv(templateId, parsed)
    await activateTemplate(templateId)

    return NextResponse.json({ templateId, summary }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Création du template impossible.'
    return NextResponse.json({ error: 'from_import_failed', message }, { status: 400 })
  }
}
```

- [ ] **Étape 4 : Créer la route `active`**

Créer `src/app/api/csv-templates/active/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET() {
  try {
    const template = await getActiveTemplate()

    if (!template) {
      return NextResponse.json(
        { error: 'no_active_template', message: NO_ACTIVE_TEMPLATE_MESSAGE },
        { status: 404 },
      )
    }

    return NextResponse.json({ template })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture du template impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}
```

- [ ] **Étape 5 : Créer la route `activate`**

Créer `src/app/api/csv-templates/[templateId]/activate/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { activateTemplateSchema, objectIdSchema } from '@/lib/validations/csv-template.schema'
import { TemplateColumnsMissingError, activateTemplate } from '@/services/csv-template.service'

// Next 16 : params est une Promise. La signature synchrone de Next 14 compile
// mais échoue à l'exécution.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params

  if (!objectIdSchema.safeParse(templateId).success) {
    return NextResponse.json(
      { error: 'invalid_template_id', message: 'Identifiant de template invalide.' },
      { status: 400 },
    )
  }

  const body = activateTemplateSchema.safeParse(await request.json().catch(() => ({})))

  if (!body.success) {
    return NextResponse.json({ error: 'invalid_body', issues: body.error.issues }, { status: 400 })
  }

  try {
    await activateTemplate(templateId, { force: body.data.force })
    return NextResponse.json({ templateId, isActive: true })
  } catch (error) {
    if (error instanceof TemplateColumnsMissingError) {
      return NextResponse.json(
        {
          error: 'template_columns_missing_from_catalog',
          missingColumns: error.missingColumns,
          hint: 'Réactivez malgré tout avec force: true, ou rejouez l’import d’origine via from-import.',
        },
        { status: 409 },
      )
    }

    const message = error instanceof Error ? error.message : 'Activation impossible.'
    const status = /introuvable/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'activation_failed', message }, { status })
  }
}
```

- [ ] **Étape 6 : Vérifier le succès**

Lancer : `npx vitest run tests/services/from-import.integration.test.ts`
Attendu : 2 tests PASS.

- [ ] **Étape 7 : Vérifier les routes à la main**

```bash
npm run mongo:start && npm run dev &
sleep 5
IMPORT=$(curl -s -F "file=@exemple-produits.csv" http://localhost:3000/api/csv-imports | node -pe "JSON.parse(require('fs').readFileSync(0)).importId")
curl -s -X POST http://localhost:3000/api/csv-templates/from-import \
  -H 'Content-Type: application/json' -d "{\"importId\":\"$IMPORT\"}" | head -c 400
echo
curl -s http://localhost:3000/api/csv-templates/active | head -c 200
```

Attendu : `templateId` + `summary` avec `created > 0`, puis le template actif.

- [ ] **Étape 8 : Commit**

```bash
git add src/app/api/csv-templates tests/services/from-import.integration.test.ts
git commit -m "Ajoute les routes de création, lecture et activation de template"
```

---

### Tâche 9 : Lecture du catalogue — service et route

**Fichiers :**
- Créer : `src/services/catalog-product.service.ts`
- Créer : `src/lib/validations/catalog.schema.ts`
- Créer : `src/app/api/catalog/products/route.ts`
- Test : `tests/services/catalog-product.service.test.ts`

**Interfaces :**
- Consomme : `CatalogProduct` (tâche 2) ; `getActiveTemplate` (tâche 6).
- Produit :
  `listCatalogProducts(options: { page: number; pageSize: number }): Promise<{ products: CatalogProductSummary[]; total: number; page: number; pageSize: number }>` ;
  `getCatalogColumnKeys(): Promise<string[]>` ;
  `CatalogProductSummary = { id: string; csvData: Record<string, unknown> }`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/catalog-product.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getCatalogColumnKeys, listCatalogProducts } from '@/services/catalog-product.service'

withTestDatabase()

async function seed(count: number) {
  const template = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    isActive: true,
    columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
  })

  await CatalogProduct.insertMany(
    Array.from({ length: count }, (_, index) => ({
      templateId: template._id,
      name: `Produit ${index}`,
      csvData: { Nom: `Produit ${index}` },
    })),
  )
}

describe('listCatalogProducts', () => {
  it('pagine', async () => {
    await seed(30)
    const result = await listCatalogProducts({ page: 2, pageSize: 10 })

    expect(result.products).toHaveLength(10)
    expect(result.total).toBe(30)
    expect(result.page).toBe(2)
  })

  it('exclut les produits supprimés', async () => {
    await seed(3)
    await CatalogProduct.updateOne({}, { $set: { isDeleted: true } })

    expect((await listCatalogProducts({ page: 1, pageSize: 10 })).total).toBe(2)
  })
})

describe('getCatalogColumnKeys', () => {
  it('rend les clés réellement présentes dans csvData', async () => {
    await seed(1)
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      csvData: { Nom: 'X', 'Code barre': '370' },
    })

    expect((await getCatalogColumnKeys()).sort()).toEqual(['Code barre', 'Nom'])
  })

  it('rend un tableau vide sur un catalogue vide', async () => {
    expect(await getCatalogColumnKeys()).toEqual([])
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/catalog-product.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/catalog-product.service.ts` :

```ts
import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'

export interface CatalogProductSummary {
  id: string
  csvData: Record<string, unknown>
}

const COLUMN_SAMPLE_SIZE = 100

export async function listCatalogProducts(options: { page: number; pageSize: number }) {
  await connectToDatabase()

  const page = Math.max(1, options.page)
  const pageSize = Math.min(500, Math.max(1, options.pageSize))

  const [products, total] = await Promise.all([
    CatalogProduct.find({ isDeleted: false })
      .sort({ _id: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .select('csvData')
      .lean(),
    CatalogProduct.countDocuments({ isDeleted: false }),
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

/**
 * Clés réellement présentes dans csvData, échantillonnées sur le catalogue.
 * Sert à repérer les colonnes qu'un template actif réclame mais que le
 * catalogue ne porte pas (D6).
 */
export async function getCatalogColumnKeys(): Promise<string[]> {
  await connectToDatabase()

  const sample = await CatalogProduct.find({ isDeleted: false })
    .limit(COLUMN_SAMPLE_SIZE)
    .select('csvData')
    .lean()

  const keys = new Set<string>()
  for (const product of sample) {
    for (const key of Object.keys((product.csvData ?? {}) as Record<string, unknown>)) {
      keys.add(key)
    }
  }

  return [...keys]
}
```

- [ ] **Étape 4 : Créer le schéma Zod**

Créer `src/lib/validations/catalog.schema.ts` :

```ts
import { z } from 'zod'

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
})

export const exportQuerySchema = z.object({
  bom: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})
```

- [ ] **Étape 5 : Créer la route**

Créer `src/app/api/catalog/products/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { listProductsQuerySchema } from '@/lib/validations/catalog.schema'
import { listCatalogProducts } from '@/services/catalog-product.service'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = listProductsQuerySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!query.success) {
    return NextResponse.json({ error: 'invalid_query', issues: query.error.issues }, { status: 400 })
  }

  try {
    const template = await getActiveTemplate()

    if (!template) {
      return NextResponse.json(
        { error: 'no_active_template', message: NO_ACTIVE_TEMPLATE_MESSAGE },
        { status: 404 },
      )
    }

    const result = await listCatalogProducts(query.data)

    return NextResponse.json({
      ...result,
      columns: [...template.columns]
        .sort((a, b) => a.position - b.position)
        .map((column) => column.name),
      delimiter: template.delimiter,
      templateName: template.name,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture du catalogue impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}
```

- [ ] **Étape 6 : Vérifier le succès**

Lancer : `npx vitest run tests/services/catalog-product.service.test.ts`
Attendu : 4 tests PASS.

- [ ] **Étape 7 : Commit**

```bash
git add src/services/catalog-product.service.ts src/lib/validations/catalog.schema.ts src/app/api/catalog/products tests/services/catalog-product.service.test.ts
git commit -m "Ajoute la lecture paginée du catalogue"
```

---

### Tâche 10 : Export CSV du catalogue

**Fichiers :**
- Créer : `src/services/catalog-export.service.ts`
- Créer : `src/app/api/catalog/export/route.ts`
- Test : `tests/services/catalog-export.service.test.ts`

**Interfaces :**
- Consomme : `getActiveTemplate` (tâche 6) ; `CatalogProduct` (tâche 2).
- Produit : `serializeCsvValue(value: unknown, delimiter?: string): string` ;
  `exportCatalogCsv(options?: { bom?: boolean }): Promise<{ csv: string; fileName: string }>`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/catalog-export.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { exportCatalogCsv, serializeCsvValue } from '@/services/catalog-export.service'

withTestDatabase()

describe('serializeCsvValue', () => {
  it('rend une cellule vide pour null et undefined', () => {
    expect(serializeCsvValue(null)).toBe('')
    expect(serializeCsvValue(undefined)).toBe('')
  })

  it('échappe le séparateur, les guillemets et les sauts de ligne', () => {
    expect(serializeCsvValue('a;b')).toBe('"a;b"')
    expect(serializeCsvValue('dit "bonjour"')).toBe('"dit ""bonjour"""')
    expect(serializeCsvValue('deux\nlignes')).toBe('"deux\nlignes"')
  })

  it('laisse une valeur simple intacte', () => {
    expect(serializeCsvValue('Vase')).toBe('Vase')
    expect(serializeCsvValue(12.5)).toBe('12.5')
  })

  it('n’échappe pas une virgule quand le séparateur est le point-virgule', () => {
    expect(serializeCsvValue('12,50', ';')).toBe('12,50')
  })
})

describe('exportCatalogCsv', () => {
  async function seedTemplate(columns: string[]) {
    return CsvTemplate.create({
      name: 'T',
      sourceFileName: 'produits.csv',
      isActive: true,
      delimiter: ';',
      columns: columns.map((name, position) => ({ name, position, detectedType: 'string' })),
    })
  }

  it('respecte les colonnes, leur ordre et le séparateur du template actif', async () => {
    const template = await seedTemplate(['Référence', 'Nom', 'Code barre'])
    await CatalogProduct.create({
      templateId: template._id,
      csvData: { Nom: 'Vase décoratif', Référence: 'ABC-001', 'Code barre': null },
    })

    const { csv } = await exportCatalogCsv({ bom: false })

    // Le code-barres est vide parce qu'il vaut null — jamais « 0 » ni « N/A ».
    expect(csv).toBe('Référence;Nom;Code barre\r\nABC-001;Vase décoratif;\r\n')
  })

  it('ajoute le BOM par défaut', async () => {
    const template = await seedTemplate(['Nom'])
    await CatalogProduct.create({ templateId: template._id, csvData: { Nom: 'Vase' } })

    expect((await exportCatalogCsv()).csv.startsWith('﻿')).toBe(true)
  })

  it('rend une cellule vide pour une colonne absente de csvData (D6 forcé)', async () => {
    const template = await seedTemplate(['Nom', "Prix d'achat"])
    await CatalogProduct.create({ templateId: template._id, csvData: { Nom: 'Vase' } })

    expect((await exportCatalogCsv({ bom: false })).csv).toBe("Nom;Prix d'achat\r\nVase;\r\n")
  })

  it('exclut les produits supprimés', async () => {
    const template = await seedTemplate(['Nom'])
    await CatalogProduct.create({ templateId: template._id, csvData: { Nom: 'Vase' }, isDeleted: true })

    expect((await exportCatalogCsv({ bom: false })).csv).toBe('Nom\r\n')
  })

  it('échoue explicitement sans template actif', async () => {
    await expect(exportCatalogCsv()).rejects.toThrow(/Aucun template CSV actif/)
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/catalog-export.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/catalog-export.service.ts` :

```ts
import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export function serializeCsvValue(value: unknown, delimiter = ';'): string {
  if (value === null || value === undefined) return ''

  const stringValue = String(value)

  if (
    stringValue.includes(delimiter) ||
    stringValue.includes('"') ||
    stringValue.includes('\n') ||
    stringValue.includes('\r')
  ) {
    return `"${stringValue.replaceAll('"', '""')}"`
  }

  return stringValue
}

export async function exportCatalogCsv(
  options: { bom?: boolean } = {},
): Promise<{ csv: string; fileName: string }> {
  await connectToDatabase()

  const template = await getActiveTemplate()
  if (!template) throw new Error(NO_ACTIVE_TEMPLATE_MESSAGE)

  const columns = [...template.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => column.name)

  const delimiter = template.delimiter || ';'
  const products = await CatalogProduct.find({ isDeleted: false })
    .sort({ _id: 1 })
    .select('csvData')
    .lean()

  const lines = [columns.map((column) => serializeCsvValue(column, delimiter)).join(delimiter)]

  for (const product of products) {
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    // Lecture par nom de colonne du template : une colonne absente donne une
    // cellule vide, cohérent avec le traitement de null (D6).
    lines.push(columns.map((column) => serializeCsvValue(csvData[column], delimiter)).join(delimiter))
  }

  // \r\n et BOM : format attendu par ShopCaisse, identique à l'export client.
  const csv = `${lines.join('\r\n')}\r\n`
  const withBom = options.bom === false ? csv : `﻿${csv}`

  return {
    csv: withBom,
    fileName: `catalogue-${new Date().toISOString().slice(0, 10)}.csv`,
  }
}
```

- [ ] **Étape 4 : Créer la route**

Créer `src/app/api/catalog/export/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { exportQuerySchema } from '@/lib/validations/catalog.schema'
import { exportCatalogCsv } from '@/services/catalog-export.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = exportQuerySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!query.success) {
    return NextResponse.json({ error: 'invalid_query', issues: query.error.issues }, { status: 400 })
  }

  try {
    const { csv, fileName } = await exportCatalogCsv({ bom: query.data.bom })

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export impossible.'
    const status = message === NO_ACTIVE_TEMPLATE_MESSAGE ? 404 : 500
    return NextResponse.json({ error: 'export_failed', message }, { status })
  }
}
```

- [ ] **Étape 5 : Vérifier le succès**

Lancer : `npx vitest run tests/services/catalog-export.service.test.ts`
Attendu : 9 tests PASS.

- [ ] **Étape 6 : Commit**

```bash
git add src/services/catalog-export.service.ts src/app/api/catalog/export tests/services/catalog-export.service.test.ts
git commit -m "Ajoute l'export CSV du catalogue au format ShopCaisse"
```

---

### Tâche 11 : Page `/catalogue`

**Fichiers :**
- Créer : `src/components/catalog/CatalogSummary.tsx`
- Créer : `src/components/catalog/CatalogProductsTable.tsx`
- Créer : `src/components/catalog/ExportCatalogButton.tsx`
- Créer : `src/app/catalogue/page.tsx`

**Interfaces :**
- Consomme : `getActiveTemplate` (tâche 6) ; `listCatalogProducts`,
  `getCatalogColumnKeys` (tâche 9).

- [ ] **Étape 1 : Créer `CatalogSummary`**

Créer `src/components/catalog/CatalogSummary.tsx` :

```tsx
interface CatalogSummaryProps {
  templateName: string
  templateUpdatedAt: string
  productCount: number
  missingColumns: string[]
}

export function CatalogSummary({
  templateName,
  templateUpdatedAt,
  productCount,
  missingColumns,
}: CatalogSummaryProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Catalogue produits</h2>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Template actif</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{templateName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Produits</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{productCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Dernière mise à jour</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {new Date(templateUpdatedAt).toLocaleDateString('fr-FR')}
          </dd>
        </div>
      </dl>

      {missingColumns.length > 0 && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Le template actif réclame des colonnes absentes du catalogue :{' '}
          <strong>{missingColumns.join(', ')}</strong>. Elles seront exportées vides. Rejouez
          l’import d’origine pour rétablir la cohérence.
        </p>
      )}
    </section>
  )
}
```

- [ ] **Étape 2 : Créer `CatalogProductsTable`**

Créer `src/components/catalog/CatalogProductsTable.tsx` :

```tsx
interface CatalogProductsTableProps {
  columns: string[]
  products: Array<{ id: string; csvData: Record<string, unknown> }>
}

export function CatalogProductsTable({ columns, products }: CatalogProductsTableProps) {
  if (!products.length) {
    return (
      <p className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Le catalogue est vide.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="whitespace-nowrap px-4 py-3 text-left font-medium text-slate-600"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-t border-slate-100">
              {columns.map((column) => {
                const value = product.csvData[column]
                return (
                  <td key={column} className="whitespace-nowrap px-4 py-2 text-slate-700">
                    {value === null || value === undefined ? (
                      // Une cellule vide se voit : elle signifie « donnée absente
                      // de la source », pas « zéro ».
                      <span className="text-slate-300">—</span>
                    ) : (
                      String(value)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Étape 3 : Créer `ExportCatalogButton`**

Créer `src/components/catalog/ExportCatalogButton.tsx` :

```tsx
'use client'

import { Download } from 'lucide-react'

export function ExportCatalogButton() {
  return (
    <a
      href="/api/catalog/export"
      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      <Download className="h-4 w-4" />
      Exporter le catalogue
    </a>
  )
}
```

- [ ] **Étape 4 : Créer la page**

Créer `src/app/catalogue/page.tsx` :

```tsx
import Link from 'next/link'
import { getActiveTemplate } from '@/services/csv-template.service'
import { getCatalogColumnKeys, listCatalogProducts } from '@/services/catalog-product.service'
import { CatalogSummary } from '@/components/catalog/CatalogSummary'
import { CatalogProductsTable } from '@/components/catalog/CatalogProductsTable'
import { ExportCatalogButton } from '@/components/catalog/ExportCatalogButton'

// Le catalogue change à chaque synchronisation : aucun cache.
export const dynamic = 'force-dynamic'

export default async function CataloguePage() {
  const template = await getActiveTemplate()

  if (!template) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-slate-600">
            Aucun template CSV actif. Importez un fichier CSV ShopCaisse et définissez-le comme
            source de vérité avant d’importer une facture.
          </p>
          <Link
            href="/tous-les-produits"
            className="mt-6 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            Importer un CSV
          </Link>
        </div>
      </main>
    )
  }

  const [{ products, total }, catalogKeys] = await Promise.all([
    listCatalogProducts({ page: 1, pageSize: 100 }),
    getCatalogColumnKeys(),
  ])

  const columns = [...template.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => column.name)

  // Colonnes réclamées par le template mais absentes du catalogue : le cas
  // survient après une activation forcée (D6).
  const missingColumns = catalogKeys.length
    ? columns.filter((column) => !catalogKeys.includes(column))
    : []

  return (
    <main className="min-h-screen space-y-6 p-4 md:p-8">
      <div className="mx-auto max-w-[1800px] space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Catalogue</h1>
          <ExportCatalogButton />
        </div>

        <CatalogSummary
          templateName={template.name}
          templateUpdatedAt={String(template.updatedAt)}
          productCount={total}
          missingColumns={missingColumns}
        />

        <CatalogProductsTable columns={columns} products={products} />
      </div>
    </main>
  )
}
```

- [ ] **Étape 5 : Vérifier à l'écran**

```bash
npm run mongo:start && npm run dev
```

Ouvrir `http://localhost:3000/catalogue`.
Attendu, sans template : le message imposé et le bouton d'import.
Attendu, après un `from-import` : le résumé, le tableau et l'export
téléchargeant un CSV ouvrable dans un tableur avec accents corrects.

- [ ] **Étape 6 : Commit**

```bash
git add src/app/catalogue src/components/catalog
git commit -m "Ajoute la page catalogue avec résumé, tableau et export"
```

---

### Tâche 12 : Brancher l'éditeur sur le serveur

**Fichiers :**
- Modifier : `src/components/csv-editor.tsx`

**Interfaces :**
- Consomme : `POST /api/csv-imports` (tâche 5) ;
  `POST /api/csv-templates/from-import` (tâche 8) ;
  `GET /api/catalog/products` (tâche 9).

- [ ] **Étape 1 : Ajouter l'état serveur**

Dans `src/components/csv-editor.tsx`, après la ligne 98
(`const [showMapping, setShowMapping] = useState(false)`), ajouter :

```ts
  const [lastImportId, setLastImportId] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  // 'session' : lignes issues de sessionStorage. 'catalog' : lignes issues de
  // MongoDB, non modifiables (D5).
  const [source, setSource] = useState<'session' | 'catalog'>('session')
```

- [ ] **Étape 2 : Charger le catalogue à l'hydratation**

Après le `useEffect` d'hydratation existant (ligne 100-121), ajouter :

```ts
  useEffect(() => {
    if (!hydrated) return

    let cancelled = false

    async function loadCatalog() {
      try {
        const response = await fetch('/api/catalog/products?pageSize=500')
        if (!response.ok) return // 404 = pas de template actif : on garde la session.

        const data = await response.json()
        if (cancelled) return

        setColumns(data.columns)
        setRows(
          data.products.map((product: { csvData: Record<string, unknown> }) =>
            Object.fromEntries(
              data.columns.map((column: string) => [
                column,
                // csvData porte des nombres et des null ; l'éditeur attend des
                // chaînes. La distinction null / vide est préservée côté
                // serveur, seul l'affichage est converti.
                product.csvData[column] === null || product.csvData[column] === undefined
                  ? ''
                  : String(product.csvData[column]),
              ]),
            ),
          ),
        )
        setDelimiter(data.delimiter)
        setMapping(detectColumnMapping(data.columns))
        setTemplateName(data.templateName)
        setSource('catalog')
      } catch {
        // Base injoignable : l'éditeur reste utilisable sur la session.
      }
    }

    loadCatalog()
    return () => {
      cancelled = true
    }
  }, [hydrated])
```

- [ ] **Étape 3 : Téléverser à l'import**

Dans `importCsv`, à l'intérieur de `complete`, juste après
`setShowMapping(...)`, ajouter :

```ts
        // L'objet File n'est disponible qu'ici : après un rechargement, seule
        // la session subsiste et le fichier d'origine est perdu.
        setIsUploading(true)
        const formData = new FormData()
        formData.append('file', file)

        fetch('/api/csv-imports', { method: 'POST', body: formData })
          .then(async (response) => {
            const data = await response.json()
            if (!response.ok) throw new Error(data.message ?? 'Téléversement impossible.')
            setLastImportId(data.importId)
            if (!data.encodingConfident) {
              setError(
                'Encodage du fichier non reconnu : utf-8 retenu par défaut. Vérifiez les accents.',
              )
            }
          })
          .catch((uploadError: Error) => setError(uploadError.message))
          .finally(() => setIsUploading(false))
```

- [ ] **Étape 4 : Ajouter l'action « Définir comme template actif »**

Ajouter la fonction après `exportCsv` :

```ts
  async function setAsActiveTemplate() {
    if (!lastImportId) return

    setSyncMessage('')
    setError('')

    try {
      const response = await fetch('/api/csv-templates/from-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: lastImportId }),
      })

      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Création du template impossible.')

      const { created, updated, ambiguous, missingFromCsv } = data.summary

      setSyncMessage(
        `Template actif. ${created} produit(s) créé(s), ${updated} mis à jour` +
          (ambiguous.length ? `, ${ambiguous.length} correspondance(s) ambiguë(s)` : '') +
          (missingFromCsv.length
            ? `, ${missingFromCsv.length} produit(s) du catalogue absent(s) du CSV (conservés)`
            : '') +
          '.',
      )

      // Recharge depuis MongoDB, qui devient la source affichée.
      window.location.reload()
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : 'Synchronisation impossible.')
    }
  }
```

- [ ] **Étape 5 : Ajouter le bandeau et le bouton**

Dans le JSX, juste après l'ouverture de `<main>` du rendu principal, insérer :

```tsx
        {source === 'catalog' && (
          <div className="mb-4 rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
            Données issues du catalogue MongoDB (template «&nbsp;{templateName}&nbsp;»). Les
            modifications faites ici ne sont pas enregistrées en base : elles n’affectent que
            l’affichage et l’export local.
          </div>
        )}

        {syncMessage && (
          <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            {syncMessage}
          </div>
        )}

        {lastImportId && source === 'session' && (
          <button
            type="button"
            onClick={setAsActiveTemplate}
            disabled={isUploading}
            className="mb-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <FileSpreadsheet className="h-4 w-4" />
            Définir comme template actif
          </button>
        )}
```

- [ ] **Étape 6 : Vérifier**

```bash
npx tsc --noEmit
npm run lint
npm run mongo:start && npm run dev
```

Parcours à dérouler : importer `exemple-produits.csv`, cliquer « Définir comme
template actif », constater le message de synchronisation, puis le bandeau bleu
après rechargement. Vérifier que `/sans-famille` filtre toujours correctement
les produits sans famille depuis les données MongoDB.

- [ ] **Étape 7 : Commit**

```bash
git add src/components/csv-editor.tsx
git commit -m "Branche l'éditeur sur le téléversement serveur et le catalogue MongoDB"
```

---

### Tâche 13 : Vérification d'ensemble

**Fichiers :**
- Modifier : `README.md`

- [ ] **Étape 1 : Lancer toute la suite**

```bash
npm test
```

Attendu : tous les fichiers de test PASS, aucun `.only` oublié.

- [ ] **Étape 2 : Vérifier types et lint**

```bash
npx tsc --noEmit && npm run lint
```

Attendu : aucune erreur.

- [ ] **Étape 3 : Vérifier la non-régression du filtre familles**

```bash
npx vitest run tests/lib
```

Puis, application lancée, importer un CSV contenant `Pas de famille` et
confirmer que `/sans-famille` les liste bien — la logique n'a pas été touchée,
mais elle s'applique désormais à des données venues de MongoDB.

- [ ] **Étape 4 : Documenter la mise en route**

Ajouter à `README.md` :

```markdown
## Développement

```bash
npm install
cp .env.example .env.local
npm run mongo:start   # MongoDB dédié, port 27018, replica set (transactions)
npm run dev
```

`npm run mongo:start` est à relancer après chaque redémarrage de la machine.
Les transactions exigent un replica set : le service MongoDB par défaut du port
27017, en standalone, ne convient pas.

### Mise en route du catalogue

1. Importer un CSV ShopCaisse depuis `/tous-les-produits`.
2. Cliquer « Définir comme template actif » : le template est créé et le
   catalogue synchronisé.
3. Consulter `/catalogue` et exporter au format ShopCaisse.

### Tests

```bash
npm test
```
```

- [ ] **Étape 5 : Commit**

```bash
git add README.md
git commit -m "Documente la mise en route du catalogue MongoDB"
```

---

## Couverture de la spec

| Exigence | Tâche |
|---|---|
| Connexion MongoDB, cache de rechargement à chaud | 1 |
| Harnais de test sur replica set | 1 |
| Modèles `CsvTemplate`, `CatalogProduct`, `CsvImport` | 2 |
| Index unique partiel « un seul actif » | 2 |
| Colonnes d'identité sans toucher aux familles | 3 |
| Détection d'encodage réelle (windows-1252) | 4 |
| `detectedType` sur 200 valeurs, `unknown` au doute | 4 |
| Téléversement, sécurité MIME / extension / taille / nom | 5 |
| Fichier brut sur disque, pas de lignes en base (D7) | 5 |
| Activation transactionnelle | 6 |
| Refus 409 + `force` (D6) | 6, 8 |
| Nom de template dérivé | 6 |
| Correspondance par priorité, jamais de fusion floue (D4) | 7 |
| `originalCsvData` figé (D3) | 7 |
| `isDeleted` jamais automatique (D2) | 7 |
| `templateId` re-pointé (D1) | 7 |
| Colonnes supplémentaires conservées | 7 |
| Routes template | 8 |
| Lecture paginée du catalogue | 9 |
| Export ShopCaisse, `null` → cellule vide | 10 |
| Page `/catalogue` + avertissement colonnes | 11 |
| Vues sur MongoDB, bandeau lecture seule (D5) | 12 |
| Message « aucun template actif » | 8, 11 |
| Validation Zod partout | 5, 8, 9, 10 |
