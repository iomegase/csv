# Accès libre, menu global, application des factures au catalogue — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l'application librement accessible, offrir un menu latéral global à 4 items, permettre la suppression des imports, et appliquer une facture validée au catalogue en additionnant les quantités au stock.

**Architecture:** Next.js 16 (App Router) + MongoDB via Mongoose. Le catalogue est la source de vérité du stock ; chaque produit stocke ses valeurs dans `csvData` (colonne → valeur). Un nouveau service `applyInvoiceToCatalog` réutilise l'appariement de `catalog-sync` mais **ajoute** la quantité de la facture au lieu d'écraser. L'authentification edge (`proxy.ts`) est retirée ; le menu passe du layout `/admin` au layout racine.

**Tech Stack:** TypeScript, Next.js 16, React 19, Mongoose 9, Vitest + mongodb-memory-server (replica set), Tailwind 4, lucide-react.

## Global Constraints

- Le délimiteur CSV par défaut est `;` (copié depuis `invoice-to-csv.ts`).
- Une valeur absente vaut `null`, **jamais** `0` ni « N/A » — ne jamais inventer une donnée (convention D3/D4 du lot 1).
- Les nombres localisés se lisent via `parseLocalizedNumber` (gère virgule décimale, `€`, espaces insécables) — ne jamais faire `Number(x)` directement sur une cellule.
- Les identifiants Mongo se valident via `isValidObjectId` avant toute requête.
- Tests : `withTestDatabase()` (replica set en mémoire) monté en tête de chaque fichier de test service.
- Commandes de vérification : `npm test`, `npm run lint`, `npm run build`.
- Messages UI et commentaires de code en français, comme le reste du dépôt.

---

## Structure des fichiers

**Créés :**
- `src/components/AppSidebar.tsx` — menu latéral global (4 items).
- `src/app/api/admin/csv-imports/[importId]/route.ts` — `DELETE` d'un import CSV.
- `src/services/invoice-catalog.service.ts` — `applyInvoiceToCatalog`.
- `src/app/api/admin/invoices/[invoiceId]/apply-to-catalog/route.ts` — `POST` application au catalogue.
- `tests/services/invoice-catalog.service.test.ts` — tests du service.
- `tests/services/csv-import-delete.service.test.ts` — test de suppression d'import CSV.

**Modifiés :**
- `src/app/layout.tsx` — monte `AppSidebar`.
- `src/app/admin/layout.tsx` — ne rend plus que le padding + enfants (sidebar retiré).
- `src/services/csv-import.service.ts` — ajoute `deleteCsvImport`.
- `src/components/admin/CsvTemplateManager.tsx` — corbeille + confirmation.
- `src/components/admin/InvoicesList.tsx` — confirmation avant suppression.
- `src/components/admin/InvoiceDetail.tsx` — confirmation + bouton « Appliquer au catalogue » + récap.
- `src/models/InvoiceImport.ts` — champ `appliedToCatalogAt`.

**Supprimés :**
- `src/proxy.ts`
- `src/lib/admin-auth.ts`
- `tests/lib/admin-auth.test.ts`
- `src/app/admin/login/page.tsx`
- `src/app/api/admin/login/route.ts`
- `src/app/api/admin/logout/route.ts`
- `src/components/admin/AdminSidebar.tsx` (remplacé par `AppSidebar`)

---

## Task 1 : Retrait de l'authentification (accès libre)

**Files:**
- Delete: `src/proxy.ts`
- Delete: `src/lib/admin-auth.ts`
- Delete: `tests/lib/admin-auth.test.ts`
- Delete: `src/app/admin/login/page.tsx`
- Delete: `src/app/api/admin/login/route.ts`
- Delete: `src/app/api/admin/logout/route.ts`
- Modify: `README.md`, `.env.example`

**Interfaces:**
- Consumes: rien.
- Produces: plus aucune garde edge ; `/admin/*` et `/api/admin/*` sont accessibles sans cookie.

- [ ] **Step 1 : Supprimer les fichiers d'authentification**

```bash
git rm src/proxy.ts src/lib/admin-auth.ts tests/lib/admin-auth.test.ts \
  src/app/admin/login/page.tsx \
  src/app/api/admin/login/route.ts \
  src/app/api/admin/logout/route.ts
```

- [ ] **Step 2 : Vérifier qu'aucun code ne référence encore l'auth**

