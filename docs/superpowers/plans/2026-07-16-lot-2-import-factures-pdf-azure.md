# Lot 2 — Import de factures PDF (Azure Document Intelligence) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** offrir un espace administrateur protégé qui importe une facture PDF, l'analyse via Azure Document Intelligence, laisse corriger les lignes extraites, puis les convertit en CSV ShopCaisse au format du template actif.

**Architecture :** le PDF est téléversé et stocké en base ; Azure l'analyse de façon asynchrone (statut + polling) ; le JSON Azure est normalisé en `InvoiceItem[]` (format interne) ; l'admin corrige ; la conversion emprunte colonnes, ordre, séparateur et format au `CsvTemplate` actif du lot 1. Réutilise les fondations du lot 1 (Mongo, template, sérialisation CSV).

**Tech Stack :** Next.js 16.2.10 (App Router), React 19.2.7, TypeScript, Tailwind, Mongoose, Zod, `@azure-rest/ai-document-intelligence`, Vitest, mongodb-memory-server.

Spec de référence : `docs/superpowers/specs/2026-07-16-import-factures-pdf-azure-design.md`

## Global Constraints

- **Node 22.15.0, Next 16.2.10, React 19.2.7.** Dans les route handlers de Next 16, `params` est une **`Promise`** : signature `{ params }: { params: Promise<{ invoiceId: string }> }` avec `await`.
- **Réutiliser le lot 1, ne pas le dupliquer.** Template de référence = `CsvTemplate` **actif** (`getActiveTemplate()` de `@/services/csv-template.service`). Conversion via `serializeCsvValue` (`@/services/catalog-export.service`) et `findColumn`/`normalizeHeader` (`@/lib/product-views`).
- **Ne jamais inventer.** Donnée absente ⇒ `null`, jamais `0`, `N/A`, ni valeur déduite. À l'export, `null` ⇒ cellule vide.
- **Format ShopCaisse exact.** Séparateur du template, `\r\n`, BOM UTF-8, ligne d'en-tête incluse.
- **Azure côté serveur uniquement.** `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY` jamais exposés au client. Aucun appel Azure depuis le navigateur. **Pas de `pdf-parse`.**
- **Serverless.** Pas de disque : PDF et données extraites en base. Analyse Azure asynchrone.
- **Toutes les routes admin protégées** par le middleware. **Toute entrée validée par Zod.** Tout identifiant Mongo validé par `mongoose.isValidObjectId`.
- **Variables d'environnement :** `MONGODB_URI` (existante), `ADMIN_PASSWORD`, `SESSION_SECRET`, `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY`, `MAX_PDF_BYTES` (optionnel, défaut 15 Mo).

---

### Tâche 1 : Authentification — signature/vérification du jeton de session

**Fichiers :**
- Créer : `src/lib/admin-auth.ts`
- Modifier : `.env.example`
- Test : `tests/lib/admin-auth.test.ts`

**Interfaces :**
- Produit : `signSession(secret: string, ttlMs?: number): Promise<string>` ; `verifySession(secret: string, token: string | undefined | null): Promise<boolean>` ; `constantTimeEqual(a: string, b: string): boolean` ; `ADMIN_COOKIE = 'admin_session'`.

Ces fonctions n'utilisent que la Web Crypto (`crypto.subtle`) et `btoa`/`atob`, disponibles en runtime Node **et** edge : le même module sert aux routes (Node) et au middleware (edge).

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/lib/admin-auth.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { signSession, verifySession, constantTimeEqual } from '@/lib/admin-auth'

const SECRET = 'secret-de-test-123'

