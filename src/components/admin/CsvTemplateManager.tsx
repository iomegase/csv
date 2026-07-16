'use client'

import { useEffect, useRef, useState } from 'react'
import { Trash2, Upload } from 'lucide-react'

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
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {imports.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
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
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeImport(row.id)}
                      className="text-slate-400 hover:text-red-600"
                    >
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