Run: `grep -rn "admin-auth\|verifySession\|signSession\|ADMIN_COOKIE\|SESSION_SECRET\|ADMIN_PASSWORD\|proxy" src/`
Expected: aucune correspondance dans `src/` **hors** de mentions à supprimer. Le seul résultat attendu à traiter est le bouton « Déconnexion » du sidebar (traité en Task 2, où l'ancien `AdminSidebar` est remplacé). Si `grep` remonte `AdminSidebar.tsx`, c'est normal — laissé pour Task 2.

- [ ] **Step 3 : Nettoyer `.env.example`**

Retirer les lignes `ADMIN_PASSWORD=...` et `SESSION_SECRET=...`. Ajouter un commentaire au-dessus du bloc Azure :

```bash
# L'espace admin est en accès libre (pas d'authentification).
```

- [ ] **Step 4 : Nettoyer le README**

Dans `README.md`, remplacer le paragraphe « Protégé par mot de passe (`ADMIN_PASSWORD`), accessible sous `/admin` : » par « Accessible librement sous `/admin` : », et supprimer les lignes `ADMIN_PASSWORD=...` et `SESSION_SECRET=...` du bloc « Variables d'environnement supplémentaires ».

- [ ] **Step 5 : Vérifier que la suite de tests passe sans le test d'auth**

Run: `npm test`
Expected: PASS (aucun test ne référence plus `admin-auth`).

- [ ] **Step 6 : Vérifier le build**

Run: `npm run build`
Expected: build réussi, aucune erreur sur un `proxy.ts` ou une route login/logout manquante.

- [ ] **Step 7 : Commit**

```bash
git add -A
git commit -m "Retire l'authentification admin : accès libre sur toute l'application"
```

---

## Task 2 : Menu latéral global (AppSidebar)

**Files:**
- Create: `src/components/AppSidebar.tsx`
- Delete: `src/components/admin/AdminSidebar.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/admin/layout.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: composant `AppSidebar` (export nommé), monté dans le layout racine ; visible sur toutes les pages.

- [ ] **Step 1 : Créer `src/components/AppSidebar.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileSpreadsheet, FileText, Home, Package } from 'lucide-react'

const ITEMS = [
  { href: '/tous-les-produits', label: 'Accueil', icon: Home },
  { href: '/admin/invoices', label: 'Factures', icon: FileText },
  { href: '/catalogue', label: 'Stock', icon: Package },
  { href: '/admin/csv-template', label: 'Import CSV', icon: FileSpreadsheet },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
      <div className="mb-6 px-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
        Lecteur CSV
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
    </aside>
  )
}
```

- [ ] **Step 2 : Monter le sidebar dans le layout racine**

Remplacer le `<body>` de `src/app/layout.tsx` par :

```tsx
import { AppSidebar } from '@/components/AppSidebar'
// … (imports existants conservés)

      <body suppressHydrationWarning>
        <div className="flex min-h-screen bg-slate-50">
          <AppSidebar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
```

(Conserver le commentaire existant sur `suppressHydrationWarning` et l'attribut.)

- [ ] **Step 3 : Simplifier le layout admin (retirer le sidebar dupliqué)**

Remplacer `src/app/admin/layout.tsx` par :

```tsx
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Le menu vient du layout racine ; l'admin ne fournit que l'espacement,
  // car ses pages n'ont pas de padding propre.
  return <div className="overflow-x-auto p-6 md:p-8">{children}</div>
}
```

- [ ] **Step 4 : Supprimer l'ancien sidebar admin**

```bash
git rm src/components/admin/AdminSidebar.tsx
```

- [ ] **Step 5 : Vérifier qu'aucune référence à `AdminSidebar` ne subsiste**

Run: `grep -rn "AdminSidebar" src/`
Expected: aucune correspondance.

- [ ] **Step 6 : Vérifier le build**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 7 : Vérification manuelle**

Run: `npm run mongo:start && npm run dev` (dans un terminal), puis ouvrir `http://localhost:3000/tous-les-produits`, `/catalogue`, `/admin/invoices`, `/admin/csv-template`.
Expected: le menu à 4 items (Accueil, Factures, Stock, Import CSV) est visible sur les 4 pages, l'item courant est surligné, aucun double menu sur les pages admin, pas de double padding.

- [ ] **Step 8 : Commit**

```bash
git add -A
git commit -m "Ajoute un menu latéral global à 4 items (Accueil, Factures, Stock, Import CSV)"
```

---

## Task 3 : Suppression d'un import CSV (service + route)