describe('admin-auth', () => {
  it('valide un jeton fraîchement signé', async () => {
    const token = await signSession(SECRET)
    expect(await verifySession(SECRET, token)).toBe(true)
  })

  it('rejette un jeton signé avec un autre secret', async () => {
    const token = await signSession(SECRET)
    expect(await verifySession('autre-secret', token)).toBe(false)
  })

  it('rejette un jeton falsifié', async () => {
    const token = await signSession(SECRET)
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa')
    expect(await verifySession(SECRET, tampered)).toBe(false)
  })

  it('rejette un jeton expiré', async () => {
    const token = await signSession(SECRET, -1000) // déjà expiré
    expect(await verifySession(SECRET, token)).toBe(false)
  })

  it('rejette un jeton absent ou mal formé', async () => {
    expect(await verifySession(SECRET, undefined)).toBe(false)
    expect(await verifySession(SECRET, '')).toBe(false)
    expect(await verifySession(SECRET, 'pasunjeton')).toBe(false)
  })

  it('constantTimeEqual compare correctement', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/lib/admin-auth.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/lib/admin-auth'`.

- [ ] **Étape 3 : Implémenter le module**

Créer `src/lib/admin-auth.ts` :

```ts
export const ADMIN_COOKIE = 'admin_session'

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000 // 12 h

const encoder = new TextEncoder()

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return toBase64Url(new Uint8Array(signature))
}

/** Comparaison à temps constant, indépendante de la position du premier écart. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * Jeton = `<expiration ms>.<HMAC(expiration)>`. Signé côté serveur, vérifiable
 * en edge. ttlMs négatif produit un jeton déjà expiré (utile aux tests).
 */
export async function signSession(secret: string, ttlMs: number = DEFAULT_TTL_MS): Promise<string> {
  const expiry = String(Date.now() + ttlMs)
  const signature = await hmac(secret, expiry)
  return `${expiry}.${signature}`
}

export async function verifySession(
  secret: string,
  token: string | undefined | null,
): Promise<boolean> {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false

  const expiry = token.slice(0, dot)
  const signature = token.slice(dot + 1)
  if (!/^\d+$/.test(expiry)) return false

  const expected = await hmac(secret, expiry)
  if (!constantTimeEqual(signature, expected)) return false

  return Number(expiry) > Date.now()
}
```

- [ ] **Étape 4 : Compléter `.env.example`**

Ajouter à la fin de `.env.example` :

```bash
# Espace administrateur (lot 2)
ADMIN_PASSWORD="changez-moi"
SESSION_SECRET="chaine-aleatoire-longue-et-secrete"

# Azure Document Intelligence (lot 2)
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT="https://<ressource>.cognitiveservices.azure.com/"
AZURE_DOCUMENT_INTELLIGENCE_KEY="<clef>"
# Optionnel : plafond de taille des PDF (octets). Défaut 15 Mo.
# MAX_PDF_BYTES=15728640
```

- [ ] **Étape 5 : Vérifier le succès**

Lancer : `npx vitest run tests/lib/admin-auth.test.ts`
Attendu : 6 tests PASS.

- [ ] **Étape 6 : Commit**

```bash
git add src/lib/admin-auth.ts tests/lib/admin-auth.test.ts .env.example
git commit -m "Ajoute la signature du jeton de session admin"
```

---

### Tâche 2 : Auth — routes login/logout et middleware de garde

**Fichiers :**
- Créer : `src/lib/validations/admin.schema.ts`
- Créer : `src/app/api/admin/login/route.ts`
- Créer : `src/app/api/admin/logout/route.ts`
- Créer : `src/middleware.ts`

**Interfaces :**
- Consomme : `signSession`, `verifySession`, `ADMIN_COOKIE`, `constantTimeEqual` (tâche 1).
- Produit : cookie `admin_session` ; garde sur `/admin/*` et `/api/admin/*`.

- [ ] **Étape 1 : Créer le schéma Zod de connexion**

Créer `src/lib/validations/admin.schema.ts` :

```ts
import { z } from 'zod'

export const loginSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis.'),
})

export type LoginInput = z.infer<typeof loginSchema>
```

- [ ] **Étape 2 : Créer la route de connexion**

Créer `src/app/api/admin/login/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { loginSchema } from '@/lib/validations/admin.schema'
import { ADMIN_COOKIE, constantTimeEqual, signSession } from '@/lib/admin-auth'

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  const adminPassword = process.env.ADMIN_PASSWORD
  const secret = process.env.SESSION_SECRET
  if (!adminPassword || !secret) {
    return NextResponse.json(
      { error: 'server_misconfigured', message: 'ADMIN_PASSWORD ou SESSION_SECRET manquant.' },
      { status: 500 },
    )
  }

  // Comparaison à temps constant : ne pas révéler la longueur par le timing.
  if (!constantTimeEqual(parsed.data.password, adminPassword)) {
    return NextResponse.json({ error: 'invalid_credentials', message: 'Mot de passe incorrect.' }, { status: 401 })
  }

  const token = await signSession(secret)
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  })
  return response
}
```

- [ ] **Étape 3 : Créer la route de déconnexion**

Créer `src/app/api/admin/logout/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { ADMIN_COOKIE } from '@/lib/admin-auth'

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return response
}
```

- [ ] **Étape 4 : Créer le middleware de garde**

Créer `src/middleware.ts` :

```ts
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { ADMIN_COOKIE, verifySession } from '@/lib/admin-auth'

// Exemptés de la garde : la page et la route de connexion, sinon boucle.
const PUBLIC_PATHS = ['/admin/login', '/api/admin/login']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next()
  }

  const secret = process.env.SESSION_SECRET
  const token = request.cookies.get(ADMIN_COOKIE)?.value
  const valid = Boolean(secret) && (await verifySession(secret as string, token))

  if (valid) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized', message: 'Connexion admin requise.' }, { status: 401 })
  }

  const loginUrl = new URL('/admin/login', request.url)
  loginUrl.searchParams.set('from', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
}
```

- [ ] **Étape 5 : Vérifier manuellement la garde**

```bash
npm run dev
# Route API protégée sans cookie → 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin/invoices
# Login avec mauvais mot de passe → 401 (ADMIN_PASSWORD/SESSION_SECRET doivent être définis dans .env.local)
curl -s -w "\n%{http_code}\n" -X POST http://localhost:3000/api/admin/login -H 'Content-Type: application/json' -d '{"password":"faux"}'
```

Attendu : `401` pour la route protégée sans cookie ; `401 invalid_credentials` pour le mauvais mot de passe. (La route `/api/admin/invoices` n'existe pas encore : la garde renvoie 401 avant le 404, ce qui confirme l'ordre.)

- [ ] **Étape 6 : Vérifier types et lint**

Lancer : `npx tsc --noEmit && npm run lint`
Attendu : aucune erreur.

- [ ] **Étape 7 : Commit**

```bash
git add src/lib/validations/admin.schema.ts src/app/api/admin/login src/app/api/admin/logout src/middleware.ts
git commit -m "Ajoute les routes de connexion admin et le middleware de garde"
```

---

### Tâche 3 : Modèle `InvoiceImport` et type `InvoiceItem`

**Fichiers :**
- Créer : `src/models/InvoiceImport.ts`
- Test : `tests/models/invoice-import.test.ts`

**Interfaces :**
- Consomme : `withTestDatabase()` (`tests/helpers/db`, lot 1).
- Produit : modèle `InvoiceImport` ; types `InvoiceItem`, `InvoiceStatus = 'pending' | 'processing' | 'succeeded' | 'error'`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/models/invoice-import.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { InvoiceImport } from '@/models/InvoiceImport'

withTestDatabase()

const base = () => ({
  originalFileName: 'facture.pdf',
  pdfContent: Buffer.from('%PDF-1.4 test'),
  fileSize: 13,
})

describe('InvoiceImport', () => {
  it('applique les valeurs par défaut', async () => {
    const doc = await InvoiceImport.create(base())
    expect(doc.status).toBe('pending')
    expect(doc.items).toEqual([])
    expect(doc.azureOperationLocation).toBeNull()
    expect(doc.azureRawResult).toBeNull()
    expect(doc.errorMessage).toBeNull()
    expect(doc.validatedAt).toBeNull()
    expect(doc.azureModelId).toBe('prebuilt-invoice')
  })

  it('refuse un statut hors énumération', async () => {
    await expect(
      // @ts-expect-error statut hors énumération : rejet vérifié au runtime
      InvoiceImport.create({ ...base(), status: 'inconnu' }),
    ).rejects.toThrow(/status/)
  })

  it('conserve les InvoiceItem avec leurs null', async () => {
    const doc = await InvoiceImport.create({
      ...base(),
      items: [
        {
          supplierReference: 'REF-1',
          barcode: null,
          description: 'Chaise',
          quantity: 2,
          purchasePriceHT: 15.5,
          vatRate: null,
          lineTotalHT: 31,
        },
      ],
    })
    const stored = await InvoiceImport.findById(doc._id).lean()
    expect(stored!.items[0]).toMatchObject({ supplierReference: 'REF-1', barcode: null, vatRate: null })
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/models/invoice-import.test.ts`
Attendu : ÉCHEC — `Cannot find module '@/models/InvoiceImport'`.

- [ ] **Étape 3 : Implémenter le modèle**

Créer `src/models/InvoiceImport.ts` :

```ts
import { Schema, model, models, type InferSchemaType, type Model } from 'mongoose'

export const INVOICE_STATUSES = ['pending', 'processing', 'succeeded', 'error'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export type InvoiceItem = {
  supplierReference: string | null
  barcode: string | null
  description: string | null
  quantity: number | null
  purchasePriceHT: number | null
  vatRate: number | null
  lineTotalHT: number | null
}

// _id: false — les lignes sont un tableau de valeurs, pas des sous-documents
// adressables. null explicite : une donnée absente n'est jamais inventée.
const InvoiceItemSchema = new Schema<InvoiceItem>(
  {
    supplierReference: { type: String, default: null },
    barcode: { type: String, default: null },
    description: { type: String, default: null },
    quantity: { type: Number, default: null },
    purchasePriceHT: { type: Number, default: null },
    vatRate: { type: Number, default: null },
    lineTotalHT: { type: Number, default: null },
  },
  { _id: false },
)

const InvoiceImportSchema = new Schema(
  {
    originalFileName: { type: String, required: true },
    pdfContent: { type: Buffer, required: true },
    fileSize: { type: Number, required: true },
    status: { type: String, enum: INVOICE_STATUSES, default: 'pending' },
    azureModelId: { type: String, default: 'prebuilt-invoice' },
    azureOperationLocation: { type: String, default: null },
    azureRawResult: { type: Schema.Types.Mixed, default: null },
    items: { type: [InvoiceItemSchema], default: [] },
    errorMessage: { type: String, default: null },
    templateIdAtConversion: { type: Schema.Types.ObjectId, ref: 'CsvTemplate', default: null },
    validatedAt: { type: Date, default: null },
  },
  { timestamps: true },
)

export type InvoiceImportDoc = InferSchemaType<typeof InvoiceImportSchema>

export const InvoiceImport =
  (models.InvoiceImport as Model<InvoiceImportDoc>) ||
  model<InvoiceImportDoc>('InvoiceImport', InvoiceImportSchema)
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/models/invoice-import.test.ts`
Attendu : 3 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/models/InvoiceImport.ts tests/models/invoice-import.test.ts
git commit -m "Ajoute le modèle InvoiceImport et le type InvoiceItem"
```

---

### Tâche 4 : Validation des fichiers PDF

**Fichiers :**
- Créer : `src/lib/pdf-validation.ts`
- Test : `tests/lib/pdf-validation.test.ts`

**Interfaces :**
- Produit : `MAX_PDF_BYTES` ; `assertPdfFile(fileName: string, mimeType: string, size: number, header: Buffer): void` (lève une `Error` au refus).

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/lib/pdf-validation.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { assertPdfFile } from '@/lib/pdf-validation'

const PDF_HEADER = Buffer.from('%PDF-1.7\n')

describe('assertPdfFile', () => {
  it('accepte un PDF valide', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 1000, PDF_HEADER)).not.toThrow()
  })

  it('tolère application/octet-stream si les octets sont bien un PDF', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/octet-stream', 1000, PDF_HEADER)).not.toThrow()
  })

  it('refuse un fichier vide', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 0, PDF_HEADER)).toThrow(/vide/)
  })

  it('refuse une extension non PDF', () => {
    expect(() => assertPdfFile('facture.txt', 'application/pdf', 1000, PDF_HEADER)).toThrow(/PDF/)
  })

  it('refuse un type MIME image', () => {
    expect(() => assertPdfFile('facture.pdf', 'image/png', 1000, PDF_HEADER)).toThrow(/refusé/)
  })

  it('refuse un fichier trop volumineux', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 16 * 1024 * 1024, PDF_HEADER)).toThrow(/volumineux/)
  })

  it('refuse un fichier dont les octets ne commencent pas par %PDF-', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 1000, Buffer.from('PK\x03\x04'))).toThrow(/PDF/)
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/lib/pdf-validation.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le module**

Créer `src/lib/pdf-validation.ts` :

