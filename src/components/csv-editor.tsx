'use client'

import Link from 'next/link'
import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import Papa from 'papaparse'
import {
  BadgeEuro,
  Boxes,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Filter,
  FolderX,
  PackageX,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  CsvFilter,
  CsvRow,
  FilterOperator,
  makeEmptyRow,
  matchesFilter,
} from '@/lib/csv'
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
const STORAGE_KEY = 'lecteur-csv-state-v2'

const operators: Array<{ value: FilterOperator; label: string }> = [
  { value: 'contains', label: 'contient' },
  { value: 'equals', label: 'est égal à' },
  { value: 'notEquals', label: 'est différent de' },
  { value: 'startsWith', label: 'commence par' },
  { value: 'endsWith', label: 'se termine par' },
  { value: 'isEmpty', label: 'est vide' },
  { value: 'isNotEmpty', label: "n'est pas vide" },
]

const mappingLabels: Record<keyof ColumnMapping, string> = {
  name: 'Nom du produit',
  stock: 'Quantité / stock',
  salePrice: 'Prix de vente',
  family: 'Famille / catégorie',
}

const viewIcons: Record<ProductViewId, typeof Boxes> = {
  all: Boxes,
  withoutStock: PackageX,
  withoutPrice: BadgeEuro,
  withStockAndPrice: CheckCircle2,
  withoutFamily: FolderX,
}

interface StoredCsvState {
  fileName: string
  columns: string[]
  rows: CsvRow[]
  delimiter: string
  mapping: ColumnMapping
}

interface CsvEditorProps {
  activeView: ProductViewId
}

function uid() {
  return crypto.randomUUID()
}

function emptyMapping(): ColumnMapping {
  return { name: '', stock: '', salePrice: '', family: '' }
}