**Files:**
- Modify: `src/services/csv-import.service.ts`
- Create: `src/app/api/admin/csv-imports/[importId]/route.ts`
- Test: `tests/services/csv-import-delete.service.test.ts`

**Interfaces:**
- Consumes: modèle `CsvImport`, `connectToDatabase`.
- Produces: `deleteCsvImport(id: string): Promise<void>` ; route `DELETE /api/admin/csv-imports/[importId]` renvoyant `{ ok: true }` (200) ou `{ error, message }` (404/400).

- [ ] **Step 1 : Écrire le test de suppression**

Créer `tests/services/csv-import-delete.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvImport } from '@/models/CsvImport'
import { deleteCsvImport } from '@/services/csv-import.service'

withTestDatabase()

describe('deleteCsvImport', () => {
  it('supprime un import existant', async () => {
    const doc = await CsvImport.create({
      originalFileName: 't.csv',
      rawContent: Buffer.from('Nom;Qté\nVase;1\n'),
      fileSize: 15,
      mimeType: 'text/csv',
      encoding: 'utf-8',
      delimiter: ';',
      columns: ['Nom', 'Qté'],
      rowCount: 1,
    })

    await deleteCsvImport(String(doc._id))

    expect(await CsvImport.countDocuments({})).toBe(0)
  })

  it('rejette un identifiant invalide', async () => {
    await expect(deleteCsvImport('pas-un-id')).rejects.toThrow(/invalide/)
  })
})
```

- [ ] **Step 2 : Lancer le test, vérifier l'échec**

Run: `npm test -- csv-import-delete`
Expected: FAIL — `deleteCsvImport` n'est pas exporté.

- [ ] **Step 3 : Implémenter `deleteCsvImport`**

Ajouter en fin de `src/services/csv-import.service.ts` (et importer `isValidObjectId` depuis `mongoose` en tête de fichier) :

```ts
export async function deleteCsvImport(id: string): Promise<void> {
  if (!isValidObjectId(id)) {
    throw new Error('Identifiant d’import invalide.')
  }
  await connectToDatabase()
  await CsvImport.findByIdAndDelete(id)
}
```

Ajouter en tête du fichier :

```ts
import { isValidObjectId } from 'mongoose'
```

- [ ] **Step 4 : Lancer le test, vérifier le succès**

Run: `npm test -- csv-import-delete`
Expected: PASS (les deux cas).

- [ ] **Step 5 : Créer la route DELETE**

Créer `src/app/api/admin/csv-imports/[importId]/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { deleteCsvImport } from '@/services/csv-import.service'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const { importId } = await params
  try {
    await deleteCsvImport(importId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suppression impossible.'
    const status = /invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'csv_import_delete_failed', message }, { status })
  }
}
```

- [ ] **Step 6 : Vérifier le build**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 7 : Commit**

```bash
git add -A
git commit -m "Ajoute la suppression d'un import CSV (service + route DELETE)"
```

---

## Task 4 : Corbeilles UI + confirmations

**Files:**
- Modify: `src/components/admin/CsvTemplateManager.tsx`
- Modify: `src/components/admin/InvoicesList.tsx`
- Modify: `src/components/admin/InvoiceDetail.tsx`

**Interfaces:**
- Consumes: `DELETE /api/admin/csv-imports/[importId]` (Task 3), `DELETE /api/admin/invoices/[invoiceId]` (existant).
- Produces: rien de nouveau — modifications UI.

- [ ] **Step 1 : Corbeille + confirmation dans `CsvTemplateManager`**

Dans `src/components/admin/CsvTemplateManager.tsx` :

1. Ajouter `Trash2` à l'import lucide : `import { Trash2, Upload } from 'lucide-react'`.
2. Ajouter la fonction de suppression au-dessus du `return` :

```tsx
  async function removeImport(id: string) {
    if (!window.confirm('Supprimer cet import CSV ? Cette action est définitive.')) return
    setError('')
    const response = await fetch(`/api/admin/csv-imports/${id}`, { method: 'DELETE' })
    if (!response.ok) {
      setError('Suppression impossible.')
      return
    }
    await refresh()
  }
```

3. Ajouter une colonne d'action à l'en-tête du tableau, après `Date d’import` :

```tsx
              <th className="px-4 py-3" />
```

4. Ajouter la cellule corbeille en fin de chaque ligne `imports.map(...)`, après la cellule date :

```tsx
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeImport(row.id)}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
```

5. Porter le `colSpan` de la ligne « Aucun import CSV. » de `4` à `5`.