```ts
export const MAX_PDF_BYTES = Number(process.env.MAX_PDF_BYTES ?? 15 * 1024 * 1024)

// Les 5 premiers octets d'un PDF : « %PDF- ».
const PDF_MAGIC = Buffer.from('%PDF-')

export function assertPdfFile(
  fileName: string,
  mimeType: string,
  size: number,
  header: Buffer,
): void {
  if (size === 0) {
    throw new Error('Le fichier est vide.')
  }

  if (size > MAX_PDF_BYTES) {
    throw new Error(
      `Fichier trop volumineux : ${Math.round(size / 1024 / 1024)} Mo pour une limite de ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} Mo.`,
    )
  }

  if (!/\.pdf$/i.test(fileName)) {
    throw new Error('Le fichier doit être un PDF (extension .pdf attendue).')
  }

  // application/octet-stream toléré : certains navigateurs n'annoncent pas le
  // type. Le contrôle réel est celui des octets d'en-tête ci-dessous.
  const allowed = ['application/pdf', 'application/octet-stream']
  if (!allowed.includes(mimeType)) {
    throw new Error(`Type de fichier refusé : ${mimeType}. Un PDF est attendu.`)
  }

  // Garantie réelle du format, indépendante du nom et du type annoncé.
  if (!header.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new Error('Le contenu n’est pas un PDF (signature %PDF- absente).')
  }
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/lib/pdf-validation.test.ts`
Attendu : 7 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/lib/pdf-validation.ts tests/lib/pdf-validation.test.ts
git commit -m "Ajoute la validation des fichiers PDF"
```

---

### Tâche 5 : Normalisation Azure → `InvoiceItem[]`

**Fichiers :**
- Créer : `src/lib/azure-invoice-normalize.ts`
- Test : `tests/lib/azure-invoice-normalize.test.ts`

**Interfaces :**
- Consomme : type `InvoiceItem` (`@/models/InvoiceImport`).
- Produit : `normalizeAzureInvoice(analyzeResult: unknown): InvoiceItem[]`.

Le résultat `prebuilt-invoice` place les factures dans `documents[].fields.Items.valueArray[]`, chaque item ayant `valueObject.{ProductCode, Description, Quantity, UnitPrice, Amount, TaxRate}` où les montants sont `{ valueCurrency: { amount } }` ou `{ valueNumber }`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/lib/azure-invoice-normalize.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { normalizeAzureInvoice } from '@/lib/azure-invoice-normalize'

function resultWithItems(items: unknown[]) {
  return { documents: [{ fields: { Items: { valueArray: items } } }] }
}

describe('normalizeAzureInvoice', () => {
  it('projette les champs présents', () => {
    const result = resultWithItems([
      {
        valueObject: {
          ProductCode: { valueString: 'REF-1' },
          Description: { valueString: 'Chaise pliante' },
          Quantity: { valueNumber: 2 },
          UnitPrice: { valueCurrency: { amount: 15.5 } },
          Amount: { valueCurrency: { amount: 31 } },
          TaxRate: { valueString: '20%' },
        },
      },
    ])

    expect(normalizeAzureInvoice(result)).toEqual([
      {
        supplierReference: 'REF-1',
        barcode: null,
        description: 'Chaise pliante',
        quantity: 2,
        purchasePriceHT: 15.5,
        vatRate: 20,
        lineTotalHT: 31,
      },
    ])
  })

  it('met null pour tout champ absent, jamais 0', () => {
    const result = resultWithItems([{ valueObject: { Description: { valueString: 'Sans prix' } } }])
    expect(normalizeAzureInvoice(result)[0]).toEqual({
      supplierReference: null,
      barcode: null,
      description: 'Sans prix',
      quantity: null,
      purchasePriceHT: null,
      vatRate: null,
      lineTotalHT: null,
    })
  })

  it('ne déduit pas le taux de TVA depuis un montant de taxe', () => {
    // Tax fourni comme montant (pas TaxRate) : vatRate reste null.
    const result = resultWithItems([
      { valueObject: { Tax: { valueCurrency: { amount: 6.2 } }, Amount: { valueNumber: 31 } } },
    ])
    expect(normalizeAzureInvoice(result)[0].vatRate).toBeNull()
    expect(normalizeAzureInvoice(result)[0].lineTotalHT).toBe(31)
  })

  it('rend un tableau vide sans documents ni items', () => {
    expect(normalizeAzureInvoice({})).toEqual([])
    expect(normalizeAzureInvoice({ documents: [{ fields: {} }] })).toEqual([])
  })

  it('ignore une valeur numérique illisible (reste null)', () => {
    const result = resultWithItems([{ valueObject: { Quantity: { valueString: 'deux' } } }])
    expect(normalizeAzureInvoice(result)[0].quantity).toBeNull()
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/lib/azure-invoice-normalize.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le module**

Créer `src/lib/azure-invoice-normalize.ts` :

```ts
import type { InvoiceItem } from '@/models/InvoiceImport'

type AzureField = Record<string, unknown>

/** Lit une chaîne d'un champ Azure, ou null. */
function readString(field: unknown): string | null {
  if (!field || typeof field !== 'object') return null
  const value = (field as AzureField).valueString ?? (field as AzureField).content
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Lit un nombre d'un champ Azure (valueNumber, valueInteger ou montant), ou null. */
function readNumber(field: unknown): number | null {
  if (!field || typeof field !== 'object') return null
  const f = field as AzureField
  const candidates = [
    f.valueNumber,
    f.valueInteger,
    (f.valueCurrency as AzureField | undefined)?.amount,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  }
  return null
}

/** Lit un taux de TVA (« 20% », « 20 », 20) sans jamais l'inventer, ou null. */
function readRate(field: unknown): number | null {
  const direct = readNumber(field)
  if (direct !== null) return direct
  const text = readString(field)
  if (text === null) return null
  const match = text.replace(',', '.').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

export function normalizeAzureInvoice(analyzeResult: unknown): InvoiceItem[] {
  const result = analyzeResult as AzureField | null
  const documents = (result?.documents as AzureField[] | undefined) ?? []
  const items: InvoiceItem[] = []

  for (const document of documents) {
    const fields = (document?.fields as AzureField | undefined) ?? {}
    const array = ((fields.Items as AzureField | undefined)?.valueArray as AzureField[] | undefined) ?? []

    for (const entry of array) {
      const object = (entry?.valueObject as AzureField | undefined) ?? {}
      items.push({
        supplierReference: readString(object.ProductCode),
        // Le modèle facture n'expose pas de code-barres : jamais inventé.
        barcode: null,
        description: readString(object.Description),
        quantity: readNumber(object.Quantity),
        purchasePriceHT: readNumber(object.UnitPrice),
        // TaxRate uniquement : on ne déduit pas le taux d'un montant de taxe.
        vatRate: readRate(object.TaxRate),
        lineTotalHT: readNumber(object.Amount),
      })
    }
  }

  return items
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/lib/azure-invoice-normalize.test.ts`
Attendu : 5 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/lib/azure-invoice-normalize.ts tests/lib/azure-invoice-normalize.test.ts
git commit -m "Ajoute la normalisation des factures Azure en InvoiceItem"
```

---

### Tâche 6 : Conversion `InvoiceItem[]` → CSV ShopCaisse

**Fichiers :**
- Créer : `src/lib/invoice-to-csv.ts`
- Test : `tests/lib/invoice-to-csv.test.ts`

**Interfaces :**
- Consomme : `InvoiceItem` (`@/models/InvoiceImport`) ; `findColumn` (`@/lib/product-views`) ; `serializeCsvValue` (`@/services/catalog-export.service`) ; `NO_ACTIVE_TEMPLATE_MESSAGE` (`@/lib/messages`).
- Produit : `type CsvTemplateShape = { columns: { name: string; position: number }[]; delimiter: string }` ; `invoiceItemsToCsv(items: InvoiceItem[], template: CsvTemplateShape | null, options?: { bom?: boolean }): string`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/lib/invoice-to-csv.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { invoiceItemsToCsv } from '@/lib/invoice-to-csv'
import type { InvoiceItem } from '@/models/InvoiceImport'

const template = {
  delimiter: ';',
  columns: [
    { name: 'Référence', position: 0 },
    { name: 'Nom', position: 1 },
    { name: 'Prix d’achat', position: 2 },
    { name: 'Famille', position: 3 },
  ],
}

const item = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  supplierReference: 'REF-1',
  barcode: null,
  description: 'Chaise',
  quantity: 2,
  purchasePriceHT: 15.5,
  vatRate: null,
  lineTotalHT: 31,
  ...over,
})

describe('invoiceItemsToCsv', () => {
  it('respecte colonnes, ordre et séparateur du template', () => {
    const csv = invoiceItemsToCsv([item()], template, { bom: false })
    // Famille n'est mappée à aucun champ InvoiceItem → cellule vide.
    expect(csv).toBe('Référence;Nom;Prix d’achat;Famille\r\nREF-1;Chaise;15.5;\r\n')
  })

  it('laisse une cellule vide quand la valeur est null', () => {
    const csv = invoiceItemsToCsv([item({ purchasePriceHT: null })], template, { bom: false })
    expect(csv).toBe('Référence;Nom;Prix d’achat;Famille\r\nREF-1;Chaise;;\r\n')
  })

  it('ajoute le BOM par défaut', () => {
    expect(invoiceItemsToCsv([item()], template).startsWith('﻿')).toBe(true)
  })

  it('échoue explicitement sans template actif', () => {
    expect(() => invoiceItemsToCsv([item()], null)).toThrow(/Aucun template CSV actif/)
  })

  it('rend un CSV avec seulement l’en-tête si aucune ligne', () => {
    expect(invoiceItemsToCsv([], template, { bom: false })).toBe('Référence;Nom;Prix d’achat;Famille\r\n')
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/lib/invoice-to-csv.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le module**

Créer `src/lib/invoice-to-csv.ts` :

```ts
import type { InvoiceItem } from '@/models/InvoiceImport'
import { findColumn } from '@/lib/product-views'
import { serializeCsvValue } from '@/services/catalog-export.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export type CsvTemplateShape = {
  columns: { name: string; position: number }[]
  delimiter: string
}

// Alias stricts, réutilisant la détection du lot 1. `findColumn` compare des
// colonnes NORMALISÉES par `normalizeHeader` (accents retirés, minuscules, toute
// ponctuation → espace) : les alias doivent donc être écrits sous cette forme
// normalisée. Ex. la colonne « Prix d'achat » se normalise en « prix d achat »,
// d'où l'alias `prix d achat`. « famille », « rang » n'ont aucun alias ici :
// ces colonnes resteront vides — on ne les invente pas.
const FIELD_ALIASES: Record<keyof InvoiceItem, string[]> = {
  supplierReference: ['reference', 'ref', 'code article', 'sku', 'code produit'],
  barcode: ['code barre', 'code barres', 'codebarre', 'ean', 'ean13', 'gencod', 'gencode'],
  description: ['nom', 'designation', 'libelle', 'description'],
  quantity: ['quantite', 'qte', 'stock'],
  purchasePriceHT: ['prix d achat', 'prix achat', 'prix achat ht', 'prix ht', 'cout', 'achat'],
  vatRate: ['tva', 'taux tva', 'taux de tva'],
  lineTotalHT: ['total ht', 'montant ht', 'total'],
}

/** Colonne du template associée à chaque champ InvoiceItem (ou '' si absente). */
function buildFieldToColumn(columnNames: string[]): Partial<Record<keyof InvoiceItem, string>> {
  const mapping: Partial<Record<keyof InvoiceItem, string>> = {}
  for (const field of Object.keys(FIELD_ALIASES) as (keyof InvoiceItem)[]) {
    const column = findColumn(columnNames, FIELD_ALIASES[field])
    if (column) mapping[field] = column
  }
  return mapping
}

export function invoiceItemsToCsv(
  items: InvoiceItem[],
  template: CsvTemplateShape | null,
  options: { bom?: boolean } = {},
): string {
  if (!template) throw new Error(NO_ACTIVE_TEMPLATE_MESSAGE)

  const columns = [...template.columns].sort((a, b) => a.position - b.position).map((c) => c.name)
  const delimiter = template.delimiter || ';'
  const fieldToColumn = buildFieldToColumn(columns)

  // Colonne → champ InvoiceItem (inverse), pour remplir chaque cellule.
  const columnToField = new Map<string, keyof InvoiceItem>()
  for (const [field, column] of Object.entries(fieldToColumn) as [keyof InvoiceItem, string][]) {
    columnToField.set(column, field)
  }

  const lines = [columns.map((c) => serializeCsvValue(c, delimiter)).join(delimiter)]

  for (const item of items) {
    lines.push(
      columns
        .map((column) => {
          const field = columnToField.get(column)
          // Colonne non mappée, ou valeur null → cellule vide. Jamais inventée.
          const value = field ? item[field] : null
          return serializeCsvValue(value, delimiter)
        })
        .join(delimiter),
    )
  }

  const csv = `${lines.join('\r\n')}\r\n`
  return options.bom === false ? csv : `﻿${csv}`
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/lib/invoice-to-csv.test.ts`
Attendu : 5 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/lib/invoice-to-csv.ts tests/lib/invoice-to-csv.test.ts
git commit -m "Ajoute la conversion des lignes de facture en CSV ShopCaisse"
```

---

### Tâche 7 : Service Azure — soumission et polling

**Fichiers :**
- Modifier : `package.json` (dépendance `@azure-rest/ai-document-intelligence`)
- Créer : `src/services/azure-invoice.service.ts`
- Test : `tests/services/azure-invoice.service.test.ts`

**Interfaces :**
- Produit : `beginInvoiceAnalysis(pdf: Buffer): Promise<{ operationLocation: string }>` ; `pollInvoiceAnalysis(operationLocation: string): Promise<{ status: 'running' | 'succeeded' | 'failed'; result?: unknown; error?: string }>`.

Ces deux fonctions encapsulent tout l'accès réseau Azure. Elles lisent l'endpoint et la clé dans l'environnement à l'appel (pas au chargement). Les tests remplacent `globalThis.fetch` par un mock — aucune clé requise.

- [ ] **Étape 1 : Installer la dépendance**

```bash
npm install @azure-rest/ai-document-intelligence
```

- [ ] **Étape 2 : Écrire le test qui échoue**

Créer `tests/services/azure-invoice.service.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginInvoiceAnalysis, pollInvoiceAnalysis } from '@/services/azure-invoice.service'

const ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('beginInvoiceAnalysis', () => {
  it('poste le PDF et renvoie l’operation-location', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = 'https://exemple.cognitiveservices.azure.com/'
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'

    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      ok: true,
      headers: new Headers({ 'operation-location': 'https://exemple/operations/123' }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { operationLocation } = await beginInvoiceAnalysis(Buffer.from('%PDF-1.4'))
    expect(operationLocation).toBe('https://exemple/operations/123')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('échoue clairement sans configuration Azure', async () => {
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
    await expect(beginInvoiceAnalysis(Buffer.from('%PDF-1.4'))).rejects.toThrow(/AZURE_DOCUMENT_INTELLIGENCE/)
  })
})

describe('pollInvoiceAnalysis', () => {
  it('rend running tant qu’Azure travaille', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'running' }) }),
    )
    expect((await pollInvoiceAnalysis('https://exemple/op/1')).status).toBe('running')
  })

  it('rend succeeded avec le résultat', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'succeeded', analyzeResult: { documents: [] } }),
      }),
    )
    const outcome = await pollInvoiceAnalysis('https://exemple/op/1')
    expect(outcome.status).toBe('succeeded')
    expect(outcome.result).toEqual({ documents: [] })
  })

  it('rend failed avec un message', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'failed', error: { message: 'document illisible' } }),
      }),
    )
    const outcome = await pollInvoiceAnalysis('https://exemple/op/1')
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toMatch(/illisible/)
  })
})
```

- [ ] **Étape 3 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/azure-invoice.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 4 : Implémenter le service**

Créer `src/services/azure-invoice.service.ts` :

```ts
const API_VERSION = '2024-11-30'
const MODEL_ID = 'prebuilt-invoice'

