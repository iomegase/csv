import type { FacetEntry } from '@/services/catalog-facets.service'

interface FacetListProps {
  title: string
  description: string
  /** En-tête de la première colonne, p. ex. « Famille » ou « Fournisseur ». */
  valueLabel: string
  entries: FacetEntry[]
}

export function FacetList({ title, description, valueLabel, entries }: FacetListProps) {
  const totalProducts = entries.reduce((sum, entry) => sum + entry.count, 0)

  return (
    <main className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {description} {entries.length} valeur(s) distincte(s), {totalProducts} produit(s) au total.
          </p>
        </div>

        {entries.length === 0 ? (
          <p className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 shadow-sm">
            Aucune valeur renseignée.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">{valueLabel}</th>
                  <th className="px-4 py-3 text-right font-medium">Nombre de produits</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.value} className="border-t border-slate-100">
                    <td className="px-4 py-2 text-slate-800">{entry.value}</td>
                    <td className="px-4 py-2 text-right font-semibold text-slate-900">{entry.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  )
}
