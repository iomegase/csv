# Lot 4a — Vues catalogue DB éditables + CRUD — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faire de `/tous-les-produits` (et de ses 4 vues filtrées) un atelier d'édition branché sur le catalogue MongoDB (la copie de travail), avec édition de cellules, ajout et suppression douce d'articles persistés en base.

**Architecture:** Le catalogue (`CatalogProduct.csvData`) est la copie de travail. Une nouvelle vue client `CatalogEditor` lit `/api/catalog/products`, applique filtres/recherche/pagination côté client (comme l'éditeur actuel), et persiste chaque changement via des endpoints CRUD. L'import de CSV reste sur `/admin/csv-template` ; `/tous-les-produits` ne fait plus d'import de fichier. C'est la première phase du lot 4 (spec `2026-07-17-stock-derive-reconstructible-editable-design.md`) ; la comparaison (4b) et la réinitialisation (4c) suivront dans des plans dédiés.

**Tech Stack:** Next.js 16 App Router, React 19, Mongoose 9, Vitest + mongodb-memory-server, Tailwind 4, lucide-react, zod, papaparse (export client).

## Global Constraints

- Une valeur absente vaut `null`, jamais inventée ; une cellule vidée devient `null`, jamais `0`.
- Suppression d'article = **suppression douce** (`isDeleted = true`), jamais un effacement physique (E4 du spec).
- Identifiants Mongo validés par `isValidObjectId` avant toute requête.
- Le catalogue stocke chaque produit dans `csvData` (nom de colonne → valeur) ; les colonnes affichées viennent du **template actif** (ordre par `position`).
- Messages UI et commentaires en français.
- Tests service : `withTestDatabase()` en tête de fichier (replica set en mémoire).
- Vérifications : `npm test`, `npm run lint`, `npm run build`.

---

## Structure des fichiers

**Créés :**
- `src/lib/validations/catalog-edit.schema.ts` — zod pour create/patch.
- `src/app/api/admin/catalog/products/route.ts` — `POST` (créer un article).
- `src/app/api/admin/catalog/products/[id]/route.ts` — `PATCH` (éditer csvData), `DELETE` (suppression douce).
- `src/components/catalog/CatalogEditor.tsx` — atelier d'édition branché DB.
- `tests/services/catalog-product-edit.service.test.ts` — tests des mutations.

**Modifiés :**
- `src/services/catalog-product.service.ts` — `listAllCatalogProducts`, `updateCatalogProductCells`, `createCatalogProduct`, `softDeleteCatalogProduct`.
- `src/app/tous-les-produits/page.tsx` et les 4 pages sœurs — rendre `<CatalogEditor />`.

**Inchangés (réutilisés) :**
- `src/app/api/catalog/products/route.ts` (GET), `src/app/api/catalog/export/route.ts`, `src/lib/product-views.ts` (filtres/mapping), `src/components/csv-editor.tsx` (conservé pour l'import via `/admin/csv-template` si besoin — voir Task 6).

---

## Task 1 : Services de mutation du catalogue

**Files:**
- Modify: `src/services/catalog-product.service.ts`
- Test: `tests/services/catalog-product-edit.service.test.ts`

**Interfaces:**
- Consumes: `CatalogProduct`, `connectToDatabase`.
- Produces :
  - `listAllCatalogProducts(): Promise<{ id: string; csvData: Record<string, unknown> }[]>`
  - `updateCatalogProductCells(id: string, cells: Record<string, string | null>): Promise<void>`
  - `createCatalogProduct(templateId: string, csvData: Record<string, string | null>): Promise<string>`
  - `softDeleteCatalogProduct(id: string): Promise<void>`

- [ ] **Step 1 : Écrire les tests**

Créer `tests/services/catalog-product-edit.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import {
  createCatalogProduct,
  listAllCatalogProducts,
  softDeleteCatalogProduct,
  updateCatalogProductCells,
} from '@/services/catalog-product.service'

withTestDatabase()

async function makeTemplateId() {
  const t = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: ['Nom', 'Quantité'].map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
  return String(t._id)
}

describe('mutations catalogue', () => {
  it('met à jour des cellules et vide une cellule en null', async () => {
    const templateId = await makeTemplateId()
    const p = await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '3' } })

    await updateCatalogProductCells(String(p._id), { Quantité: '9', Nom: '' })

    const after = await CatalogProduct.findById(p._id).lean()
    expect(after!.csvData).toMatchObject({ Quantité: '9', Nom: null })
  })

  it('crée un article et le liste', async () => {
    const templateId = await makeTemplateId()
    const id = await createCatalogProduct(templateId, { Nom: 'Bol', Quantité: '4' })

    expect(id).toBeTruthy()
    const all = await listAllCatalogProducts()
    expect(all).toHaveLength(1)
    expect(all[0].csvData).toMatchObject({ Nom: 'Bol', Quantité: '4' })
  })

  it('supprime en douceur (isDeleted) et exclut de la liste', async () => {
    const templateId = await makeTemplateId()
    const p = await CatalogProduct.create({ templateId, name: 'X', csvData: { Nom: 'X' } })

    await softDeleteCatalogProduct(String(p._id))

    expect((await CatalogProduct.findById(p._id).lean())!.isDeleted).toBe(true)
    expect(await listAllCatalogProducts()).toHaveLength(0)
  })

  it('rejette un identifiant invalide', async () => {
    await expect(updateCatalogProductCells('nope', { Nom: 'x' })).rejects.toThrow(/invalide/)
    await expect(softDeleteCatalogProduct('nope')).rejects.toThrow(/invalide/)
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `npm test -- catalog-product-edit`
Expected: FAIL — fonctions non exportées.

- [ ] **Step 3 : Implémenter les services**

Ajouter dans `src/services/catalog-product.service.ts` (et importer `isValidObjectId` et `Types` depuis `mongoose` en tête) :

```ts
import { isValidObjectId, Types } from 'mongoose'

/** Toute la copie de travail (non supprimée), pour l'atelier d'édition. */
export async function listAllCatalogProducts(): Promise<
  Array<{ id: string; csvData: Record<string, unknown> }>
> {
  await connectToDatabase()
  const products = await CatalogProduct.find({ isDeleted: false })
    .sort({ _id: 1 })
    .select('csvData')
    .lean()
  return products.map((product) => ({
    id: String(product._id),
    csvData: (product.csvData ?? {}) as Record<string, unknown>,
  }))
}

/** Écrit des cellules. Une valeur vide devient null (jamais 0), jamais inventée. */
export async function updateCatalogProductCells(
  id: string,
  cells: Record<string, string | null>,
): Promise<void> {
  if (!isValidObjectId(id)) throw new Error('Identifiant de produit invalide.')
  await connectToDatabase()
  const set: Record<string, string | null> = {}
  for (const [column, value] of Object.entries(cells)) {
    set[`csvData.${column}`] = value === null || value === '' ? null : value
  }
  if (Object.keys(set).length) {
    await CatalogProduct.updateOne({ _id: new Types.ObjectId(id) }, { $set: set })
  }
}

/** Crée un article dans la copie de travail à partir de cellules. */
export async function createCatalogProduct(
  templateId: string,
  csvData: Record<string, string | null>,
): Promise<string> {
  if (!isValidObjectId(templateId)) throw new Error('Identifiant de template invalide.')
  await connectToDatabase()
  const normalized: Record<string, string | null> = {}
  for (const [column, value] of Object.entries(csvData)) {
    normalized[column] = value === null || value === '' ? null : value
  }
  const doc = await CatalogProduct.create({
    templateId: new Types.ObjectId(templateId),
    csvData: normalized,
    originalCsvData: null,
    isDeleted: false,
  })
  return String(doc._id)
}

/** Suppression douce (E4) : l'article reste diffable comme « supprimé ». */
export async function softDeleteCatalogProduct(id: string): Promise<void> {
  if (!isValidObjectId(id)) throw new Error('Identifiant de produit invalide.')
  await connectToDatabase()
  await CatalogProduct.updateOne({ _id: new Types.ObjectId(id) }, { $set: { isDeleted: true } })
}
```

Note : la clé `csvData.${column}` en `$set` (pas un pipeline) est de la notation pointée classique ; un nom de colonne avec un point est un cas rare ici (colonnes du template ShopCaisse) et hors périmètre 4a — à traiter en 4b si nécessaire.

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `npm test -- catalog-product-edit`
Expected: PASS (4 cas).

- [ ] **Step 5 : Commit**

```bash
git add src/services/catalog-product.service.ts tests/services/catalog-product-edit.service.test.ts
git commit -m "Ajoute les mutations du catalogue (liste complète, édition, création, suppression douce)"
```

---

## Task 2 : Schéma de validation des mutations

**Files:**
- Create: `src/lib/validations/catalog-edit.schema.ts`

**Interfaces:**
- Produces : `patchProductSchema` (`{ cells: Record<string,string|null> }`), `createProductSchema` (`{ csvData: Record<string,string|null> }`).

- [ ] **Step 1 : Créer le schéma**

```ts
import { z } from 'zod'

// Une cellule est une chaîne ou null (valeur absente). Jamais un nombre : le
// catalogue stocke les valeurs telles quelles.
const cell = z.union([z.string(), z.null()])

export const patchProductSchema = z.object({
  cells: z.record(z.string(), cell),
})

export const createProductSchema = z.object({
  csvData: z.record(z.string(), cell).default({}),
})
```

- [ ] **Step 2 : Vérifier la compilation**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 3 : Commit**

```bash
git add src/lib/validations/catalog-edit.schema.ts
git commit -m "Ajoute les schémas zod d'édition du catalogue"
```

---

## Task 3 : Endpoints CRUD catalogue

**Files:**
- Create: `src/app/api/admin/catalog/products/route.ts`
- Create: `src/app/api/admin/catalog/products/[id]/route.ts`

**Interfaces:**
- Consumes: Task 1 services, Task 2 schémas, `getActiveTemplate`.
- Produces :
  - `POST /api/admin/catalog/products` → `{ id }` (201) ou `{ error, message }`.
  - `PATCH /api/admin/catalog/products/[id]` → `{ ok: true }`.
  - `DELETE /api/admin/catalog/products/[id]` → `{ ok: true }`.

- [ ] **Step 1 : Route collection (POST)**

Créer `src/app/api/admin/catalog/products/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { createProductSchema } from '@/lib/validations/catalog-edit.schema'
import { createCatalogProduct } from '@/services/catalog-product.service'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    const template = await getActiveTemplate()
    if (!template) {
      return NextResponse.json({ error: 'no_active_template', message: NO_ACTIVE_TEMPLATE_MESSAGE }, { status: 404 })
    }
    const id = await createCatalogProduct(String(template._id), parsed.data.csvData)
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Création impossible.'
    return NextResponse.json({ error: 'create_failed', message }, { status: 400 })
  }
}
```

- [ ] **Step 2 : Route élément (PATCH + DELETE)**

Créer `src/app/api/admin/catalog/products/[id]/route.ts` :

```ts
import { NextResponse } from 'next/server'
import { patchProductSchema } from '@/lib/validations/catalog-edit.schema'
import { softDeleteCatalogProduct, updateCatalogProductCells } from '@/services/catalog-product.service'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = patchProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    await updateCatalogProductCells(id, parsed.data.cells)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mise à jour impossible.'
    const status = /invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'update_failed', message }, { status })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await softDeleteCatalogProduct(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suppression impossible.'
    const status = /invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'delete_failed', message }, { status })
  }
}
```

- [ ] **Step 3 : Build + routes présentes**

Run: `npm run build`
Expected: `/api/admin/catalog/products` et `/api/admin/catalog/products/[id]` dans la table des routes.

- [ ] **Step 4 : Commit**

```bash
git add src/app/api/admin/catalog/products
git commit -m "Ajoute les endpoints CRUD du catalogue (POST/PATCH/DELETE)"
```

---

## Task 4 : Composant `CatalogEditor` (atelier DB)

**Files:**
- Create: `src/components/catalog/CatalogEditor.tsx`

**Interfaces:**
- Consumes: `GET /api/catalog/products?pageSize=500` (jusqu'à couvrir tout le catalogue — voir Step 1), Task 3 endpoints, `/api/catalog/export`, `product-views` (filtres/mapping).
- Produces: composant `CatalogEditor({ activeView })` rendu par les 5 pages (Task 5).

**Contexte d'adaptation :** ce composant reprend la structure de `src/components/csv-editor.tsx` (nav des 5 vues, recherche, filtres, pagination, tableau éditable, configuration des colonnes) mais **remplace la source sessionStorage par la base** et **persiste chaque changement**. Retirer : l'import de fichier (`importCsv`), le bouton « Définir comme template actif », le stockage sessionStorage. L'export « tout » utilise `/api/catalog/export` ; l'export « cette page » reste un export client des lignes filtrées.

- [ ] **Step 1 : Décider du chargement**

`GET /api/catalog/products` pagine (max `pageSize=500`). L'atelier a besoin de **toutes** les lignes pour filtrer/paginer côté client. Ajouter une lecture complète : le composant boucle sur les pages (`page=1..n`, `pageSize=500`) jusqu'à `products.length < 500`, en concaténant, OU on ajoute un paramètre `all=1` au GET. **Choix retenu (simple, sans toucher au contrat existant) : boucle de pagination côté client.** Documenter ce choix dans un commentaire.

- [ ] **Step 2 : Écrire le composant**

Créer `src/components/catalog/CatalogEditor.tsx` :

```tsx
'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Boxes, Download, Filter, Plus, RotateCcw, Search, Settings2, Trash2, X } from 'lucide-react'
import { CsvFilter, CsvRow, FilterOperator, matchesFilter } from '@/lib/csv'
import {
  ColumnMapping,
  detectColumnMapping,
  getProductViewRows,
  getRequiredMappingKeys,
  isViewAvailable,
  PRODUCT_VIEWS,
  ProductViewId,
} from '@/lib/product-views'