- [ ] **Step 2 : Confirmation dans `InvoicesList`**

Dans `src/components/admin/InvoicesList.tsx`, remplacer la fonction `remove` par :

```tsx
  async function remove(id: string) {
    if (!window.confirm('Supprimer cette facture ? Cette action est définitive.')) return
    await fetch(`/api/admin/invoices/${id}`, { method: 'DELETE' })
    await refresh()
  }
```

- [ ] **Step 3 : Confirmation dans `InvoiceDetail`**

Dans `src/components/admin/InvoiceDetail.tsx`, remplacer la fonction `remove` par :

```tsx
  async function remove() {
    if (!window.confirm('Supprimer cette facture ? Cette action est définitive.')) return
    await fetch(`/api/admin/invoices/${invoiceId}`, { method: 'DELETE' })
    router.push('/admin/invoices')
  }
```

- [ ] **Step 4 : Vérifier le build**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 5 : Vérification manuelle**

Avec `npm run dev`, ouvrir `/admin/csv-template` et `/admin/invoices` : chaque ligne a une corbeille, un clic ouvre une confirmation, l'annulation ne supprime rien, la confirmation supprime et rafraîchit la liste.

- [ ] **Step 6 : Commit**

```bash
git add -A
git commit -m "Ajoute les corbeilles d'imports CSV et les confirmations de suppression"
```

---

## Task 5 : Modèle — champ `appliedToCatalogAt`

**Files:**
- Modify: `src/models/InvoiceImport.ts`

**Interfaces:**
- Consumes: rien.
- Produces: champ `appliedToCatalogAt: Date | null` sur `InvoiceImportDoc`, exposé automatiquement par `getInvoiceImport` (qui renvoie `doc.toObject()`).

- [ ] **Step 1 : Ajouter le champ au schéma**

Dans `src/models/InvoiceImport.ts`, ajouter après la ligne `validatedAt: { type: Date, default: null },` :

```ts
    // Horodatage de l'application au catalogue. Non nul ⇒ stocks déjà ajoutés :
    // empêche le double comptage (D5).
    appliedToCatalogAt: { type: Date, default: null },
```

- [ ] **Step 2 : Vérifier le typage**

Run: `npm run build`
Expected: build réussi ; `InvoiceImportDoc` inclut désormais `appliedToCatalogAt`.

- [ ] **Step 3 : Commit**

```bash
git add -A
git commit -m "Ajoute InvoiceImport.appliedToCatalogAt (anti double comptage)"
```

---

## Task 6 : Service `applyInvoiceToCatalog`

**Files:**
- Create: `src/services/invoice-catalog.service.ts`
- Test: `tests/services/invoice-catalog.service.test.ts`

**Interfaces:**
- Consumes: `InvoiceImport` (avec `appliedToCatalogAt` de Task 5), `CatalogProduct`, `getActiveTemplate` (`src/services/csv-template.service.ts`), `detectColumnMapping` + `parseLocalizedNumber` (`src/lib/product-views.ts`), `detectIdentityMapping` + `normalizeMatchValue` + `nameSupplierKey` (`src/lib/catalog-columns.ts`).
- Produces :

```ts
export interface ApplyInvoiceSummary {
  updated: number
  created: number
  ambiguous: Array<{ row: number; matchedBy: 'reference' | 'barcode' | 'nameSupplier'; candidateIds: string[] }>
  skipped: Array<{ row: number; reason: string }>
}

export async function applyInvoiceToCatalog(invoiceId: string): Promise<ApplyInvoiceSummary>
```

  Erreurs métier levées : « Facture introuvable. », « Facture non validée. », « Facture déjà appliquée au catalogue. », « Aucun template actif. », « Le template actif n'a pas de colonne quantité/stock reconnaissable. »

- [ ] **Step 1 : Écrire les tests du service**

