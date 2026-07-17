'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import { Download, Filter, Plus, RotateCcw, Search, Settings2, Trash2, X } from 'lucide-react'
import { CsvFilter, CsvRow, FilterOperator, matchesFilter } from '@/lib/csv'
import {
  ColumnMapping,
  detectColumnMapping,
  getProductViewRows,
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