function azureConfig(): { endpoint: string; key: string } {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  if (!endpoint || !key) {
    throw new Error(
      'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ou AZURE_DOCUMENT_INTELLIGENCE_KEY manquant.',
    )
  }
  return { endpoint: endpoint.replace(/\/$/, ''), key }
}

/**
 * Soumet le PDF au modèle prebuilt-invoice et renvoie l'operation-location à
 * sonder. Requête courte : Azure répond 202 immédiatement.
 */
export async function beginInvoiceAnalysis(pdf: Buffer): Promise<{ operationLocation: string }> {
  const { endpoint, key } = azureConfig()
  const url = `${endpoint}/documentintelligence/documentModels/${MODEL_ID}:analyze?api-version=${API_VERSION}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'Ocp-Apim-Subscription-Key': key },
    body: new Uint8Array(pdf),
  })

  const operationLocation = response.headers.get('operation-location')
  if (!response.ok || !operationLocation) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Azure a refusé l’analyse (${response.status}). ${detail}`.trim())
  }

  return { operationLocation }
}

/** Sonde une fois l'opération. Ne bloque pas : l'appelant réinterroge. */
export async function pollInvoiceAnalysis(
  operationLocation: string,
): Promise<{ status: 'running' | 'succeeded' | 'failed'; result?: unknown; error?: string }> {
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  if (!key) {
    throw new Error('AZURE_DOCUMENT_INTELLIGENCE_KEY manquant.')
  }

  const response = await fetch(operationLocation, {
    headers: { 'Ocp-Apim-Subscription-Key': key },
  })
  if (!response.ok) {
    return { status: 'failed', error: `Azure a renvoyé ${response.status} au sondage.` }
  }

  const body = (await response.json()) as {
    status?: string
    analyzeResult?: unknown
    error?: { message?: string }
  }

  if (body.status === 'succeeded') return { status: 'succeeded', result: body.analyzeResult }
  if (body.status === 'failed') {
    return { status: 'failed', error: body.error?.message ?? 'Analyse Azure échouée.' }
  }
  return { status: 'running' }
}
```

- [ ] **Étape 5 : Vérifier le succès**

Lancer : `npx vitest run tests/services/azure-invoice.service.test.ts`
Attendu : 5 tests PASS.

- [ ] **Étape 6 : Commit**

```bash
git add package.json package-lock.json src/services/azure-invoice.service.ts tests/services/azure-invoice.service.test.ts
git commit -m "Ajoute le service Azure d'analyse de factures (soumission et polling)"
```

---

### Tâche 8 : Service d'import de factures — orchestration

**Fichiers :**
- Créer : `src/services/invoice-import.service.ts`
- Test : `tests/services/invoice-import.service.test.ts`

**Interfaces :**
- Consomme : `InvoiceImport`, `InvoiceItem` (tâche 3) ; `assertPdfFile` (tâche 4) ; `normalizeAzureInvoice` (tâche 5) ; `invoiceItemsToCsv`, `CsvTemplateShape` (tâche 6) ; `beginInvoiceAnalysis`, `pollInvoiceAnalysis` (tâche 7) ; `getActiveTemplate` (`@/services/csv-template.service`) ; `connectToDatabase` (`@/lib/mongodb`).
- Produit : `createInvoiceImport(input)` ; `startAnalysis(id)` ; `refreshAnalysis(id)` ; `listInvoiceImports()` ; `getInvoiceImport(id)` ; `updateInvoiceItems(id, items)` ; `validateInvoice(id)` ; `deleteInvoiceImport(id)` ; `exportInvoiceCsv(id, options?)`. Signatures exactes dans le code ci-dessous.

Le service isole `beginInvoiceAnalysis`/`pollInvoiceAnalysis` via des imports de module, ce qui permet aux tests de les `vi.mock`.

- [ ] **Étape 1 : Écrire le test qui échoue**

Créer `tests/services/invoice-import.service.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { InvoiceImport } from '@/models/InvoiceImport'
import { CsvTemplate } from '@/models/CsvTemplate'

vi.mock('@/services/azure-invoice.service', () => ({
  beginInvoiceAnalysis: vi.fn(),
  pollInvoiceAnalysis: vi.fn(),
}))

import { beginInvoiceAnalysis, pollInvoiceAnalysis } from '@/services/azure-invoice.service'
import {
  createInvoiceImport,
  startAnalysis,
  refreshAnalysis,
  updateInvoiceItems,
  validateInvoice,
  deleteInvoiceImport,
  exportInvoiceCsv,
} from '@/services/invoice-import.service'

withTestDatabase()

const PDF = () => Buffer.from('%PDF-1.4\nfacture', 'utf-8')

afterEach(() => vi.clearAllMocks())