Créer `tests/services/invoice-catalog.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { InvoiceImport, type InvoiceItem } from '@/models/InvoiceImport'
import { applyInvoiceToCatalog } from '@/services/invoice-catalog.service'

withTestDatabase()

const COLUMNS = ['Nom', 'Référence', 'Code barre', 'Quantité']

async function makeActiveTemplate() {
  await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
}

const emptyItem = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  supplierReference: null,
  barcode: null,
  description: null,
  quantity: null,
  purchasePriceHT: null,
  vatRate: null,
  lineTotalHT: null,
  ...over,
})

async function makeInvoice(items: InvoiceItem[], over: Record<string, unknown> = {}) {
  const doc = await InvoiceImport.create({
    originalFileName: 'f.pdf',
    pdfContent: Buffer.from('%PDF-'),
    fileSize: 5,
    status: 'succeeded',
    items,
    validatedAt: new Date(),
    ...over,
  })
  return String(doc._id)
}

describe('applyInvoiceToCatalog', () => {
  it('ajoute la quantité au stock d’un produit apparié par référence', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      reference: 'VASE-001',
      name: 'Vase',
      csvData: { Nom: 'Vase', Référence: 'VASE-001', Quantité: '10' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'VASE-001', description: 'Vase', quantity: 6 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    expect(summary.created).toBe(0)
    const product = await CatalogProduct.findOne({ reference: 'VASE-001' }).lean()
    expect(product!.csvData).toMatchObject({ Quantité: '16' })
    expect(String(product!.lastUpdatedFromInvoiceId)).toBe(invoiceId)
  })

  it('crée un produit inconnu avec le stock de la facture', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([
      emptyItem({ supplierReference: 'NEW-1', description: 'Bol', quantity: 4 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({ reference: 'NEW-1' }).lean()
    expect(product!.csvData).toMatchObject({ Référence: 'NEW-1', Nom: 'Bol', Quantité: '4' })
    expect(String(product!.createdFromInvoiceId)).toBe(invoiceId)
  })

  it('apparie par code-barres', async () => {
    await makeActiveTemplate()
    await CatalogProduct.create({
      templateId: (await CsvTemplate.findOne({}))!._id,
      barcode: '3001234567890',
      name: 'Assiette',
      csvData: { Nom: 'Assiette', 'Code barre': '3001234567890', Quantité: '2' },
    })
    const invoiceId = await makeInvoice([
      emptyItem({ barcode: '3001234567890', description: 'Assiette', quantity: 3 }),
    ])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.updated).toBe(1)
    const product = await CatalogProduct.findOne({ barcode: '3001234567890' }).lean()
    expect(product!.csvData).toMatchObject({ Quantité: '5' })
  })

  it('ne comptabilise pas un cas ambigu et le signale', async () => {
    await makeActiveTemplate()
    const templateId = (await CsvTemplate.findOne({}))!._id
    await CatalogProduct.create({ templateId, reference: 'DUP', name: 'A', csvData: { Référence: 'DUP', Quantité: '1' } })
    await CatalogProduct.create({ templateId, reference: 'DUP', name: 'B', csvData: { Référence: 'DUP', Quantité: '1' } })
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'DUP', quantity: 5 })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.ambiguous).toHaveLength(1)
    expect(summary.ambiguous[0].matchedBy).toBe('reference')
    expect(summary.updated).toBe(0)
    expect(summary.created).toBe(0)
  })

  it('ignore une ligne sans quantité', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'NOQTY', quantity: null })])

    const summary = await applyInvoiceToCatalog(invoiceId)

    expect(summary.skipped).toHaveLength(1)
    expect(summary.created).toBe(0)
    expect(await CatalogProduct.countDocuments({})).toBe(0)
  })

  it('refuse une facture non validée', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'X', quantity: 1 })], {
      validatedAt: null,
    })

    await expect(applyInvoiceToCatalog(invoiceId)).rejects.toThrow(/non validée/)
  })

  it('refuse une facture déjà appliquée et horodate la première application', async () => {
    await makeActiveTemplate()
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'ONCE', quantity: 1 })])

    await applyInvoiceToCatalog(invoiceId)
    const first = await InvoiceImport.findById(invoiceId).lean()
    expect(first!.appliedToCatalogAt).toBeTruthy()

    await expect(applyInvoiceToCatalog(invoiceId)).rejects.toThrow(/déjà appliquée/)
    // Pas de double ajout : une seule création.
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })

  it('échoue si le template actif n’a pas de colonne quantité', async () => {
    await CsvTemplate.create({
      name: 'SansQte',
      sourceFileName: 't.csv',
      columns: ['Nom', 'Référence'].map((name, position) => ({ name, position, detectedType: 'string' })),
      delimiter: ';',
      isActive: true,
    })
    const invoiceId = await makeInvoice([emptyItem({ supplierReference: 'X', quantity: 1 })])

    await expect(applyInvoiceToCatalog(invoiceId)).rejects.toThrow(/colonne quantité|stock/)
  })
})
```

- [ ] **Step 2 : Lancer les tests, vérifier l'échec**

