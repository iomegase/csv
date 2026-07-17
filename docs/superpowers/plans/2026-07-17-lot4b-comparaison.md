# Lot 4b — Comparaison original ↔ copie de travail — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Comparer la copie de travail (catalogue MongoDB) à l'original figé (l'import CSV actif re-parsé) et présenter les changements : articles ajoutés, supprimés, et modifiés (diff champ par champ).

**Architecture:** Un service diffe le catalogue et l'import source, apparie par **Nom normalisé** (cohérent R1), et renvoie `{ added, removed, modified }`. Un endpoint `GET` l'expose ; une page « Comparer » l'affiche. Deuxième phase du lot 4 (spec `2026-07-17-stock-derive-reconstructible-editable-design.md`, décision E6), au-dessus du lot 4a déjà fusionné.

**Tech Stack:** Next.js 16, React 19, Mongoose 9, Vitest + mongodb-memory-server, Tailwind 4, lucide-react.

## Global Constraints

- Appariement par **Nom** via `normalizeMatchValue` (accents/casse/espaces), jamais par ressemblance approximative (cohérent R1/lot 3).
- L'original = l'import source du template actif (`CsvTemplate.sourceImportId` → `CsvImport.rawContent`), re-parsé par `parseCsvBuffer`. Si absent (pas de `sourceImportId`, ou import supprimé) → original vide : tous les produits actifs sont « ajoutés ».
- La copie de travail = `CatalogProduct` ; un article `isDeleted: true` compte comme **supprimé** ; seuls les `isDeleted: false` comptent comme présents.
- Une cellule absente vaut `null`/`''` ; on ne compare pas `null` et `''` comme différents (les deux = « vide »).
- Identifiants Mongo validés ; messages/commentaires en français.
- Tests service : `withTestDatabase()`.
- Vérifs : `npm test`, `npm run lint`, `npm run build`.

---

## Structure des fichiers

**Créés :**
- `src/services/catalog-diff.service.ts` — `diffCatalogAgainstSource`.
- `tests/services/catalog-diff.service.test.ts`.
- `src/app/api/admin/catalog/diff/route.ts` — `GET`.
- `src/app/admin/catalog/diff/page.tsx` — page serveur.
- `src/components/catalog/CatalogDiffView.tsx` — rendu client des 3 listes.

**Modifiés :**
- `src/components/AppSidebar.tsx` — item « Comparer ».

---

## Task 1 : Service de comparaison

**Files:**
- Create: `src/services/catalog-diff.service.ts`
- Test: `tests/services/catalog-diff.service.test.ts`

**Interfaces:**
- Consumes: `CatalogProduct`, `CsvTemplate`/`getActiveTemplate`, `CsvImport`, `parseCsvBuffer` (`@/services/csv-parser.service`), `detectIdentityMapping` + `normalizeMatchValue` (`@/lib/catalog-columns`).
- Produces :

```ts
export interface CatalogDiff {
  added: Array<{ id: string; name: string | null }>
  removed: Array<{ name: string | null; original: Record<string, string> }>
  modified: Array<{ id: string; name: string | null; fields: Array<{ column: string; from: string | null; to: string | null }> }>
}
export async function diffCatalogAgainstSource(): Promise<CatalogDiff>
```

- [ ] **Step 1 : Écrire les tests**

