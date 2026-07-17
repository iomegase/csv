'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, Filter, Package, Plus, RotateCcw, Search, Settings2, X } from 'lucide-react'
import { COL } from '@/lib/shopcaisse-columns'
import { computeMovement } from '@/lib/shopcaisse-stock'
import { CsvFilter, CsvRow, FilterOperator, matchesFilter } from '@/lib/csv'
import { PurgeDataButton } from '@/components/catalog/PurgeDataButton'
import {
  ColumnMapping,
  detectColumnMapping,
  getProductViewRows,
  isEmptyValue,
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

/** Renseignées par l'application : l'Identifiant vient de ShopCaisse, le mouvement est un calcul. */
const READ_ONLY_COLUMNS: string[] = [COL.identifiant, COL.mouvementStock]

/**
 * Colonnes « à assigner » : quand la cellule vaut « Pas de … » (ou est vide), on
 * remplace le champ libre par un select des valeurs déjà présentes, pour que
 * l'admin en choisisse une d'un clic.
 */
const ASSIGNABLE_COLUMNS: Array<{ column: string; sentinel: string; placeholder: string }> = [
  { column: COL.famille, sentinel: 'pas de famille', placeholder: 'Pas de famille' },
  { column: COL.fournisseur, sentinel: 'pas de fournisseur', placeholder: 'Pas de fournisseur' },
]

function isUnassigned(value: string, sentinel: string): boolean {
  return isEmptyValue(value) || value.trim().toLocaleLowerCase('fr') === sentinel
}

interface Product {
  id: string
  csvData: Record<string, unknown>
}

interface RowIssue {
  row: number
  id: string
  identifiant: string | null
  reference: string | null
  nom: string | null
  reason: string
  rule: string | null
  relatedRows: number[]
}

interface BundleValidation {
  summary: {
    total: number
    existing: number
    newWithoutId: number
    deleted: number
    movementsPositive: number
    movementsNegative: number
    movementsZero: number
    movementsEmpty: number
    duplicates: number
    ambiguous: number
    productRowCount: number
    stockRowCount: number
    sameRowCount: boolean
    alignment: 'Conforme' | 'Erreur'
  }
  blockers: RowIssue[]
  conflicts: RowIssue[]
  canExport: boolean
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
  const [bundle, setBundle] = useState<BundleValidation | null>(null)
  const [bundleBusy, setBundleBusy] = useState(false)

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

  // Valeurs déjà présentes pour chaque colonne « à assigner » (Famille, Fournisseur),
  // pour peupler les selects des cellules « Pas de … ». Triées, sans doublon.
  const assignableOptions = useMemo(() => {
    const out: Record<string, string[]> = {}
    for (const { column, sentinel } of ASSIGNABLE_COLUMNS) {
      const set = new Set<string>()
      for (const product of products) {
        const value = cellString(product.csvData[column]).trim()
        if (value && !isUnassigned(value, sentinel)) set.add(value)
      }
      out[column] = [...set].sort((a, b) => a.localeCompare(b, 'fr'))
    }
    return out
  }, [products])

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
    const cell = value === '' ? null : value

    // Optimiste, mouvement compris : l'utilisateur doit voir le résultat de sa
    // saisie sans attendre l'aller-retour serveur, qui refait le même calcul.
    setProducts((cur) =>
      cur.map((p) => {
        if (p.id !== product.id) return p
        const csvData: Record<string, unknown> = { ...p.csvData, [column]: cell }
        if (column === COL.stockActuel || column === COL.stockSouhaite) {
          const movement = computeMovement(csvData[COL.stockActuel], csvData[COL.stockSouhaite])
          csvData[COL.mouvementStock] = movement.kind === 'value' ? movement.text : null
        }
        return { ...p, csvData }
      }),
    )

    try {
      const res = await fetch(`/api/admin/catalog/products/${product.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cells: { [column]: cell } }),
      })
      if (!res.ok) throw new Error((await res.json()).message ?? 'Enregistrement impossible.')
      setError('')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Enregistrement impossible.')
      // Le serveur a refusé : on recharge plutôt que de laisser à l'écran une
      // valeur que la base ne porte pas.
      await load()
    } finally {
      savingRef.current[key] = false
    }
  }

  /**
   * L'ancien « Effacer » ne supprime plus la ligne : il bascule la colonne
   * `Supprimé`. La ligne reste dans le maître et dans les deux exports — c'est
   * ce marquage que ShopCaisse lit pour supprimer l'article de son côté.
   */
  async function toggleSupprime(product: Product) {
    const next = String(product.csvData[COL.supprime] ?? '0') === '1' ? '0' : '1'
    await saveCell(product, COL.supprime, next)
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

  async function loadBundleSummary() {
    setBundleBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/shopcaisse/export-summary')
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Résumé impossible.')
      setBundle(data.validation)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Résumé impossible.')
    } finally {
      setBundleBusy(false)
    }
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
            <button
              type="button"
              disabled={bundleBusy}
              onClick={loadBundleSummary}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
            >
              <Download className="h-4 w-4" /> Exporter le lot ShopCaisse
            </button>
            <PurgeDataButton />
          </div>
        </header>

        {error && <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {bundle && (
          <section className="space-y-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                  <Package className="h-5 w-5" /> Lot ShopCaisse
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Archive ZIP contenant <strong>export-produits.csv</strong> et <strong>export-stock.csv</strong>.
                </p>
              </div>
              <button type="button" onClick={() => setBundle(null)} aria-label="Fermer le résumé" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
              {([
                ['Produits au total', bundle.summary.total],
                ['Produits existants', bundle.summary.existing],
                ['Nouveaux sans Identifiant', bundle.summary.newWithoutId],
                ['Marqués comme supprimés', bundle.summary.deleted],
                ['Mouvements positifs', bundle.summary.movementsPositive],
                ['Mouvements négatifs', bundle.summary.movementsNegative],
                ['Mouvements nuls', bundle.summary.movementsZero],
                ['Mouvements vides', bundle.summary.movementsEmpty],
                ['Doublons', bundle.summary.duplicates],
                ['Lignes ambiguës', bundle.summary.ambiguous],
              ] as Array<[string, number]>).map(([label, value]) => (
                <div key={label} className="flex justify-between border-b border-slate-100 pb-1">
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>

            <p className={`rounded-2xl px-4 py-3 text-sm ${bundle.summary.alignment === 'Conforme' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
              Alignement des exports : <strong>{bundle.summary.alignment}</strong> — {bundle.summary.productRowCount} ligne(s)
              dans export-produits.csv, {bundle.summary.stockRowCount} dans export-stock.csv.{' '}
              {bundle.summary.sameRowCount
                ? 'Les deux fichiers ont le même nombre de lignes.'
                : 'Les deux fichiers n’ont pas le même nombre de lignes.'}
            </p>

            {bundle.summary.newWithoutId > 0 && (
              <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {bundle.summary.newWithoutId} nouveau(x) produit(s) sans Identifiant. ShopCaisse ne sait pas rattacher un
                mouvement de stock à un produit qu’il ne connaît pas encore : importez d’abord export-produits.csv dans
                ShopCaisse, réexportez les produits pour récupérer leurs nouveaux Identifiants, puis régénérez et importez
                le fichier stock.
              </p>
            )}

            {[...bundle.blockers, ...bundle.conflicts].length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-red-700">Lignes à corriger avant l’export</h3>
                <ul className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                  {[...bundle.blockers, ...bundle.conflicts].map((issue, i) => (
                    <li key={`${issue.id}:${i}`} className="border-b border-red-100 py-1 last:border-0">
                      Ligne {issue.row} — {issue.nom ?? '(sans nom)'} ({issue.reference ?? 'sans référence'}) : {issue.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {bundle.canExport ? (
              <a
                href="/api/admin/shopcaisse/export"
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Download className="h-4 w-4" /> Télécharger le lot (ZIP)
              </a>
            ) : (
              <p className="text-sm font-semibold text-red-700">
                Téléchargement bloqué tant que les erreurs ci-dessus ne sont pas corrigées.
              </p>
            )}
          </section>
        )}

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
          {/* Hauteur bornée : c'est ce qui rend le défilement interne au tableau et
              donc le thead sticky réellement collant. */}
          <div className="max-h-[calc(100vh-15rem)] overflow-auto">
            <table className="w-max border-collapse text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-900 text-left text-white">
                <tr>
                  <th className="sticky left-0 z-20 w-10 bg-slate-900 px-2 py-1.5 text-right font-semibold">#</th>
                  {columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 font-semibold">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(({ row, index }) => {
                  const product = productByIndex(index)
                  if (!product) return null
                  const issue = bundle
                    ? [...bundle.blockers, ...bundle.conflicts].find((i) => i.id === product.id)
                    : undefined
                  const isNew = !cellString(product.csvData[COL.identifiant])
                  return (
                    <tr
                      key={product.id}
                      title={issue?.reason}
                      className={`group border-b border-slate-200 hover:bg-slate-50 ${
                        issue ? 'bg-red-50' : isNew ? 'bg-amber-50' : ''
                      }`}
                    >
                      {/* Position absolue dans le tableau maître : le même numéro que la page Comparer. */}
                      <td
                        className={`sticky left-0 z-10 w-10 px-2 py-1 text-right align-top text-[11px] font-semibold tabular-nums text-slate-500 ${
                          issue ? 'bg-red-50' : isNew ? 'bg-amber-50' : 'bg-white group-hover:bg-slate-50'
                        }`}
                      >
                        {index + 1}
                      </td>
                      {columns.map((column) => {
                        if (column === COL.supprime) {
                          const deleted = cellString(product.csvData[COL.supprime]) === '1'
                          return (
                            <td key={column} className="p-0.5 align-top">
                              <button
                                type="button"
                                onClick={() => toggleSupprime(product)}
                                title="Marquer comme supprimé dans ShopCaisse"
                                className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                                  deleted
                                    ? 'bg-red-100 text-red-800 hover:bg-red-200'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                              >
                                {deleted ? 'Oui' : 'Non'}
                              </button>
                            </td>
                          )
                        }

                        // Cellule « à assigner » (Famille, Fournisseur) valant « Pas de … »
                        // ou vide : un select des valeurs existantes, pour en choisir une.
                        const assignable = ASSIGNABLE_COLUMNS.find((entry) => entry.column === column)
                        if (assignable && isUnassigned(cellString(product.csvData[column]), assignable.sentinel)) {
                          return (
                            <td key={column} className="p-0.5 align-top">
                              <select
                                defaultValue=""
                                onChange={(e) => { if (e.target.value) saveCell(product, column, e.target.value) }}
                                className="rounded border border-amber-300 bg-amber-50 px-1 py-0.5 text-[11px] outline-none focus:border-slate-600"
                              >
                                <option value="">{assignable.placeholder}</option>
                                {(assignableOptions[column] ?? []).map((value) => (
                                  <option key={value} value={value}>{value}</option>
                                ))}
                              </select>
                            </td>
                          )
                        }

                        if (READ_ONLY_COLUMNS.includes(column)) {
                          return (
                            <td key={column} className="p-0.5 align-top">
                              <span className="block whitespace-nowrap rounded bg-slate-50 px-1.5 py-1 text-slate-600">
                                {cellString(product.csvData[column]) || '—'}
                              </span>
                            </td>
                          )
                        }

                        return (
                          <td key={column} className="p-0.5 align-top">
                            <input
                              defaultValue={row[column] ?? ''}
                              size={Math.min(30, Math.max(3, (row[column] ?? '').length))}
                              onBlur={(e) => {
                                if (e.target.value !== cellString(product.csvData[column])) {
                                  saveCell(product, column, e.target.value)
                                }
                              }}
                              className="rounded border border-transparent bg-transparent px-1.5 py-1 outline-none hover:border-slate-300 hover:bg-white focus:border-slate-600 focus:bg-white"
                            />
                          </td>
                        )
                      })}
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