async function makeActiveTemplate() {
  return CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    isActive: true,
    delimiter: ';',
    columns: [
      { name: 'Référence', position: 0, detectedType: 'string' },
      { name: 'Nom', position: 1, detectedType: 'string' },
    ],
  })
}

describe('createInvoiceImport', () => {
  it('stocke le PDF et le statut pending', async () => {
    const result = await createInvoiceImport({
      buffer: PDF(),
      originalFileName: 'facture.pdf',
      mimeType: 'application/pdf',
    })
    const doc = await InvoiceImport.findById(result.invoiceId)
    expect(doc!.status).toBe('pending')
    expect(Buffer.from(doc!.pdfContent).equals(PDF())).toBe(true)
  })

  it('refuse un fichier non PDF', async () => {
    await expect(
      createInvoiceImport({ buffer: Buffer.from('PK\x03\x04'), originalFileName: 'x.pdf', mimeType: 'application/pdf' }),
    ).rejects.toThrow(/PDF/)
  })
})

describe('analyse', () => {
  it('startAnalysis pose processing et l’operation-location', async () => {
    vi.mocked(beginInvoiceAnalysis).mockResolvedValue({ operationLocation: 'https://op/1' })
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })

    await startAnalysis(invoiceId)

    const doc = await InvoiceImport.findById(invoiceId)
    expect(doc!.status).toBe('processing')
    expect(doc!.azureOperationLocation).toBe('https://op/1')
  })

  it('refreshAnalysis succeeded normalise et fige les items', async () => {
    vi.mocked(beginInvoiceAnalysis).mockResolvedValue({ operationLocation: 'https://op/1' })
    vi.mocked(pollInvoiceAnalysis).mockResolvedValue({
      status: 'succeeded',
      result: {
        documents: [
          { fields: { Items: { valueArray: [{ valueObject: { Description: { valueString: 'Chaise' } } }] } } },
        ],
      },
    })
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await startAnalysis(invoiceId)

    const doc = await refreshAnalysis(invoiceId)

    expect(doc.status).toBe('succeeded')
    expect(doc.items).toHaveLength(1)
    expect(doc.items[0].description).toBe('Chaise')
  })

  it('refreshAnalysis failed pose error et le message', async () => {
    vi.mocked(beginInvoiceAnalysis).mockResolvedValue({ operationLocation: 'https://op/1' })
    vi.mocked(pollInvoiceAnalysis).mockResolvedValue({ status: 'failed', error: 'illisible' })
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await startAnalysis(invoiceId)

    const doc = await refreshAnalysis(invoiceId)
    expect(doc.status).toBe('error')
    expect(doc.errorMessage).toMatch(/illisible/)
  })
})

describe('correction et validation', () => {
  const oneItem = [
    { supplierReference: 'R1', barcode: null, description: 'Chaise', quantity: 1, purchasePriceHT: 10, vatRate: null, lineTotalHT: 10 },
  ]

  it('updateInvoiceItems remplace les lignes', async () => {
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await updateInvoiceItems(invoiceId, oneItem)
    const doc = await InvoiceImport.findById(invoiceId)
    expect(doc!.items[0].supplierReference).toBe('R1')
  })

  it('validateInvoice verrouille l’édition', async () => {
    await makeActiveTemplate()
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await updateInvoiceItems(invoiceId, oneItem)
    await validateInvoice(invoiceId)

    const doc = await InvoiceImport.findById(invoiceId)
    expect(doc!.validatedAt).not.toBeNull()
    await expect(updateInvoiceItems(invoiceId, oneItem)).rejects.toThrow(/validée/)
  })

  it('startAnalysis refuse une facture validée', async () => {
    await makeActiveTemplate()
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await validateInvoice(invoiceId)
    await expect(startAnalysis(invoiceId)).rejects.toThrow(/validée/)
  })
})

describe('export et suppression', () => {
  it('exportInvoiceCsv rend un CSV au format du template actif', async () => {
    await makeActiveTemplate()
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'facture.pdf', mimeType: 'application/pdf' })
    await updateInvoiceItems(invoiceId, [
      { supplierReference: 'R1', barcode: null, description: 'Chaise', quantity: 1, purchasePriceHT: 10, vatRate: null, lineTotalHT: 10 },
    ])

    const { csv, fileName } = await exportInvoiceCsv(invoiceId, { bom: false })
    expect(csv).toBe('Référence;Nom\r\nR1;Chaise\r\n')
    expect(fileName).toMatch(/\.csv$/)
  })

  it('deleteInvoiceImport supprime le document', async () => {
    const { invoiceId } = await createInvoiceImport({ buffer: PDF(), originalFileName: 'f.pdf', mimeType: 'application/pdf' })
    await deleteInvoiceImport(invoiceId)
    expect(await InvoiceImport.findById(invoiceId)).toBeNull()
  })
})
```

- [ ] **Étape 2 : Vérifier l'échec**

Lancer : `npx vitest run tests/services/invoice-import.service.test.ts`
Attendu : ÉCHEC — module introuvable.

- [ ] **Étape 3 : Implémenter le service**

Créer `src/services/invoice-import.service.ts` :

```ts
import { isValidObjectId } from 'mongoose'
import { basename } from 'node:path'
import { connectToDatabase } from '@/lib/mongodb'
import { InvoiceImport, type InvoiceItem, type InvoiceImportDoc } from '@/models/InvoiceImport'
import { assertPdfFile } from '@/lib/pdf-validation'
import { normalizeAzureInvoice } from '@/lib/azure-invoice-normalize'
import { invoiceItemsToCsv, type CsvTemplateShape } from '@/lib/invoice-to-csv'
import { getActiveTemplate } from '@/services/csv-template.service'
import { beginInvoiceAnalysis, pollInvoiceAnalysis } from '@/services/azure-invoice.service'

export interface InvoiceImportResult {
  invoiceId: string
  status: InvoiceImportDoc['status']
}

function assertId(id: string): void {
  if (!isValidObjectId(id)) throw new Error('Identifiant de facture invalide.')
}

async function requireInvoice(id: string) {
  assertId(id)
  await connectToDatabase()
  const doc = await InvoiceImport.findById(id)
  if (!doc) throw new Error('Facture introuvable.')
  return doc
}

export async function createInvoiceImport(input: {
  buffer: Buffer
  originalFileName: string
  mimeType: string
}): Promise<InvoiceImportResult> {
  const safeName = basename(input.originalFileName)
  assertPdfFile(safeName, input.mimeType, input.buffer.byteLength, input.buffer.subarray(0, 5))

  await connectToDatabase()
  const doc = await InvoiceImport.create({
    originalFileName: safeName,
    pdfContent: input.buffer,
    fileSize: input.buffer.byteLength,
    status: 'pending',
  })

  return { invoiceId: String(doc._id), status: doc.status }
}

/** Soumet à Azure et passe en processing. Relançable depuis error/succeeded. */
export async function startAnalysis(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  if (doc.validatedAt) throw new Error('Facture validée : édition verrouillée.')
  const { operationLocation } = await beginInvoiceAnalysis(Buffer.from(doc.pdfContent))

  doc.status = 'processing'
  doc.azureOperationLocation = operationLocation
  doc.errorMessage = null
  await doc.save()
  return doc.toObject()
}

/** Sonde Azure une fois et fait avancer le statut. */
export async function refreshAnalysis(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)

  if (doc.status !== 'processing' || !doc.azureOperationLocation) {
    return doc.toObject()
  }

  const outcome = await pollInvoiceAnalysis(doc.azureOperationLocation)

  if (outcome.status === 'succeeded') {
    doc.azureRawResult = outcome.result ?? null
    doc.set('items', normalizeAzureInvoice(outcome.result))
    doc.status = 'succeeded'
    doc.errorMessage = null
  } else if (outcome.status === 'failed') {
    doc.status = 'error'
    doc.errorMessage = outcome.error ?? 'Analyse Azure échouée.'
  }

  await doc.save()
  return doc.toObject()
}

export async function listInvoiceImports(): Promise<
  Array<Pick<InvoiceImportDoc, 'originalFileName' | 'status' | 'createdAt' | 'validatedAt'> & { id: string; itemCount: number }>
> {
  await connectToDatabase()
  const docs = await InvoiceImport.find({})
    .select('originalFileName status createdAt validatedAt items')
    .sort({ createdAt: -1 })
    .lean()

  return docs.map((doc) => ({
    id: String(doc._id),
    originalFileName: doc.originalFileName,
    status: doc.status,
    createdAt: doc.createdAt,
    validatedAt: doc.validatedAt,
    itemCount: doc.items?.length ?? 0,
  }))
}

/** Détail complet sans les octets PDF ni le JSON Azure brut (lourds). */
export async function getInvoiceImport(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  const object = doc.toObject()
  return { ...object, pdfContent: undefined as never, azureRawResult: undefined as never }
}

export async function updateInvoiceItems(id: string, items: InvoiceItem[]): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  if (doc.validatedAt) throw new Error('Facture validée : édition verrouillée.')
  doc.set('items', items)
  await doc.save()
  return doc.toObject()
}

export async function validateInvoice(id: string): Promise<InvoiceImportDoc> {
  const doc = await requireInvoice(id)
  const template = await getActiveTemplate()
  doc.validatedAt = new Date()
  doc.templateIdAtConversion = template?._id ?? null
  await doc.save()
  return doc.toObject()
}

export async function deleteInvoiceImport(id: string): Promise<void> {
  assertId(id)
  await connectToDatabase()
  await InvoiceImport.findByIdAndDelete(id)
}