Créer `tests/services/catalog-diff.service.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CsvImport } from '@/models/CsvImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'

withTestDatabase()

const COLUMNS = ['Nom', 'Quantité']

async function setup(originalRows: string[][], apply: (templateId: string) => Promise<void>) {
  const header = COLUMNS.join(';')
  const body = originalRows.map((r) => r.join(';')).join('\r\n')
  const csv = `${header}\r\n${body}\r\n`
  const csvImport = await CsvImport.create({
    originalFileName: 't.csv',
    rawContent: Buffer.from(csv, 'utf-8'),
    fileSize: csv.length,
    mimeType: 'text/csv',
    encoding: 'utf-8',
    delimiter: ';',
    columns: COLUMNS,
    rowCount: originalRows.length,
  })
  const template = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    sourceImportId: csvImport._id,
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
    delimiter: ';',
    isActive: true,
  })
  await apply(String(template._id))
}

describe('diffCatalogAgainstSource', () => {
  it('détecte une quantité modifiée (diff champ)', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '16' } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(1)
    expect(diff.modified[0].fields).toEqual([{ column: 'Quantité', from: '10', to: '16' }])
  })

  it('détecte un article ajouté (absent de l’original)', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' } })
      await CatalogProduct.create({ templateId, name: 'Bol', csvData: { Nom: 'Bol', Quantité: '4' } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added.map((a) => a.name)).toEqual(['Bol'])
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('détecte un article supprimé (soft delete ⇒ retiré de la copie de travail)', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' }, isDeleted: true })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.removed.map((r) => r.name)).toEqual(['Vase'])
    expect(diff.added).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('un article absent de l’original ET soft-deleted n’apparaît nulle part', async () => {
    await setup([['Vase', '10']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' } })
      await CatalogProduct.create({ templateId, name: 'Bol', csvData: { Nom: 'Bol', Quantité: '4' }, isDeleted: true })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('ne signale pas une différence null vs chaîne vide', async () => {
    await setup([['Vase', '']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: null } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.modified).toHaveLength(0)
  })

  it('catalogue identique à l’original : aucun changement', async () => {
    await setup([['Vase', '10'], ['Bol', '4']], async (templateId) => {
      await CatalogProduct.create({ templateId, name: 'Vase', csvData: { Nom: 'Vase', Quantité: '10' } })
      await CatalogProduct.create({ templateId, name: 'Bol', csvData: { Nom: 'Bol', Quantité: '4' } })
    })
    const diff = await diffCatalogAgainstSource()
    expect(diff.added).toHaveLength(0)
    expect(diff.removed).toHaveLength(0)
    expect(diff.modified).toHaveLength(0)
  })

  it('sans template actif, lève une erreur', async () => {
    await expect(diffCatalogAgainstSource()).rejects.toThrow(/template/i)
  })
})
```

- [ ] **Step 2 : Lancer, vérifier l'échec**

Run: `npm test -- catalog-diff`
Expected: FAIL — service inexistant.

- [ ] **Step 3 : Implémenter le service**

Créer `src/services/catalog-diff.service.ts` :

```ts
import { connectToDatabase } from '@/lib/mongodb'
import { CatalogProduct } from '@/models/CatalogProduct'
import { CsvImport } from '@/models/CsvImport'
import { getActiveTemplate } from '@/services/csv-template.service'
import { parseCsvBuffer } from '@/services/csv-parser.service'
import { detectIdentityMapping, normalizeMatchValue } from '@/lib/catalog-columns'

export interface CatalogDiff {
  added: Array<{ id: string; name: string | null }>
  removed: Array<{ name: string | null; original: Record<string, string> }>
  modified: Array<{
    id: string
    name: string | null
    fields: Array<{ column: string; from: string | null; to: string | null }>
  }>
}

/** Deux valeurs sont « identiques » si elles sont vides des deux côtés, ou égales. */
function norm(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export async function diffCatalogAgainstSource(): Promise<CatalogDiff> {
  await connectToDatabase()

  const template = await getActiveTemplate()
  if (!template) throw new Error('Aucun template actif.')

  const columnNames = [...template.columns].sort((a, b) => a.position - b.position).map((c) => c.name)
  const nameColumn = detectIdentityMapping(columnNames).name

  // Original : import source re-parsé (figé). Absent ⇒ original vide.
  let originalRows: Record<string, string>[] = []
  if (template.sourceImportId) {
    const csvImport = await CsvImport.findById(template.sourceImportId).lean()
    if (csvImport?.rawContent) {
      originalRows = parseCsvBuffer(Buffer.from(csvImport.rawContent)).rows
    }
  }

  const originalByName = new Map<string, Record<string, string>>()
  for (const row of originalRows) {
    const key = normalizeMatchValue(nameColumn ? row[nameColumn] : null)
    if (key && !originalByName.has(key)) originalByName.set(key, row)
  }

  // Copie de travail : tous les articles (isDeleted compris pour « supprimés »).
  const products = await CatalogProduct.find({})
    .select('name csvData isDeleted')
    .lean()

  const activeNames = new Set<string>()
  const diff: CatalogDiff = { added: [], removed: [], modified: [] }

  for (const product of products) {
    if (product.isDeleted) continue
    const csvData = (product.csvData ?? {}) as Record<string, unknown>
    const name = (product.name ?? (nameColumn ? (csvData[nameColumn] as string) : null)) ?? null
    const key = normalizeMatchValue(name)
    if (key) activeNames.add(key)

    const original = key ? originalByName.get(key) : undefined
    if (!original) {
      diff.added.push({ id: String(product._id), name })
      continue
    }

    const fields: Array<{ column: string; from: string | null; to: string | null }> = []
    for (const column of columnNames) {
      const from = norm(original[column])
      const to = norm(csvData[column])
      if (from !== to) {
        fields.push({ column, from: from === '' ? null : from, to: to === '' ? null : to })
      }
    }
    if (fields.length) diff.modified.push({ id: String(product._id), name, fields })
  }

  // Supprimés : présents dans l'original, absents des articles actifs.
  for (const [key, row] of originalByName) {
    if (!activeNames.has(key)) {
      diff.removed.push({ name: nameColumn ? (row[nameColumn] ?? null) : null, original: row })
    }
  }

  return diff
}
```