Run: `npm test -- invoice-catalog`
Expected: FAIL — `applyInvoiceToCatalog` n'existe pas.

- [ ] **Step 3 : Implémenter le service**

Créer `src/services/invoice-catalog.service.ts` :

```ts
import { isValidObjectId, Types } from 'mongoose'
import { connectToDatabase } from '@/lib/mongodb'
import { InvoiceImport } from '@/models/InvoiceImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { getActiveTemplate } from '@/services/csv-template.service'
import { detectColumnMapping, parseLocalizedNumber } from '@/lib/product-views'
import { detectIdentityMapping, normalizeMatchValue, nameSupplierKey } from '@/lib/catalog-columns'
import type { InvoiceItem } from '@/models/InvoiceImport'

type MatchKey = 'reference' | 'barcode' | 'nameSupplier'

export interface ApplyInvoiceSummary {
  updated: number
  created: number
  ambiguous: Array<{ row: number; matchedBy: MatchKey; candidateIds: string[] }>
  skipped: Array<{ row: number; reason: string }>
}

interface IndexedProduct {
  _id: Types.ObjectId
  reference: string | null
  barcode: string | null
  name: string | null
  supplier: string | null
}

/**
 * Applique une facture validée au catalogue en AJOUTANT la quantité de chaque
 * ligne au stock du produit correspondant (facture = marchandise reçue, D1).
 * Un produit inconnu est créé (D2) ; un cas ambigu n'est jamais écrit (D4).
 * Hors transaction : `appliedToCatalogAt` garantit qu'on n'applique qu'une fois.
 */
export async function applyInvoiceToCatalog(invoiceId: string): Promise<ApplyInvoiceSummary> {
  if (!isValidObjectId(invoiceId)) throw new Error('Identifiant de facture invalide.')
  await connectToDatabase()

  const invoice = await InvoiceImport.findById(invoiceId)
  if (!invoice) throw new Error('Facture introuvable.')
  if (!invoice.validatedAt) throw new Error('Facture non validée.')
  if (invoice.appliedToCatalogAt) throw new Error('Facture déjà appliquée au catalogue.')

  const template = await getActiveTemplate()
  if (!template) throw new Error('Aucun template actif.')

  const columnNames = [...template.columns]
    .sort((a, b) => a.position - b.position)
    .map((column) => column.name)
  const stockColumn = detectColumnMapping(columnNames).stock
  if (!stockColumn) {
    throw new Error('Le template actif n’a pas de colonne quantité/stock reconnaissable.')
  }

  const identityColumns = detectIdentityMapping(columnNames)

  const summary: ApplyInvoiceSummary = { updated: 0, created: 0, ambiguous: [], skipped: [] }

  const existing = (await CatalogProduct.find({ isDeleted: false })
    .select('reference barcode name supplier')
    .lean()) as unknown as IndexedProduct[]

  const indexes: Record<MatchKey, Map<string, Types.ObjectId[]>> = {
    reference: new Map(),
    barcode: new Map(),
    nameSupplier: new Map(),
  }
  for (const product of existing) {
    addToIndex(indexes.reference, normalizeMatchValue(product.reference), product._id)
    addToIndex(indexes.barcode, normalizeMatchValue(product.barcode), product._id)
    addToIndex(indexes.nameSupplier, nameSupplierKey(product.name, product.supplier), product._id)
  }

  const operations: Parameters<typeof CatalogProduct.bulkWrite>[0] = []
  const templateObjectId = template._id as Types.ObjectId

  invoice.items.forEach((item: InvoiceItem, rowIndex: number) => {
    const quantity = item.quantity
    if (quantity === null || quantity === undefined || Number.isNaN(quantity)) {
      summary.skipped.push({ row: rowIndex, reason: 'Quantité absente.' })
      return
    }

    const match = findMatch(indexes, {
      reference: item.supplierReference,
      barcode: item.barcode,
      name: item.description,
    })

    if (match.status === 'ambiguous') {
      summary.ambiguous.push({
        row: rowIndex,
        matchedBy: match.matchedBy,
        candidateIds: match.candidateIds.map(String),
      })
      return
    }

    if (match.status === 'matched') {
      operations.push({
        updateOne: {
          filter: { _id: match.id },
          update: [
            {
              $set: {
                [`csvData.${stockColumn}`]: {
                  $toString: {
                    $add: [currentStockExpression(stockColumn), quantity],
                  },
                },
                lastUpdatedFromInvoiceId: new Types.ObjectId(invoiceId),
              },
            },
          ],
        },
      })
      summary.updated += 1
      return
    }

    // Aucun match : création à partir des colonnes d'identité du template.
    const csvData: Record<string, string> = {}
    if (identityColumns.reference && item.supplierReference) csvData[identityColumns.reference] = item.supplierReference
    if (identityColumns.barcode && item.barcode) csvData[identityColumns.barcode] = item.barcode
    if (identityColumns.name && item.description) csvData[identityColumns.name] = item.description
    csvData[stockColumn] = String(quantity)

    operations.push({
      insertOne: {
        document: {
          templateId: templateObjectId,
          reference: item.supplierReference ?? null,
          barcode: item.barcode ?? null,
          name: item.description ?? null,
          supplier: null,
          csvData,
          originalCsvData: csvData,
          createdFromInvoiceId: new Types.ObjectId(invoiceId),
          isDeleted: false,
        },
      },
    })
    summary.created += 1
  })

  if (operations.length) {
    await CatalogProduct.bulkWrite(operations, { ordered: false })
  }

  invoice.appliedToCatalogAt = new Date()
  await invoice.save()

  return summary
}

/**
 * Expression d'agrégation : stock actuel converti en nombre. Une cellule vide,
 * absente ou illisible vaut 0 (jamais null dans une somme). `$getField` (et non
 * `$csvData.<col>`) car un nom de colonne peut contenir des espaces.
 */
function currentStockExpression(stockColumn: string) {
  return {
    $convert: {
      input: { $getField: { field: stockColumn, input: '$csvData' } },
      to: 'double',
      onError: 0,
      onNull: 0,
    },
  }
}

function addToIndex(index: Map<string, Types.ObjectId[]>, key: string, id: Types.ObjectId) {
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
  identity: { reference: string | null; barcode: string | null; name: string | null },
): MatchOutcome {
  const candidates: Array<[MatchKey, string]> = [
    ['reference', normalizeMatchValue(identity.reference)],
    ['barcode', normalizeMatchValue(identity.barcode)],
    // Pas de fournisseur au niveau ligne de facture : nom seul ne suffit pas à
    // fabriquer une clé nameSupplier, donc ce candidat reste vide en pratique.
    ['nameSupplier', nameSupplierKey(identity.name, null)],
  ]

  for (const [matchedBy, key] of candidates) {
    if (!key) continue
    const bucket = indexes[matchedBy].get(key)
    if (!bucket?.length) continue
    if (bucket.length > 1) return { status: 'ambiguous', matchedBy, candidateIds: bucket }
    return { status: 'matched', id: bucket[0], matchedBy }
  }

  return { status: 'new' }
}
```