export async function exportInvoiceCsv(
  id: string,
  options: { bom?: boolean } = {},
): Promise<{ csv: string; fileName: string }> {
  const doc = await requireInvoice(id)
  const template = (await getActiveTemplate()) as unknown as CsvTemplateShape | null

  const csv = invoiceItemsToCsv(doc.items, template, options)
  const base = doc.originalFileName.replace(/\.pdf$/i, '')
  return { csv, fileName: `facture-${base}-${new Date().toISOString().slice(0, 10)}.csv` }
}
```

- [ ] **Étape 4 : Vérifier le succès**

Lancer : `npx vitest run tests/services/invoice-import.service.test.ts`
Attendu : 9 tests PASS.

- [ ] **Étape 5 : Commit**

```bash
git add src/services/invoice-import.service.ts tests/services/invoice-import.service.test.ts
git commit -m "Ajoute le service d'orchestration des imports de factures"
```

---

### Tâche 9 : Routes API des factures

**Fichiers :**
- Créer : `src/lib/validations/invoice.schema.ts`
- Créer : `src/app/api/admin/invoices/route.ts`
- Créer : `src/app/api/admin/invoices/[invoiceId]/route.ts`
- Créer : `src/app/api/admin/invoices/[invoiceId]/analyze/route.ts`
- Créer : `src/app/api/admin/invoices/[invoiceId]/items/route.ts`
- Créer : `src/app/api/admin/invoices/[invoiceId]/validate/route.ts`
- Créer : `src/app/api/admin/invoices/[invoiceId]/export/route.ts`

**Interfaces :**
- Consomme : toutes les fonctions du service (tâche 8) ; garde middleware (tâche 2).

- [ ] **Étape 1 : Créer le schéma Zod des lignes**

Créer `src/lib/validations/invoice.schema.ts` :

```ts
import { z } from 'zod'

const nullableString = z.string().trim().min(1).nullable()
const nullableNumber = z.number().finite().nullable()

export const invoiceItemSchema = z.object({
  supplierReference: nullableString,
  barcode: nullableString,
  description: nullableString,
  quantity: nullableNumber,
  purchasePriceHT: nullableNumber,
  vatRate: nullableNumber,
  lineTotalHT: nullableNumber,
})

export const updateItemsSchema = z.object({
  items: z.array(invoiceItemSchema),
})

export type UpdateItemsInput = z.infer<typeof updateItemsSchema>
```

- [ ] **Étape 2 : Créer la route liste + upload**

Créer `src/app/api/admin/invoices/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { csvUploadSchema } from '@/lib/validations/csv-template.schema'
import { createInvoiceImport, listInvoiceImports, startAnalysis } from '@/services/invoice-import.service'

export async function GET() {
  try {
    return NextResponse.json({ invoices: await listInvoiceImports() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const parsed = csvUploadSchema.safeParse(Object.fromEntries(formData))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'missing_file', message: 'Aucun fichier reçu sous la clé « file ».' },
        { status: 400 },
      )
    }

    const { file } = parsed.data
    const result = await createInvoiceImport({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalFileName: file.name,
      mimeType: file.type || 'application/octet-stream',
    })

    // Lance l'analyse dès l'import ; le client suivra le statut via GET.
    await startAnalysis(result.invoiceId).catch(() => undefined)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import impossible.'
    return NextResponse.json({ error: 'invoice_import_failed', message }, { status: 400 })
  }
}
```

Note : `csvUploadSchema` (lot 1, `@/lib/validations/csv-template.schema`) valide seulement « une clé `file` de type `File` » — réutilisable tel quel pour le PDF ; le contrôle du format PDF est fait par `assertPdfFile` dans le service.

- [ ] **Étape 3 : Créer la route détail + suppression**

Créer `src/app/api/admin/invoices/[invoiceId]/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { deleteInvoiceImport, getInvoiceImport, refreshAnalysis } from '@/services/invoice-import.service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    // Fait avancer l'analyse si elle est en cours (un sondage Azure par appel).
    await refreshAnalysis(invoiceId).catch(() => undefined)
    return NextResponse.json({ invoice: await getInvoiceImport(invoiceId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 500
    return NextResponse.json({ error: 'invoice_read_failed', message }, { status })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    await deleteInvoiceImport(invoiceId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suppression impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'invoice_delete_failed', message }, { status })
  }
}
```

- [ ] **Étape 4 : Créer la route d'analyse (relance)**

Créer `src/app/api/admin/invoices/[invoiceId]/analyze/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { startAnalysis } from '@/services/invoice-import.service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const doc = await startAnalysis(invoiceId)
    return NextResponse.json({ status: doc.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analyse impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'analyze_failed', message }, { status })
  }
}
```

- [ ] **Étape 5 : Créer la route de mise à jour des lignes**

Créer `src/app/api/admin/invoices/[invoiceId]/items/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { updateItemsSchema } from '@/lib/validations/invoice.schema'
import { updateInvoiceItems } from '@/services/invoice-import.service'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  const parsed = updateItemsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const doc = await updateInvoiceItems(invoiceId, parsed.data.items)
    return NextResponse.json({ items: doc.items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mise à jour impossible.'
    const status = /verrouillée|validée/.test(message) ? 409 : /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'items_update_failed', message }, { status })
  }
}
```

- [ ] **Étape 6 : Créer la route de validation**

Créer `src/app/api/admin/invoices/[invoiceId]/validate/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { validateInvoice } from '@/services/invoice-import.service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const doc = await validateInvoice(invoiceId)
    return NextResponse.json({ validatedAt: doc.validatedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'validate_failed', message }, { status })
  }
}
```

- [ ] **Étape 7 : Créer la route d'export CSV**

Créer `src/app/api/admin/invoices/[invoiceId]/export/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { exportInvoiceCsv } from '@/services/invoice-import.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const { csv, fileName } = await exportInvoiceCsv(invoiceId)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export impossible.'
    const status = message === NO_ACTIVE_TEMPLATE_MESSAGE ? 409 : /introuvable|invalide/.test(message) ? 404 : 500
    return NextResponse.json({ error: 'export_failed', message }, { status })
  }
}
```

- [ ] **Étape 8 : Vérifier types, lint et suite**

Lancer : `npx tsc --noEmit && npm run lint && npx vitest run`
Attendu : aucune erreur ; tous les tests PASS.

- [ ] **Étape 9 : Commit**

```bash
git add src/lib/validations/invoice.schema.ts src/app/api/admin/invoices
git commit -m "Ajoute les routes API d'import, analyse, correction, validation et export de factures"
```

---

### Tâche 10 : Coquille admin — layout, menu latéral, page de connexion

**Fichiers :**
- Créer : `src/components/admin/AdminSidebar.tsx`
- Créer : `src/app/admin/layout.tsx`
- Créer : `src/app/admin/login/page.tsx`

**Interfaces :**
- Consomme : `POST /api/admin/login`, `POST /api/admin/logout` (tâche 2).

- [ ] **Étape 1 : Créer le menu latéral dynamique**

Créer `src/components/admin/AdminSidebar.tsx` :

```tsx
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { FileSpreadsheet, FileText, LogOut } from 'lucide-react'

const ITEMS = [
  { href: '/admin/csv-template', label: 'Import CSV', icon: FileSpreadsheet },
  { href: '/admin/invoices', label: 'Import facture', icon: FileText },
]

export function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
      <div className="mb-6 px-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Administration
      </div>
      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>
      <button
        type="button"
        onClick={logout}
        className="mt-4 flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
      >
        <LogOut className="h-4 w-4" />
        Déconnexion
      </button>
    </aside>
  )
}
```

- [ ] **Étape 2 : Créer le layout admin**

Créer `src/app/admin/layout.tsx` :

```tsx
import { AdminSidebar } from '@/components/admin/AdminSidebar'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <AdminSidebar />
      <div className="flex-1 overflow-x-auto p-6 md:p-8">{children}</div>
    </div>
  )
}
```

Note : la page `/admin/login` appartient au segment `/admin` et hérite donc de ce layout. Pour éviter d'afficher le menu sur la page de connexion, la page login rend son propre plein écran ; le menu reste visible mais inerte tant qu'on n'est pas connecté. **Décision :** garder simple — le menu est affiché ; les liens mènent à des pages protégées qui redirigent vers login tant que non connecté. Aucun secret n'est exposé (le menu est statique).

- [ ] **Étape 3 : Créer la page de connexion**

Créer `src/app/admin/login/page.tsx` :

```tsx
'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message ?? 'Connexion impossible.')
      }
      router.push(params.get('from') ?? '/admin/csv-template')
      router.refresh()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Connexion impossible.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
      <h1 className="text-lg font-semibold text-slate-900">Espace administrateur</h1>
      <label className="mt-6 block text-sm font-medium text-slate-700">Mot de passe</label>
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
        autoFocus
      />
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        Se connecter
      </button>
    </form>
  )
}

export default function AdminLoginPage() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  )
}
```

- [ ] **Étape 4 : Vérifier types, lint et build**

Lancer : `npx tsc --noEmit && npm run lint && npm run build`
Attendu : aucune erreur ; build réussi.

- [ ] **Étape 5 : Vérifier à l'écran**

Avec `ADMIN_PASSWORD` et `SESSION_SECRET` dans `.env.local` :

```bash
npm run dev
```

Ouvrir `http://localhost:3000/admin/csv-template` → redirection vers `/admin/login`. Se connecter → accès à l'espace admin avec le menu latéral.