- [ ] **Step 4 : Lancer, vérifier le succès**

Run: `npm test -- catalog-diff`
Expected: PASS (7 cas).

- [ ] **Step 5 : Commit**

```bash
git add src/services/catalog-diff.service.ts tests/services/catalog-diff.service.test.ts
git commit -m "Ajoute diffCatalogAgainstSource : comparaison copie de travail / original par Nom"
```

---

## Task 2 : Endpoint `GET /api/admin/catalog/diff`

**Files:**
- Create: `src/app/api/admin/catalog/diff/route.ts`

**Interfaces:**
- Consumes: `diffCatalogAgainstSource`.
- Produces: `GET` → `{ diff }` (200) ou `{ error, message }` (404 si pas de template).

- [ ] **Step 1 : Créer la route**

```ts
import { NextResponse } from 'next/server'
import { diffCatalogAgainstSource } from '@/services/catalog-diff.service'

export async function GET() {
  try {
    const diff = await diffCatalogAgainstSource()
    return NextResponse.json({ diff })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Comparaison impossible.'
    const status = /template/i.test(message) ? 404 : 500
    return NextResponse.json({ error: 'diff_failed', message }, { status })
  }
}
```

- [ ] **Step 2 : Build**

Run: `npm run build`
Expected: `/api/admin/catalog/diff` dans la table des routes.

- [ ] **Step 3 : Commit**

```bash
git add src/app/api/admin/catalog/diff/route.ts
git commit -m "Ajoute la route GET catalog/diff"
```

---

## Task 3 : Page et vue « Comparer »

**Files:**
- Create: `src/app/admin/catalog/diff/page.tsx`
- Create: `src/components/catalog/CatalogDiffView.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/catalog/diff`.

- [ ] **Step 1 : Page serveur**

Créer `src/app/admin/catalog/diff/page.tsx` :

```tsx
import { CatalogDiffView } from '@/components/catalog/CatalogDiffView'

export const dynamic = 'force-dynamic'

export default function CatalogDiffPage() {
  return <CatalogDiffView />
}
```

- [ ] **Step 2 : Composant client**

Créer `src/components/catalog/CatalogDiffView.tsx` :