Note d'implémentation : l'ajout de stock utilise un **pipeline d'update MongoDB** (`update: [{ $set: … }]`) pour lire puis réécrire `csvData[stockColumn]` atomiquement côté base, en convertissant la valeur existante en nombre (`$convert … onError:0, onNull:0`) et en la stockant en chaîne via `$toString`. Le calcul se fait entièrement côté serveur : le catalogue chargé en mémoire ne sert qu'à l'indexation/appariement, pas au calcul du nouveau stock.

- [ ] **Step 4 : Lancer les tests, vérifier le succès**

Run: `npm test -- invoice-catalog`
Expected: PASS (les 8 cas).

- [ ] **Step 5 : Lint**

Run: `npm run lint`
Expected: aucune erreur (notamment aucune variable inutilisée).

- [ ] **Step 6 : Commit**

```bash
git add -A
git commit -m "Ajoute applyInvoiceToCatalog : stock additif, création des inconnus, anti double comptage"
```

---

## Task 7 : Route API `apply-to-catalog`

**Files:**
- Create: `src/app/api/admin/invoices/[invoiceId]/apply-to-catalog/route.ts`

**Interfaces:**
- Consumes: `applyInvoiceToCatalog` (Task 6).
- Produces: `POST /api/admin/invoices/[invoiceId]/apply-to-catalog` → `{ summary }` (200) ou `{ error, message }` (404 introuvable/id invalide, 409 non validée ou déjà appliquée, 422 pas de colonne stock / pas de template).

- [ ] **Step 1 : Créer la route**

