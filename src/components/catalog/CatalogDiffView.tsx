'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, FileMinus2, FilePen, FilePlus2, Scale } from 'lucide-react'

interface Diff {
  added: Array<{ id: string; name: string | null; row: number }>
  removed: Array<{ name: string | null; original: Record<string, string>; row: number }>
  modified: Array<{
    id: string
    name: string | null
    row: number
    fields: Array<{ column: string; from: string | null; to: string | null }>
  }>
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

interface Validation {
  summary: {
    productRowCount: number
    stockRowCount: number
    sameRowCount: boolean
    alignment: 'Conforme' | 'Erreur'
    duplicates: number
    ambiguous: number
    newWithoutId: number
  }
  blockers: RowIssue[]
  conflicts: RowIssue[]
  alignmentIssues: Array<{ row: number; column: string; product: string; stock: string }>
  canExport: boolean
}

const PAGE_SIZE = 25

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm text-slate-600">
      <button
        type="button"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className="rounded-lg border border-slate-300 px-3 py-1 font-medium disabled:opacity-40"
      >
        Précédent
      </button>
      <span className="min-w-24 text-center">Page {page} / {totalPages}</span>
      <button
        type="button"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        className="rounded-lg border border-slate-300 px-3 py-1 font-medium disabled:opacity-40"
      >
        Suivant
      </button>
    </div>
  )
}