```tsx
'use client'

import { useEffect, useState } from 'react'
import { FilePlus2, FileMinus2, FilePen } from 'lucide-react'

interface Diff {
  added: Array<{ id: string; name: string | null }>
  removed: Array<{ name: string | null; original: Record<string, string> }>
  modified: Array<{ id: string; name: string | null; fields: Array<{ column: string; from: string | null; to: string | null }> }>
}

export function CatalogDiffView() {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch('/api/admin/catalog/diff')
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.message ?? 'Comparaison impossible.')
          setDiff(data.diff)
        })
        .catch((e: Error) => setError(e.message))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  if (error) return <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>
  if (!diff) return <p className="text-sm text-slate-500">Comparaison en cours…</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Comparer avec l’original</h1>
        <p className="mt-1 text-sm text-slate-600">
          Copie de travail vs import de référence : {diff.added.length} ajouté(s), {diff.removed.length} supprimé(s), {diff.modified.length} modifié(s).
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-emerald-700"><FilePlus2 className="h-5 w-5" /> Ajoutés ({diff.added.length})</h2>
        {diff.added.length === 0 ? <p className="text-sm text-slate-500">Aucun.</p> : (
          <ul className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            {diff.added.map((a) => <li key={a.id} className="border-b border-slate-100 py-1 last:border-0">{a.name ?? '(sans nom)'}</li>)}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-red-700"><FileMinus2 className="h-5 w-5" /> Supprimés ({diff.removed.length})</h2>
        {diff.removed.length === 0 ? <p className="text-sm text-slate-500">Aucun.</p> : (
          <ul className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700 shadow-sm">
            {diff.removed.map((r, i) => <li key={i} className="border-b border-slate-100 py-1 last:border-0">{r.name ?? '(sans nom)'}</li>)}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-amber-700"><FilePen className="h-5 w-5" /> Modifiés ({diff.modified.length})</h2>
        {diff.modified.length === 0 ? <p className="text-sm text-slate-500">Aucun.</p> : (
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600"><tr><th className="px-4 py-2 font-medium">Article</th><th className="px-4 py-2 font-medium">Colonne</th><th className="px-4 py-2 font-medium">Original</th><th className="px-4 py-2 font-medium">Copie de travail</th></tr></thead>
              <tbody>
                {diff.modified.flatMap((m) => m.fields.map((f, i) => (
                  <tr key={`${m.id}:${f.column}`} className="border-t border-slate-100">
                    {i === 0 && <td className="px-4 py-2 font-medium text-slate-800" rowSpan={m.fields.length}>{m.name ?? '(sans nom)'}</td>}
                    <td className="px-4 py-2 text-slate-700">{f.column}</td>
                    <td className="px-4 py-2 text-red-700">{f.from ?? '—'}</td>
                    <td className="px-4 py-2 text-emerald-700">{f.to ?? '—'}</td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 3 : Build**

Run: `npm run build`
Expected: build réussi ; `/admin/catalog/diff` présent.

- [ ] **Step 4 : Commit**

```bash
git add src/app/admin/catalog/diff/page.tsx src/components/catalog/CatalogDiffView.tsx
git commit -m "Ajoute la page Comparer (ajoutés / supprimés / modifiés)"
```

---

## Task 4 : Item de menu « Comparer »

**Files:**
- Modify: `src/components/AppSidebar.tsx`

- [ ] **Step 1 : Ajouter l'item**

Dans `src/components/AppSidebar.tsx`, ajouter l'icône `GitCompare` à l'import lucide et une entrée dans `ITEMS`, après « Stock » :

```tsx
{ href: '/admin/catalog/diff', label: 'Comparer', icon: GitCompare },
```

(Import : `import { FileSpreadsheet, FileText, GitCompare, Home, Package } from 'lucide-react'`.)

- [ ] **Step 2 : Build + vérification manuelle**

Run: `npm run build`
Expected: build réussi. Avec `npm run dev` : l'item « Comparer » apparaît dans le menu et ouvre `/admin/catalog/diff`.

- [ ] **Step 3 : Commit**

```bash
git add src/components/AppSidebar.tsx
git commit -m "Ajoute l'item de menu Comparer"
```

---

## Task 5 : Vérification finale (phase 4b)

- [ ] **Step 1 : Suite** — Run: `npm test` — Expected: PASS (dont les 7 nouveaux tests diff).
- [ ] **Step 2 : Lint** — Run: `npm run lint` — Expected: 0 erreur.
- [ ] **Step 3 : Build** — Run: `npm run build` — Expected: réussi ; routes `/api/admin/catalog/diff` et `/admin/catalog/diff` présentes.
- [ ] **Step 4 : Parcours** — Avec un catalogue actif : modifier un stock, ajouter un article, supprimer un article, puis ouvrir « Comparer » et vérifier que les trois listes reflètent ces changements (modifié avec diff de colonne, ajouté, supprimé).

---

## Suite (plan séparé)

- **4c — Réinitialiser depuis la source** : `POST /api/admin/catalog/reset-from-source` (purge → base import actif → rejeu des factures via un cœur commun extrait d'`applyInvoiceToCatalog`), bouton avec confirmation.