- [ ] **Étape 6 : Commit**

```bash
git add src/components/admin src/app/admin/layout.tsx src/app/admin/login
git commit -m "Ajoute la coquille admin, le menu latéral et la page de connexion"
```

---

### Tâche 11 : Page `/admin/csv-template`

**Fichiers :**
- Créer : `src/app/api/admin/csv-imports/route.ts`
- Créer : `src/components/admin/CsvTemplateManager.tsx`
- Créer : `src/app/admin/csv-template/page.tsx`

**Interfaces :**
- Consomme : `listCsvImports` (nouveau, ci-dessous) ; routes lot 1 `POST /api/csv-imports`, `POST /api/csv-templates/from-import`, `GET /api/csv-templates/active`.
- Produit : `GET /api/admin/csv-imports` — liste des imports CSV avec date.

- [ ] **Étape 1 : Créer la route de liste des imports CSV (sous garde admin)**

Créer `src/app/api/admin/csv-imports/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/mongodb'
import { CsvImport } from '@/models/CsvImport'

export async function GET() {
  try {
    await connectToDatabase()
    const docs = await CsvImport.find({})
      .select('originalFileName columns rowCount encoding delimiter createdAt')
      .sort({ createdAt: -1 })
      .lean()

    return NextResponse.json({
      imports: docs.map((doc) => ({
        id: String(doc._id),
        originalFileName: doc.originalFileName,
        columnCount: doc.columns?.length ?? 0,
        rowCount: doc.rowCount,
        delimiter: doc.delimiter,
        encoding: doc.encoding,
        createdAt: doc.createdAt,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}
```

- [ ] **Étape 2 : Créer le composant de gestion**

Créer `src/components/admin/CsvTemplateManager.tsx` :

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Upload } from 'lucide-react'

interface CsvImportRow {
  id: string
  originalFileName: string
  columnCount: number
  rowCount: number
  delimiter: string
  createdAt: string
}