/** En-tête cliquable d'accordéon, avec compteur et chevron. */
function AccordionHeader({
  icon,
  colorClass,
  title,
  count,
  open,
  onToggle,
}: {
  icon: ReactNode
  colorClass: string
  title: string
  count: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" onClick={onToggle} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
      <span className={`flex items-center gap-2 text-lg font-semibold ${colorClass}`}>
        {icon} {title} ({count})
      </span>
      <ChevronDown className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

/** Section « Ajoutés » / « Supprimés » : accordéon + pagination + numéro de ligne du maître. */
function ListSection({
  icon,
  colorClass,
  title,
  items,
}: {
  icon: ReactNode
  colorClass: string
  title: string
  items: Array<{ key: string; row: number; name: string | null }>
}) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const slice = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <AccordionHeader icon={icon} colorClass={colorClass} title={title} count={items.length} open={open} onToggle={() => setOpen((o) => !o)} />
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun.</p>
          ) : (
            <>
              <ul className="text-sm text-slate-700">
                {slice.map((item) => (
                  <li key={item.key} className="flex gap-3 border-b border-slate-100 py-1 last:border-0">
                    <span className="w-12 shrink-0 text-right font-semibold tabular-nums text-slate-400">{item.row}</span>
                    <span>{item.name ?? '(sans nom)'}</span>
                  </li>
                ))}
              </ul>
              <Pagination page={current} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

/** Section « Modifiés » : accordéon + pagination par article + numéro de ligne du maître. */
function ModifiedSection({ items }: { items: Diff['modified'] }) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const slice = items.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <AccordionHeader
        icon={<FilePen className="h-5 w-5" />}
        colorClass="text-amber-700"
        title="Modifiés"
        count={items.length}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />
      {open && (
        <div className="border-t border-slate-100 px-4 py-3">
          {items.length === 0 ? (
            <p className="text-sm text-slate-500">Aucun.</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-2 font-medium">Ligne</th>
                      <th className="px-4 py-2 font-medium">Article</th>
                      <th className="px-4 py-2 font-medium">Colonne</th>
                      <th className="px-4 py-2 font-medium">Original</th>
                      <th className="px-4 py-2 font-medium">Copie de travail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {slice.flatMap((m) =>
                      m.fields.map((f, i) => (
                        <tr key={`${m.id}:${f.column}`} className="border-t border-slate-100">
                          {i === 0 && (
                            <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-400" rowSpan={m.fields.length}>
                              {m.row}
                            </td>
                          )}
                          {i === 0 && (
                            <td className="px-4 py-2 font-medium text-slate-800" rowSpan={m.fields.length}>
                              {m.name ?? '(sans nom)'}
                            </td>
                          )}
                          <td className="px-4 py-2 text-slate-700">{f.column}</td>
                          <td className="px-4 py-2 text-red-700">{f.from ?? '—'}</td>
                          <td className="px-4 py-2 text-emerald-700">{f.to ?? '—'}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
              <Pagination page={current} totalPages={totalPages} onChange={setPage} />
            </>
          )}
        </div>
      )}
    </section>
  )
}

export function CatalogDiffView() {
  const [diff, setDiff] = useState<Diff | null>(null)
  const [validation, setValidation] = useState<Validation | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch('/api/admin/catalog/diff')
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok) throw new Error(data.message ?? 'Comparaison impossible.')
          setDiff(data.diff)
          setValidation(data.validation)
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
          Le numéro de ligne est le même que dans le tableau maître.
        </p>
      </div>

      {validation && (
        <section className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <Scale className="h-5 w-5" /> Alignement des exports
          </h2>

          <p className={`rounded-2xl px-4 py-3 text-sm ${validation.summary.alignment === 'Conforme' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>
            Statut : <strong>{validation.summary.alignment}</strong> — export-produits.csv :{' '}
            <strong>{validation.summary.productRowCount}</strong> ligne(s), export-stock.csv :{' '}
            <strong>{validation.summary.stockRowCount}</strong> ligne(s).{' '}
            {validation.summary.sameRowCount
              ? 'Même nombre de lignes, même ordre, mêmes produits.'
              : 'Les deux fichiers n’ont pas le même nombre de lignes.'}
          </p>

          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 xl:grid-cols-4">
            {([
              ['Doublons détectés', validation.summary.duplicates],
              ['Lignes ambiguës', validation.summary.ambiguous],
              ['Nouveaux sans Identifiant', validation.summary.newWithoutId],
              ['Différences d’alignement', validation.alignmentIssues.length],
            ] as Array<[string, number]>).map(([label, value]) => (
              <div key={label} className="flex justify-between border-b border-slate-100 pb-1">
                <dt className="text-slate-600">{label}</dt>
                <dd className="font-semibold text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>

          {validation.alignmentIssues.length > 0 && (
            <div className="overflow-x-auto rounded-2xl border border-red-200">
              <table className="min-w-full text-sm">
                <thead className="bg-red-50 text-left text-red-800">
                  <tr>
                    <th className="px-4 py-2 font-medium">Ligne</th>
                    <th className="px-4 py-2 font-medium">Colonne</th>
                    <th className="px-4 py-2 font-medium">export-produits.csv</th>
                    <th className="px-4 py-2 font-medium">export-stock.csv</th>
                  </tr>
                </thead>
                <tbody>
                  {validation.alignmentIssues.map((issue, i) => (
                    <tr key={i} className="border-t border-red-100">
                      <td className="px-4 py-2 text-slate-800">{issue.row}</td>
                      <td className="px-4 py-2 text-slate-700">{issue.column}</td>
                      <td className="px-4 py-2 text-slate-700">{issue.product || '—'}</td>
                      <td className="px-4 py-2 text-slate-700">{issue.stock || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {[...validation.conflicts, ...validation.blockers].length > 0 && (
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700">
                <AlertTriangle className="h-4 w-4" /> Doublons et lignes à résoudre à la main
              </h3>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-2 font-medium">Ligne</th>
                      <th className="px-4 py-2 font-medium">Identifiant</th>
                      <th className="px-4 py-2 font-medium">Référence</th>
                      <th className="px-4 py-2 font-medium">Nom</th>
                      <th className="px-4 py-2 font-medium">Règle</th>
                      <th className="px-4 py-2 font-medium">Motif du conflit</th>
                      <th className="px-4 py-2 font-medium">Lignes liées</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...validation.conflicts, ...validation.blockers].map((issue, i) => (
                      <tr key={`${issue.id}:${i}`} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-800">{issue.row}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.identifiant ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.reference ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.nom ?? '(sans nom)'}</td>
                        <td className="px-4 py-2 text-slate-700">{issue.rule ?? 'Donnée obligatoire'}</td>
                        <td className="px-4 py-2 text-red-700">{issue.reason}</td>
                        <td className="px-4 py-2 text-slate-700">
                          {issue.relatedRows.length ? issue.relatedRows.join(', ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-sm font-semibold text-red-700">
                Téléchargement du lot bloqué tant que ces lignes ne sont pas corrigées dans le tableau maître.
              </p>
            </div>
          )}
        </section>
      )}

      <ListSection
        icon={<FilePlus2 className="h-5 w-5" />}
        colorClass="text-emerald-700"
        title="Ajoutés"
        items={diff.added.map((a) => ({ key: a.id, row: a.row, name: a.name }))}
      />

      <ListSection
        icon={<FileMinus2 className="h-5 w-5" />}
        colorClass="text-red-700"
        title="Supprimés"
        items={diff.removed.map((r, i) => ({ key: `${r.row}:${i}`, row: r.row, name: r.name }))}
      />

      <ModifiedSection items={diff.modified} />
    </div>
  )
}