const PAGE_SIZES = [25, 50, 100, 250]
const operators: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: 'contient' },
  { value: 'equals', label: 'est égal à' },
  { value: 'notEquals', label: 'est différent de' },
  { value: 'startsWith', label: 'commence par' },
  { value: 'endsWith', label: 'se termine par' },
  { value: 'isEmpty', label: 'est vide' },
  { value: 'isNotEmpty', label: "n'est pas vide" },
]

interface Product {
  id: string
  csvData: Record<string, unknown>
}

// La ligne d'atelier : les cellules éditées sont des chaînes ; on renvoie null
// à la base quand elles sont vidées (jamais 0).
function cellString(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export function CatalogEditor({ activeView }: { activeView: ProductViewId }) {
  const [columns, setColumns] = useState<string[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [templateName, setTemplateName] = useState<string | null>(null)
  const [noTemplate, setNoTemplate] = useState(false)
  const [mapping, setMapping] = useState<ColumnMapping>({ name: '', stock: '', salePrice: '', family: '' })
  const [globalSearch, setGlobalSearch] = useState('')
  const [filters, setFilters] = useState<CsvFilter[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [showMapping, setShowMapping] = useState(false)
  const savingRef = useRef<Record<string, boolean>>({})

  const activeDefinition = PRODUCT_VIEWS.find((v) => v.id === activeView) ?? PRODUCT_VIEWS[0]

  const load = useCallback(async () => {
    setError('')
    // Toutes les lignes : boucle de pagination (le GET plafonne à 500/page).
    const all: Product[] = []
    let pageIndex = 1
    let cols: string[] = []
    let name: string | null = null
    for (;;) {
      const res = await fetch(`/api/catalog/products?page=${pageIndex}&pageSize=500`)
      if (res.status === 404) { setNoTemplate(true); break }
      if (!res.ok) throw new Error('Chargement impossible.')
      const data = await res.json()
      cols = data.columns ?? cols
      name = data.templateName ?? name
      all.push(...(data.products ?? []))
      if ((data.products ?? []).length < 500) break
      pageIndex += 1
    }
    setColumns(cols)
    setTemplateName(name)
    setProducts(all)
    setMapping(detectColumnMapping(cols))
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load().catch(() => setError('Chargement impossible.')).finally(() => setLoading(false))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const rows: CsvRow[] = useMemo(
    () => products.map((p) => Object.fromEntries(columns.map((c) => [c, cellString(p.csvData[c])]))),
    [products, columns],
  )

  const presetRows = useMemo(
    () => getProductViewRows(rows, activeView, mapping).map((row) => ({ row, index: rows.indexOf(row) })),
    [rows, activeView, mapping],
  )

  const filteredRows = useMemo(() => {
    const search = globalSearch.trim().toLocaleLowerCase('fr')
    return presetRows.filter(({ row }) => {
      const ok = !search || columns.some((c) => String(row[c] ?? '').toLocaleLowerCase('fr').includes(search))
      return ok && filters.every((f) => matchesFilter(row, f))
    })
  }, [presetRows, filters, globalSearch, columns])

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice((currentPage - 1) * pageSize, currentPage * pageSize)

  async function saveCell(product: Product, column: string, value: string) {
    const key = `${product.id}:${column}`
    savingRef.current[key] = true
    setProducts((cur) => cur.map((p) => (p.id === product.id ? { ...p, csvData: { ...p.csvData, [column]: value === '' ? null : value } } : p)))
    try {
      const res = await fetch(`/api/admin/catalog/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: { [column]: value === '' ? null : value } }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setError('Enregistrement de la cellule impossible. Rechargez la page.')
    } finally {
      savingRef.current[key] = false
    }
  }

  async function addProduct() {
    const res = await fetch('/api/admin/catalog/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csvData: {} }),
    })
    if (!res.ok) { setError('Ajout impossible.'); return }
    await load()
    setPage(Math.max(1, Math.ceil((filteredRows.length + 1) / pageSize)))
  }

  async function removeProduct(id: string) {
    if (!window.confirm('Supprimer cet article ? (suppression douce, visible dans la comparaison)')) return
    const res = await fetch(`/api/admin/catalog/products/${id}`, { method: 'DELETE' })
    if (!res.ok) { setError('Suppression impossible.'); return }
    setProducts((cur) => cur.filter((p) => p.id !== id))
  }

  function exportFilteredCsv() {
    const data = filteredRows.map(({ row }) => row)
    const csv = Papa.unparse(data, { columns, delimiter: ';', newline: '\r\n' })
    const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `catalogue-${activeDefinition.shortLabel.toLocaleLowerCase('fr').replace(/\s+/g, '-')}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  if (loading) {
    return <main className="min-h-screen p-4 md:p-8"><div className="mx-auto max-w-[1800px] rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">Chargement…</div></main>
  }

  if (noTemplate) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
          <p className="text-sm text-slate-600">Aucun catalogue actif. Importez un CSV pour commencer.</p>
          <Link href="/admin/csv-template" className="mt-6 inline-block rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Importer un CSV</Link>
        </div>
      </main>
    )
  }

  const productByIndex = (index: number) => products[index]

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-[1800px] space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{activeDefinition.label}</h1>
            <p className="mt-1 text-sm text-slate-600">Catalogue : <strong>{templateName ?? '—'}</strong>. {activeDefinition.description}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="/api/catalog/export" className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Download className="h-4 w-4" /> Exporter tout</a>
            <button type="button" disabled={!filteredRows.length} onClick={exportFilteredCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"><Download className="h-4 w-4" /> Exporter cette page</button>
          </div>
        </header>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        <nav className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Vues produits">
          {PRODUCT_VIEWS.map((view) => {
            const isActive = activeView === view.id
            const available = isViewAvailable(view.id, mapping)
            const count = available ? getProductViewRows(rows, view.id, mapping).length : null
            return (
              <Link key={view.id} href={view.href} className={`rounded-2xl border p-4 ${isActive ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'}`}>
                <div className="flex items-center justify-between"><span className="text-sm font-bold">{view.label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${isActive ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-700'}`}>{count ?? '—'}</span></div>
              </Link>
            )
          })}
        </nav>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={globalSearch} onChange={(e) => { setGlobalSearch(e.target.value); setPage(1) }} placeholder="Rechercher…" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-slate-600" />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setShowMapping((v) => !v)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Settings2 className="h-4 w-4" /> Configurer les colonnes</button>
              <button type="button" onClick={() => setFilters((c) => [...c, { id: crypto.randomUUID(), column: columns[0] ?? '', operator: 'contains', value: '' }])} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Filter className="h-4 w-4" /> Ajouter un filtre</button>
              <button type="button" onClick={() => { setGlobalSearch(''); setFilters([]); setPage(1) }} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RotateCcw className="h-4 w-4" /> Réinitialiser</button>
              <button type="button" onClick={addProduct} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"><Plus className="h-4 w-4" /> Ajouter un article</button>
            </div>
          </div>

          {showMapping && (
            <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
              {(['name', 'stock', 'salePrice', 'family'] as Array<keyof ColumnMapping>).map((key) => (
                <label key={key} className="space-y-1.5 text-sm font-semibold text-slate-700">
                  <span>{{ name: 'Nom', stock: 'Quantité / stock', salePrice: 'Prix de vente', family: 'Famille' }[key]}</span>
                  <select value={mapping[key]} onChange={(e) => { setMapping((c) => ({ ...c, [key]: e.target.value })); setPage(1) }} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal">
                    <option value="">Non définie</option>
                    {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}

          {filters.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
              {filters.map((filter) => (
                <div key={filter.id} className="grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-[minmax(160px,1fr)_minmax(150px,1fr)_minmax(180px,2fr)_auto]">
                  <select value={filter.column} onChange={(e) => setFilters((c) => c.map((f) => f.id === filter.id ? { ...f, column: e.target.value } : f))} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">{columns.map((c) => <option key={c} value={c}>{c}</option>)}</select>
                  <select value={filter.operator} onChange={(e) => setFilters((c) => c.map((f) => f.id === filter.id ? { ...f, operator: e.target.value as FilterOperator } : f))} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">{operators.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  <input value={filter.value} disabled={['isEmpty', 'isNotEmpty'].includes(filter.operator)} onChange={(e) => setFilters((c) => c.map((f) => f.id === filter.id ? { ...f, value: e.target.value } : f))} placeholder="Valeur" className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100" />
                  <button type="button" onClick={() => setFilters((c) => c.filter((f) => f.id !== filter.id))} aria-label="Supprimer ce filtre" className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-slate-600 hover:bg-slate-100"><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
            <span><strong className="text-slate-900">Total :</strong> {products.length}</span>
            <span><strong className="text-slate-900">Dans cette vue :</strong> {presetRows.length}</span>
            <span><strong className="text-slate-900">Après recherche :</strong> {filteredRows.length}</span>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="overflow-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-slate-900 text-left text-white">
                <tr>
                  {columns.map((c) => <th key={c} className="min-w-48 whitespace-nowrap px-3 py-3 font-semibold">{c}</th>)}
                  <th className="sticky right-0 w-20 bg-slate-900 px-3 py-3 text-center font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ row, index }) => {
                  const product = productByIndex(index)
                  if (!product) return null
                  return (
                    <tr key={product.id} className="border-b border-slate-200 hover:bg-slate-50">
                      {columns.map((column) => (
                        <td key={column} className="p-1.5 align-top">
                          <input
                            defaultValue={row[column] ?? ''}
                            onBlur={(e) => { if (e.target.value !== cellString(product.csvData[column])) saveCell(product, column, e.target.value) }}
                            className="min-w-44 w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 outline-none hover:border-slate-300 hover:bg-white focus:border-slate-600 focus:bg-white"
                          />
                        </td>
                      ))}
                      <td className="sticky right-0 bg-white p-1.5 text-center">
                        <button type="button" onClick={() => removeProduct(product.id)} aria-label="Supprimer l'article" className="inline-flex rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {pageRows.length === 0 && <div className="p-12 text-center text-sm text-slate-500">Aucun article dans cette vue.</div>}
          </div>

          <footer className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Lignes par page</span>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5">{PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" disabled={currentPage === 1} onClick={() => setPage(Math.max(1, currentPage - 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40">Précédent</button>
              <span className="min-w-28 text-center text-sm text-slate-600">Page {currentPage} sur {totalPages}</span>
              <button type="button" disabled={currentPage === totalPages} onClick={() => setPage(Math.min(totalPages, currentPage + 1))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:opacity-40">Suivant</button>
            </div>
          </footer>
        </section>
      </div>
    </main>
  )
}
```

Note d'implémentation : édition par `onBlur` avec `defaultValue` (non contrôlé) — la persistance se fait à la perte de focus, ce qui évite un PATCH par frappe. La règle `set-state-in-effect` du dépôt est respectée via `setTimeout(…,0)` dans l'effet de montage.

- [ ] **Step 3 : Build**

Run: `npm run build`
Expected: build réussi.

- [ ] **Step 4 : Commit**

```bash
git add src/components/catalog/CatalogEditor.tsx
git commit -m "Ajoute CatalogEditor : atelier d'édition du catalogue branché DB"
```

---

## Task 5 : Brancher les 5 pages sur `CatalogEditor`

**Files:**
- Modify: `src/app/tous-les-produits/page.tsx`, `src/app/sans-stock/page.tsx`, `src/app/sans-prix/page.tsx`, `src/app/avec-stock-et-prix/page.tsx`, `src/app/sans-famille/page.tsx`

**Interfaces:**
- Consumes: `CatalogEditor` (Task 4).

- [ ] **Step 1 : Remplacer le rendu de chaque page**

Pour `src/app/tous-les-produits/page.tsx` :

```tsx
import { CatalogEditor } from '@/components/catalog/CatalogEditor'

export default function AllProductsPage() {
  return <CatalogEditor activeView="all" />
}
```

Faire de même pour les 4 autres en changeant `activeView` : `sans-stock` → `withoutStock`, `sans-prix` → `withoutPrice`, `avec-stock-et-prix` → `withStockAndPrice`, `sans-famille` → `withoutFamily`. (Vérifier la valeur `activeView` actuelle dans chaque fichier avant de remplacer l'import `CsvEditor` par `CatalogEditor`.)

- [ ] **Step 2 : Build**

Run: `npm run build`
Expected: build réussi ; les 5 pages compilent.

- [ ] **Step 3 : Vérification manuelle**

Avec `npm run mongo:start` puis `npm run dev` (ou base Atlas configurée), un catalogue actif :
1. `/tous-les-produits` affiche les produits du catalogue (DB), pas un fichier navigateur.
2. Éditer une cellule puis cliquer ailleurs → recharger la page → la valeur persiste.
3. « Ajouter un article » crée une ligne vide éditable ; « Supprimer » la retire (soft delete) avec confirmation.
4. Les vues `/sans-stock`, `/sans-prix`, `/avec-stock-et-prix`, `/sans-famille` filtrent correctement.
5. « Exporter tout » télécharge le CSV ShopCaisse du catalogue ; « Exporter cette page » exporte les lignes filtrées.

- [ ] **Step 4 : Commit**

```bash
git add src/app/tous-les-produits/page.tsx src/app/sans-stock/page.tsx src/app/sans-prix/page.tsx src/app/avec-stock-et-prix/page.tsx src/app/sans-famille/page.tsx
git commit -m "Branche les 5 vues produits sur CatalogEditor (DB)"
```

---

## Task 6 : Nettoyage de l'ancien éditeur sessionStorage

**Files:**
- Modify (ou supprimer) : `src/components/csv-editor.tsx`

**Interfaces:**
- Aucune nouvelle.

**Contexte :** après Task 5, `CsvEditor` n'est plus rendu par aucune page. L'import de CSV + activation du template reste disponible via `/admin/csv-template` (`CsvTemplateManager`), donc `CsvEditor` n'est plus nécessaire.

- [ ] **Step 1 : Vérifier qu'aucune page n'importe plus `CsvEditor`**

Run: `grep -rn "csv-editor\|CsvEditor" src/app src/components`
Expected: aucune référence hors de `src/components/csv-editor.tsx` lui-même.

- [ ] **Step 2 : Supprimer le composant orphelin**

```bash
git rm src/components/csv-editor.tsx
```

- [ ] **Step 3 : Build + lint**

Run: `npm run build && npm run lint`
Expected: build réussi ; lint sans nouvelle erreur (avertissement préexistant toléré).

- [ ] **Step 4 : Commit**

```bash
git add -A
git commit -m "Retire l'éditeur CSV sessionStorage, remplacé par l'atelier DB"
```

---

## Task 7 : Vérification finale (phase 4a)

- [ ] **Step 1 : Suite complète** — Run: `npm test` — Expected: PASS.
- [ ] **Step 2 : Lint** — Run: `npm run lint` — Expected: 0 erreur.
- [ ] **Step 3 : Build** — Run: `npm run build` — Expected: réussi ; routes `/api/admin/catalog/products` et `/api/admin/catalog/products/[id]` présentes.
- [ ] **Step 4 : Parcours** — Rejouer la vérification manuelle de la Task 5 sur une base propre.

---

## Suites (plans séparés, hors 4a)

- **4b — Comparaison** : `diffCatalogAgainstSource`, `GET /api/admin/catalog/diff`, page « Comparer » (ajoutés / supprimés / modifiés).
- **4c — Réinitialiser depuis la source** : `POST /api/admin/catalog/reset-from-source` (purge → base import actif → rejeu factures via cœur commun extrait d'`applyInvoiceToCatalog`), bouton avec confirmation.