export function CsvTemplateManager() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [imports, setImports] = useState<CsvImportRow[]>([])
  const [activeName, setActiveName] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function refresh() {
    const [list, active] = await Promise.all([
      fetch('/api/admin/csv-imports').then((response) => response.json()),
      fetch('/api/csv-templates/active').then((response) => (response.ok ? response.json() : null)),
    ])
    setImports(list.imports ?? [])
    setActiveName(active?.template?.name ?? null)
  }

  useEffect(() => {
    // setTimeout(…,0) : diffère l'appel hors du corps synchrone de l'effet (convention csv-editor, règle set-state-in-effect)
    const timer = window.setTimeout(() => {
      refresh().catch(() => setError('Chargement impossible.'))
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  async function importCsv(file: File) {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const uploaded = await fetch('/api/csv-imports', { method: 'POST', body: formData }).then((r) => r.json())
      if (!uploaded.importId) throw new Error(uploaded.message ?? 'Import impossible.')

      const activated = await fetch('/api/csv-templates/from-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ importId: uploaded.importId }),
      }).then((r) => r.json())
      if (!activated.templateId) throw new Error(activated.message ?? 'Activation impossible.')

      setMessage('Template CSV importé et activé.')
      await refresh()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import impossible.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Templates CSV</h1>
          <p className="mt-1 text-sm text-slate-600">
            Template actif : <strong>{activeName ?? 'aucun'}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          Importer un CSV
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importCsv(file)
          }}
        />
      </div>

      {message && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Fichier</th>
              <th className="px-4 py-3 font-medium">Colonnes</th>
              <th className="px-4 py-3 font-medium">Lignes</th>
              <th className="px-4 py-3 font-medium">Date d’import</th>
            </tr>
          </thead>
          <tbody>
            {imports.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-slate-500">
                  Aucun import CSV.
                </td>
              </tr>
            ) : (
              imports.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-2 text-slate-800">{row.originalFileName}</td>
                  <td className="px-4 py-2 text-slate-700">{row.columnCount}</td>
                  <td className="px-4 py-2 text-slate-700">{row.rowCount}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {new Date(row.createdAt).toLocaleString('fr-FR')}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Étape 2b : Créer la page**

Créer `src/app/admin/csv-template/page.tsx` :

```tsx
import { CsvTemplateManager } from '@/components/admin/CsvTemplateManager'

export const dynamic = 'force-dynamic'

export default function AdminCsvTemplatePage() {
  return <CsvTemplateManager />
}
```

- [ ] **Étape 3 : Vérifier types, lint et build**

Lancer : `npx tsc --noEmit && npm run lint && npm run build`
Attendu : aucune erreur ; build réussi.

- [ ] **Étape 4 : Commit**

```bash
git add src/app/api/admin/csv-imports src/components/admin/CsvTemplateManager.tsx src/app/admin/csv-template
git commit -m "Ajoute la page admin de gestion des templates CSV"
```

---

### Tâche 12 : Pages `/admin/invoices`, `/import` et `/[invoiceId]`

**Fichiers :**
- Créer : `src/components/admin/InvoicesList.tsx`
- Créer : `src/app/admin/invoices/page.tsx`
- Créer : `src/components/admin/InvoiceImportForm.tsx`
- Créer : `src/app/admin/invoices/import/page.tsx`
- Créer : `src/components/admin/InvoiceDetail.tsx`
- Créer : `src/app/admin/invoices/[invoiceId]/page.tsx`

**Interfaces :**
- Consomme : routes API de la tâche 9.

- [ ] **Étape 1 : Créer la liste des factures**

Créer `src/components/admin/InvoicesList.tsx` :

```tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Trash2 } from 'lucide-react'

interface InvoiceRow {
  id: string
  originalFileName: string
  status: 'pending' | 'processing' | 'succeeded' | 'error'
  itemCount: number
  createdAt: string
  validatedAt: string | null
}

const STATUS_LABEL: Record<InvoiceRow['status'], string> = {
  pending: 'En attente',
  processing: 'Analyse en cours',
  succeeded: 'Analysée',
  error: 'Erreur',
}

export function InvoicesList() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    const data = await fetch('/api/admin/invoices').then((response) => response.json())
    setInvoices(data.invoices ?? [])
  }

  useEffect(() => {
    // setTimeout(…,0) : diffère l'appel hors du corps synchrone de l'effet (convention csv-editor, règle set-state-in-effect)
    const timer = window.setTimeout(() => {
      refresh().catch(() => setError('Chargement impossible.'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function remove(id: string) {
    await fetch(`/api/admin/invoices/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Factures</h1>
        <Link
          href="/admin/invoices/import"
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <FileText className="h-4 w-4" />
          Importer une facture
        </Link>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Fichier</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Lignes</th>
              <th className="px-4 py-3 font-medium">Date d’import</th>
              <th className="px-4 py-3 font-medium">Validée</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  Aucune facture importée.
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Link href={`/admin/invoices/${invoice.id}`} className="font-medium text-slate-800 underline">
                      {invoice.originalFileName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{STATUS_LABEL[invoice.status]}</td>
                  <td className="px-4 py-2 text-slate-700">{invoice.itemCount}</td>
                  <td className="px-4 py-2 text-slate-700">{new Date(invoice.createdAt).toLocaleString('fr-FR')}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {invoice.validatedAt ? new Date(invoice.validatedAt).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" onClick={() => remove(invoice.id)} className="text-slate-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Étape 2 : Créer la page liste**

Créer `src/app/admin/invoices/page.tsx` :

```tsx
import { InvoicesList } from '@/components/admin/InvoicesList'

export const dynamic = 'force-dynamic'

export default function AdminInvoicesPage() {
  return <InvoicesList />
}
```

- [ ] **Étape 3 : Créer le formulaire d'import**

Créer `src/components/admin/InvoiceImportForm.tsx` :

```tsx
'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'

export function InvoiceImportForm() {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function importPdf(file: File) {
    setBusy(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      const data = await fetch('/api/admin/invoices', { method: 'POST', body: formData }).then((r) => r.json())
      if (!data.invoiceId) throw new Error(data.message ?? 'Import impossible.')
      router.push(`/admin/invoices/${data.invoiceId}`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import impossible.')
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Importer une facture PDF</h1>
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-600">Sélectionnez un fichier PDF de facture.</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {busy ? 'Import…' : 'Choisir un PDF'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importPdf(file)
          }}
        />
      </div>
      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    </div>
  )
}
```

- [ ] **Étape 4 : Créer la page d'import**

Créer `src/app/admin/invoices/import/page.tsx` :

```tsx
import { InvoiceImportForm } from '@/components/admin/InvoiceImportForm'

export default function AdminInvoiceImportPage() {
  return <InvoiceImportForm />
}
```

- [ ] **Étape 5 : Créer le détail de facture**

Créer `src/components/admin/InvoiceDetail.tsx` :

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react'

type InvoiceItem = {
  supplierReference: string | null
  barcode: string | null
  description: string | null
  quantity: number | null
  purchasePriceHT: number | null
  vatRate: number | null
  lineTotalHT: number | null
}

interface Invoice {
  status: 'pending' | 'processing' | 'succeeded' | 'error'
  originalFileName: string
  errorMessage: string | null
  validatedAt: string | null
  items: InvoiceItem[]
}

const FIELDS: { key: keyof InvoiceItem; label: string; numeric: boolean }[] = [
  { key: 'supplierReference', label: 'Référence', numeric: false },
  { key: 'barcode', label: 'Code-barres', numeric: false },
  { key: 'description', label: 'Désignation', numeric: false },
  { key: 'quantity', label: 'Quantité', numeric: true },
  { key: 'purchasePriceHT', label: 'Prix achat HT', numeric: true },
  { key: 'vatRate', label: 'TVA %', numeric: true },
  { key: 'lineTotalHT', label: 'Total HT', numeric: true },
]

const emptyItem = (): InvoiceItem => ({
  supplierReference: null, barcode: null, description: null,
  quantity: null, purchasePriceHT: null, vatRate: null, lineTotalHT: null,
})

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const data = await fetch(`/api/admin/invoices/${invoiceId}`).then((response) => response.json())
    if (data.invoice) {
      setInvoice(data.invoice)
      setItems(data.invoice.items ?? [])
    }
  }, [invoiceId])

  useEffect(() => {
    // setTimeout(…,0) : diffère l'appel hors du corps synchrone de l'effet (convention csv-editor, règle set-state-in-effect)
    const timer = window.setTimeout(() => {
      load().catch(() => setError('Chargement impossible.'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Tant que l'analyse tourne, on réinterroge (chaque GET fait un sondage Azure).
  useEffect(() => {
    if (invoice?.status !== 'processing') return
    const timer = setInterval(() => load().catch(() => undefined), 2500)
    return () => clearInterval(timer)
  }, [invoice?.status, load])

  const locked = Boolean(invoice?.validatedAt)

  function updateCell(index: number, key: keyof InvoiceItem, raw: string, numeric: boolean) {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item
        // Cellule vidée → null (jamais 0). Champ numérique illisible → null.
        if (raw.trim() === '') return { ...item, [key]: null }
        if (numeric) {
          const parsed = Number(raw.replace(',', '.'))
          return { ...item, [key]: Number.isNaN(parsed) ? null : parsed }
        }
        return { ...item, [key]: raw }
      }),
    )
  }

  async function saveItems() {
    setError('')
    setMessage('')
    const response = await fetch(`/api/admin/invoices/${invoiceId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message ?? 'Enregistrement impossible.')
      return
    }
    setMessage('Lignes enregistrées.')
  }

  async function reanalyze() {
    setError('')
    await fetch(`/api/admin/invoices/${invoiceId}/analyze`, { method: 'POST' })
    await load()
  }

  async function validate() {
    setError('')
    const response = await fetch(`/api/admin/invoices/${invoiceId}/validate`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message ?? 'Validation impossible.')
      return
    }
    await load()
  }

  async function remove() {
    await fetch(`/api/admin/invoices/${invoiceId}`, { method: 'DELETE' })
    router.push('/admin/invoices')
  }

  if (!invoice) return <p className="text-sm text-slate-500">Chargement…</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{invoice.originalFileName}</h1>
        <div className="flex flex-wrap gap-2">
          {!locked && (invoice.status === 'pending' || invoice.status === 'error' || invoice.status === 'succeeded') && (
            <button type="button" onClick={reanalyze} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" /> Relancer l’analyse
            </button>
          )}
          <a href={`/api/admin/invoices/${invoiceId}/export`} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            <Download className="h-4 w-4" /> Télécharger le CSV
          </a>
          <button type="button" onClick={remove} className="inline-flex items-center gap-2 rounded-full border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <Trash2 className="h-4 w-4" /> Supprimer
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Statut : <strong>{invoice.status}</strong>
        {invoice.status === 'processing' && ' — analyse en cours, actualisation automatique…'}
        {invoice.validatedAt && ' — validée (édition verrouillée)'}
      </p>
      {invoice.errorMessage && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{invoice.errorMessage}</p>}
      {message && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              {FIELDS.map((field) => (
                <th key={field.key} className="px-3 py-3 font-medium">{field.label}</th>
              ))}
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-t border-slate-100">
                {FIELDS.map((field) => (
                  <td key={field.key} className="px-2 py-1">
                    <input
                      value={item[field.key] === null ? '' : String(item[field.key])}
                      disabled={locked}
                      onChange={(event) => updateCell(index, field.key, event.target.value, field.numeric)}
                      className="w-full rounded-lg border border-transparent px-2 py-1 hover:border-slate-200 focus:border-slate-400 disabled:bg-slate-50"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  {!locked && (
                    <button type="button" onClick={() => setItems((c) => c.filter((_, i) => i !== index))} className="text-slate-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setItems((c) => [...c, emptyItem()])} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Ajouter une ligne
          </button>
          <button type="button" onClick={saveItems} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Enregistrer les lignes
          </button>
          {invoice.status === 'succeeded' && (
            <button type="button" onClick={validate} className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
              Valider la facture
            </button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Étape 6 : Créer la page détail**

Créer `src/app/admin/invoices/[invoiceId]/page.tsx` :

```tsx
import { InvoiceDetail } from '@/components/admin/InvoiceDetail'

export const dynamic = 'force-dynamic'

export default async function AdminInvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const { invoiceId } = await params
  return <InvoiceDetail invoiceId={invoiceId} />
}
```

- [ ] **Étape 7 : Vérifier types, lint et build**

Lancer : `npx tsc --noEmit && npm run lint && npm run build`
Attendu : aucune erreur ; build réussi.

- [ ] **Étape 8 : Commit**

```bash
git add src/components/admin/InvoicesList.tsx src/app/admin/invoices/page.tsx src/components/admin/InvoiceImportForm.tsx src/app/admin/invoices/import src/components/admin/InvoiceDetail.tsx "src/app/admin/invoices/[invoiceId]"
git commit -m "Ajoute les pages admin de liste, import et détail des factures"
```

---

### Tâche 13 : Vérification d'ensemble et documentation

**Fichiers :**
- Modifier : `README.md`

- [ ] **Étape 1 : Lancer toute la suite**

Lancer : `npm test`
Attendu : tous les fichiers PASS, aucun `.only` oublié.

- [ ] **Étape 2 : Types, lint, build**

Lancer : `npx tsc --noEmit && npm run lint && npm run build`
Attendu : aucune erreur ; build réussi (les pages `/admin/*` apparaissent dans la table des routes).

- [ ] **Étape 3 : Parcours manuel de bout en bout**

Avec `ADMIN_PASSWORD`, `SESSION_SECRET`, `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT`, `AZURE_DOCUMENT_INTELLIGENCE_KEY` dans `.env.local` et un template CSV actif :

```bash
npm run mongo:start && npm run dev
```

1. `/admin/csv-template` → importer un CSV ShopCaisse (devient le template actif).
2. `/admin/invoices/import` → importer une facture PDF ; l'analyse démarre.
3. Sur le détail : attendre `succeeded`, corriger une ligne, en ajouter/supprimer une, enregistrer.
4. Valider la facture → l'édition se verrouille.
5. Télécharger le CSV → colonnes/ordre/séparateur du template, cellules vides pour les colonnes non mappées.
6. Sur une facture en erreur : « Relancer l'analyse ».

- [ ] **Étape 4 : Documenter dans le README**

Ajouter à `README.md`, après la section catalogue :

```markdown
## Espace administrateur (lot 2)

Protégé par mot de passe (`ADMIN_PASSWORD`), accessible sous `/admin` :

- **Import CSV** (`/admin/csv-template`) : importer un template CSV ShopCaisse et
  lister les imports.
- **Import facture** (`/admin/invoices`) : importer une facture PDF, la faire
  analyser par Azure Document Intelligence, corriger les lignes extraites, valider,
  puis télécharger le CSV au format du template actif.

### Variables d'environnement supplémentaires

```bash
ADMIN_PASSWORD=...                              # mot de passe de l'espace admin
SESSION_SECRET=...                              # clé de signature du cookie de session
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=...        # endpoint Azure Document Intelligence
AZURE_DOCUMENT_INTELLIGENCE_KEY=...             # clé Azure
# MAX_PDF_BYTES=15728640                        # optionnel : plafond de taille des PDF
```

Les factures ne sont jamais analysées côté client : le PDF est envoyé au serveur,
qui appelle Azure avec des clés confidentielles. La conversion ne remplit que les
colonnes du template ayant une correspondance ; les autres restent vides.
```

- [ ] **Étape 5 : Commit**

```bash
git add README.md
git commit -m "Documente l'espace admin d'import de factures"
```

---

## Couverture de la spec

| Exigence (spec) | Tâche |
|---|---|
| Auth : sign/verify du jeton | 1 |
| Auth : login/logout + middleware de garde | 2 |
| Modèle `InvoiceImport` + `InvoiceItem` | 3 |
| Validation PDF (magic bytes, taille, MIME) | 4 |
| Normalisation Azure → InvoiceItem, jamais inventée | 5 |
| Conversion InvoiceItem → CSV ShopCaisse (template actif) | 6 |
| Service Azure (soumission + polling async) | 7 |
| Orchestration (upload, analyze, poll, correct, validate, export, delete, relance) | 8 |
| Routes API admin des factures | 9 |
| Coquille admin + menu latéral dynamique + login | 10 |
| Page `/admin/csv-template` (import + liste avec date) | 11 |
| Pages `/admin/invoices`, `/import`, `/[invoiceId]` | 12 |
| Vérif tsc/lint/build + README + env | 13 |
| Clés Azure côté serveur uniquement | 7, Global Constraints |
| Ne jamais inventer / cellules vides | 5, 6 |
| Conserver PDF + données extraites en base | 3, 8 |
| Format/colonnes/ordre/séparateur du template | 6 |
