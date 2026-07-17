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