export function CsvEditor({ activeView }: CsvEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [columns, setColumns] = useState<string[]>([])
  const [rows, setRows] = useState<CsvRow[]>([])
  const [delimiter, setDelimiter] = useState(',')
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping)
  const [globalSearch, setGlobalSearch] = useState('')
  const [filters, setFilters] = useState<CsvFilter[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [error, setError] = useState('')
  const [hydrated, setHydrated] = useState(false)
  const [showMapping, setShowMapping] = useState(false)

  const hasData = columns.length > 0
  const activeDefinition = PRODUCT_VIEWS.find((view) => view.id === activeView) ?? PRODUCT_VIEWS[0]

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = sessionStorage.getItem(STORAGE_KEY)
        if (stored) {
          const state = JSON.parse(stored) as StoredCsvState
          setFileName(state.fileName ?? '')
          setColumns(Array.isArray(state.columns) ? state.columns : [])
          setRows(Array.isArray(state.rows) ? state.rows : [])
          setDelimiter(state.delimiter || ',')
          setMapping(state.mapping ?? detectColumnMapping(state.columns ?? []))
        }
      } catch {
        setError('Les données temporaires n’ont pas pu être restaurées. Réimportez le fichier CSV.')
      } finally {
        setHydrated(true)
      }
    }, 0)

    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (!hydrated || !hasData) return

    const state: StoredCsvState = { fileName, columns, rows, delimiter, mapping }

    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch (storageError) {
      console.error('Impossible de conserver le fichier en session.', storageError)
    }
  }, [columns, delimiter, fileName, hasData, hydrated, mapping, rows])

  const presetRows = useMemo(
    () =>
      getProductViewRows(rows, activeView, mapping).map((row) => ({
        row,
        originalIndex: rows.indexOf(row),
      })),
    [activeView, mapping, rows],
  )

  const viewCounts = useMemo(() => {
    return Object.fromEntries(
      PRODUCT_VIEWS.map((view) => [
        view.id,
        isViewAvailable(view.id, mapping)
          ? getProductViewRows(rows, view.id, mapping).length
          : null,
      ]),
    ) as Record<ProductViewId, number | null>
  }, [mapping, rows])

  const filteredRows = useMemo(() => {
    const search = globalSearch.trim().toLocaleLowerCase('fr')

    return presetRows.filter(({ row }) => {
      const matchesSearch =
        !search ||
        columns.some((column) =>
          String(row[column] ?? '').toLocaleLowerCase('fr').includes(search),
        )

      return matchesSearch && filters.every((filter) => matchesFilter(row, filter))
    })
  }, [columns, filters, globalSearch, presetRows])

  const missingMappingKeys = getRequiredMappingKeys(activeView).filter((key) => !mapping[key])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageRows = filteredRows.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  )

  function importCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError('')

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (header) => header.trim(),
      complete: (result) => {
        const parsedColumns = (result.meta.fields ?? []).filter(Boolean)

        if (!parsedColumns.length) {
          setError("Le fichier ne contient pas de ligne d'en-tête exploitable.")
          return
        }

        const normalizedRows = result.data.map((row) =>
          Object.fromEntries(
            parsedColumns.map((column) => [column, String(row[column] ?? '')]),
          ),
        )
        const detectedMapping = detectColumnMapping(parsedColumns)

        setFileName(file.name)
        setColumns(parsedColumns)
        setRows(normalizedRows)
        setDelimiter(result.meta.delimiter || ',')
        setMapping(detectedMapping)
        setGlobalSearch('')
        setFilters([])
        setPage(1)
        setShowMapping(
          !detectedMapping.stock || !detectedMapping.salePrice || !detectedMapping.family,
        )
      },
      error: (parseError) => setError(parseError.message),
    })

    event.target.value = ''
  }

  function updateCell(rowIndex: number, column: string, value: string) {
    setRows((currentRows) =>
      currentRows.map((row, index) =>
        index === rowIndex ? { ...row, [column]: value } : row,
      ),
    )
  }

  function deleteRow(rowIndex: number) {
    setRows((currentRows) => currentRows.filter((_, index) => index !== rowIndex))
  }

  function addRow() {
    setRows((currentRows) => [...currentRows, makeEmptyRow(columns)])
    setPage(Math.max(1, Math.ceil((rows.length + 1) / pageSize)))
  }

  function addFilter() {
    if (!columns.length) return

    setFilters((current) => [
      ...current,
      {
        id: uid(),
        column: columns[0],
        operator: 'contains',
        value: '',
      },
    ])
  }

  function updateFilter(id: string, patch: Partial<CsvFilter>) {
    setFilters((current) =>
      current.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)),
    )
    setPage(1)
  }

  function removeFilter(id: string) {
    setFilters((current) => current.filter((filter) => filter.id !== id))
    setPage(1)
  }

  function resetFilters() {
    setGlobalSearch('')
    setFilters([])
    setPage(1)
  }

  function exportCsv(data: CsvRow[], suffix = 'modifie') {
    const csv = Papa.unparse(data, {
      columns,
      delimiter,
      newline: '\r\n',
    })

    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const baseName = fileName.replace(/\.csv$/i, '') || 'donnees'

    link.href = url
    link.download = `${baseName}-${suffix}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  if (!hydrated) {
    return (
      <main className="min-h-screen p-4 md:p-8">
        <div className="mx-auto max-w-[1800px] rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
          Chargement de l’application…
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-[1800px] space-y-5">
        <header className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
                <FileSpreadsheet className="h-4 w-4" />
                LECTEUR CSV SHOPCAISSE
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
                {activeDefinition.label}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                {activeDefinition.description} Les données restent uniquement dans votre navigateur.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                ref={inputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={importCsv}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <Upload className="h-4 w-4" />
                Importer un CSV
              </button>

              {hasData && (
                <>
                  <button
                    type="button"
                    onClick={() => exportCsv(rows)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Download className="h-4 w-4" />
                    Exporter tout
                  </button>
                  <button
                    type="button"
                    disabled={filteredRows.length === 0}
                    onClick={() =>
                      exportCsv(
                        filteredRows.map(({ row }) => row),
                        activeDefinition.shortLabel.toLocaleLowerCase('fr').replace(/\s+/g, '-'),
                      )
                    }
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Download className="h-4 w-4" />
                    Exporter cette page
                  </button>
                </>
              )}
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!hasData ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex min-h-[420px] w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-300 bg-white p-8 text-center hover:border-slate-500 hover:bg-slate-50"
          >
            <span className="mb-4 rounded-2xl bg-slate-100 p-4">
              <Upload className="h-8 w-8 text-slate-700" />
            </span>
            <span className="text-lg font-bold text-slate-900">Sélectionner le fichier CSV ShopCaisse</span>
            <span className="mt-2 text-sm text-slate-500">
              Les pages seront calculées automatiquement après l’importation.
            </span>
          </button>
        ) : (
          <>
            <nav className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Pages produits">
              {PRODUCT_VIEWS.map((view) => {
                const Icon = viewIcons[view.id]
                const isActive = activeView === view.id
                const available = isViewAvailable(view.id, mapping)
                const count = viewCounts[view.id]

                return (
                  <Link
                    key={view.id}
                    href={view.href}
                    className={`rounded-2xl border p-4 transition ${
                      isActive
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-900 hover:border-slate-400'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span
                        className={`rounded-xl p-2 ${
                          isActive ? 'bg-white/10 text-white' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                          isActive ? 'bg-white text-slate-900' : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {available ? count : '—'}
                      </span>
                    </div>
                    <div className="mt-4 text-sm font-bold">{view.label}</div>
                    {!available && view.id !== 'all' && (
                      <div className={`mt-1 text-xs ${isActive ? 'text-slate-300' : 'text-amber-700'}`}>
                        Colonne à configurer
                      </div>
                    )}
                  </Link>
                )
              })}
            </nav>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:p-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="relative w-full xl:max-w-md">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={globalSearch}
                    onChange={(event) => {
                      setGlobalSearch(event.target.value)
                      setPage(1)
                    }}
                    placeholder="Rechercher dans cette page…"
                    className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-slate-600"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setShowMapping((current) => !current)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Settings2 className="h-4 w-4" />
                    Configurer les colonnes
                  </button>
                  <button
                    type="button"
                    onClick={addFilter}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Filter className="h-4 w-4" />
                    Ajouter un filtre
                  </button>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Réinitialiser
                  </button>
                  {activeView === 'all' && (
                    <button
                      type="button"
                      onClick={addRow}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                      <Plus className="h-4 w-4" />
                      Ajouter une ligne
                    </button>
                  )}
                </div>
              </div>

              {showMapping && (
                <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-4">
                  {(Object.keys(mappingLabels) as Array<keyof ColumnMapping>).map((key) => (
                    <label key={key} className="space-y-1.5 text-sm font-semibold text-slate-700">
                      <span>{mappingLabels[key]}</span>
                      <select
                        value={mapping[key]}
                        onChange={(event) => {
                          setMapping((current) => ({ ...current, [key]: event.target.value }))
                          setPage(1)
                        }}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"
                      >
                        <option value="">Non définie</option>
                        {columns.map((column) => (
                          <option key={column} value={column}>
                            {column}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}

              {missingMappingKeys.length > 0 && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                  Cette page ne peut pas être calculée tant que la colonne{' '}
                  <strong>{missingMappingKeys.map((key) => mappingLabels[key]).join(' et ')}</strong>{' '}
                  n’est pas sélectionnée dans « Configurer les colonnes ».
                </div>
              )}

              {filters.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-4">
                  {filters.map((filter) => {
                    const operatorHasValue = !['isEmpty', 'isNotEmpty'].includes(filter.operator)

                    return (
                      <div
                        key={filter.id}
                        className="grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-[minmax(160px,1fr)_minmax(150px,1fr)_minmax(180px,2fr)_auto]"
                      >
                        <select
                          value={filter.column}
                          onChange={(event) => updateFilter(filter.id, { column: event.target.value })}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          {columns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>

                        <select
                          value={filter.operator}
                          onChange={(event) =>
                            updateFilter(filter.id, {
                              operator: event.target.value as FilterOperator,
                            })
                          }
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                        >
                          {operators.map((operator) => (
                            <option key={operator.value} value={operator.value}>
                              {operator.label}
                            </option>
                          ))}
                        </select>

                        <input
                          value={filter.value}
                          disabled={!operatorHasValue}
                          onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
                          placeholder="Valeur du filtre"
                          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
                        />

                        <button
                          type="button"
                          onClick={() => removeFilter(filter.id)}
                          aria-label="Supprimer ce filtre"
                          className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-slate-600 hover:bg-slate-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t border-slate-200 pt-4 text-sm text-slate-600">
                <span><strong className="text-slate-900">Fichier :</strong> {fileName}</span>
                <span><strong className="text-slate-900">Total :</strong> {rows.length}</span>
                <span><strong className="text-slate-900">Dans cette page :</strong> {presetRows.length}</span>
                <span><strong className="text-slate-900">Après recherche :</strong> {filteredRows.length}</span>
                <span><strong className="text-slate-900">Séparateur :</strong> {delimiter === '\t' ? 'tabulation' : delimiter}</span>
              </div>
            </section>

            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3 md:px-5">
                <h2 className="font-bold text-slate-900">{activeDefinition.label}</h2>
                <p className="mt-1 text-sm text-slate-500">{activeDefinition.description}</p>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-900 text-left text-white">
                    <tr>
                      <th className="w-16 whitespace-nowrap px-3 py-3 font-semibold">#</th>
                      {columns.map((column) => (
                        <th key={column} className="min-w-48 whitespace-nowrap px-3 py-3 font-semibold">
                          {column}
                        </th>
                      ))}
                      <th className="sticky right-0 w-20 bg-slate-900 px-3 py-3 text-center font-semibold">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(({ row, originalIndex }) => (
                      <tr key={originalIndex} className="border-b border-slate-200 hover:bg-slate-50">
                        <td className="whitespace-nowrap bg-slate-50 px-3 py-2 font-mono text-xs text-slate-500">
                          {originalIndex + 1}
                        </td>
                        {columns.map((column) => (
                          <td key={column} className="p-1.5 align-top">
                            <input
                              value={row[column] ?? ''}
                              onChange={(event) => updateCell(originalIndex, column, event.target.value)}
                              className="min-w-44 w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 outline-none hover:border-slate-300 hover:bg-white focus:border-slate-600 focus:bg-white"
                            />
                          </td>
                        ))}
                        <td className="sticky right-0 bg-white p-1.5 text-center">
                          <button
                            type="button"
                            onClick={() => deleteRow(originalIndex)}
                            aria-label={`Supprimer la ligne ${originalIndex + 1}`}
                            className="inline-flex rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {pageRows.length === 0 && (
                  <div className="p-12 text-center text-sm text-slate-500">
                    {missingMappingKeys.length > 0
                      ? 'Configurez les colonnes nécessaires pour afficher cette page.'
                      : 'Aucun produit ne correspond à cette page ou aux filtres appliqués.'}
                  </div>
                )}
              </div>

              <footer className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span>Lignes par page</span>
                  <select
                    value={pageSize}
                    onChange={(event) => {
                      setPageSize(Number(event.target.value))
                      setPage(1)
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1.5"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>{size}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={currentPage === 1}
                    onClick={() => setPage(Math.max(1, currentPage - 1))}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Précédent
                  </button>
                  <span className="min-w-28 text-center text-sm text-slate-600">
                    Page {currentPage} sur {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage === totalPages}
                    onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Suivant
                  </button>
                </div>
              </footer>
            </section>
          </>
        )}
      </div>
    </main>
  )
}