Créer `src/app/api/admin/invoices/[invoiceId]/apply-to-catalog/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { applyInvoiceToCatalog } from '@/services/invoice-catalog.service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const summary = await applyInvoiceToCatalog(invoiceId)
    return NextResponse.json({ summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Application impossible.'
    let status = 400
    if (/introuvable|invalide/.test(message)) status = 404
    else if (/non validée|déjà appliquée/.test(message)) status = 409
    else if (/template|colonne quantité|stock/.test(message)) status = 422
    return NextResponse.json({ error: 'apply_to_catalog_failed', message }, { status })
  }
}
```

- [ ] **Step 2 : Vérifier le build**

Run: `npm run build`
Expected: build réussi, la route apparaît dans la liste des routes.

- [ ] **Step 3 : Commit**

```bash
git add -A
git commit -m "Ajoute la route POST apply-to-catalog"
```

---

## Task 8 : UI — bouton « Appliquer au catalogue » + récap

**Files:**
- Modify: `src/components/admin/InvoiceDetail.tsx`

**Interfaces:**
- Consumes: `POST /api/admin/invoices/[invoiceId]/apply-to-catalog` (Task 7), `appliedToCatalogAt` dans la réponse `GET` (Task 5).
- Produces: rien de nouveau.

- [ ] **Step 1 : Étendre le type `Invoice` et l'état**

Dans `src/components/admin/InvoiceDetail.tsx`, ajouter `appliedToCatalogAt: string | null` à l'interface `Invoice` (après `validatedAt`). Ajouter à l'import lucide `PackagePlus` : `import { Download, PackagePlus, Plus, RefreshCw, Trash2 } from 'lucide-react'`.

- [ ] **Step 2 : Ajouter l'action d'application**

Ajouter, après la fonction `validate` :

```tsx
  async function applyToCatalog() {
    setError('')
    setMessage('')
    const response = await fetch(`/api/admin/invoices/${invoiceId}/apply-to-catalog`, {
      method: 'POST',
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(data.message ?? 'Application au catalogue impossible.')
      return
    }
    const s = data.summary
    const parts = [`${s.updated} mis à jour`, `${s.created} créés`]
    if (s.ambiguous.length) parts.push(`${s.ambiguous.length} ambigus (non appliqués)`)
    if (s.skipped.length) parts.push(`${s.skipped.length} ignorés (sans quantité)`)
    setMessage(`Catalogue mis à jour : ${parts.join(', ')}.`)
    await load()
  }
```

- [ ] **Step 3 : Afficher le bouton (validée + pas encore appliquée)**

Dans l'en-tête, à l'intérieur du `<div className="flex flex-wrap gap-2">` des actions (là où se trouvent « Télécharger le CSV » et « Supprimer »), ajouter avant le bouton Supprimer :

```tsx
          {invoice.validatedAt && !invoice.appliedToCatalogAt && (
            <button
              type="button"
              onClick={applyToCatalog}
              className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              <PackagePlus className="h-4 w-4" /> Appliquer au catalogue
            </button>
          )}
          {invoice.appliedToCatalogAt && (
            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
              <PackagePlus className="h-4 w-4" /> Appliquée au catalogue
            </span>
          )}
```

- [ ] **Step 4 : Vérifier le build**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 5 : Vérification manuelle de bout en bout**

Avec `npm run mongo:start` puis `npm run dev` :
1. Sur `/admin/csv-template`, importer un CSV ShopCaisse avec une colonne quantité → template actif.
2. Sur `/admin/invoices`, importer une facture PDF, laisser l'analyse se terminer, corriger si besoin, cliquer « Valider la facture ».
3. Cliquer « Appliquer au catalogue » → un message récapitule (« X mis à jour, Y créés »), le bouton devient le badge « Appliquée au catalogue ».
4. Sur `/catalogue`, vérifier que les stocks des produits appariés ont augmenté et que les produits inconnus ont été créés.
5. Recharger la fiche facture et re-tenter : le bouton n'apparaît plus (badge affiché), et un appel direct à la route renverrait 409.

- [ ] **Step 6 : Commit**

```bash
git add -A
git commit -m "Ajoute le bouton Appliquer au catalogue et son récapitulatif sur la fiche facture"
```

---

## Task 9 : Vérification finale

- [ ] **Step 1 : Suite complète**

Run: `npm test`
Expected: PASS (tous les fichiers).

- [ ] **Step 2 : Lint**

Run: `npm run lint`
Expected: aucune erreur.

- [ ] **Step 3 : Build**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 4 : Revue du parcours complet**

Rejouer le parcours de la Task 8 Step 5 une dernière fois sur une base propre pour confirmer l'intégration bout en bout (accès libre sans login, menu global, suppression d'imports, facture → stock).
```
