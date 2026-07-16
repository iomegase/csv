interface CatalogSummaryProps {
  templateName: string
  templateUpdatedAt: string
  productCount: number
  missingColumns: string[]
}

export function CatalogSummary({
  templateName,
  templateUpdatedAt,
  productCount,
  missingColumns,
}: CatalogSummaryProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Catalogue produits</h2>

      <dl className="mt-4 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Template actif</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{templateName}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Produits</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">{productCount}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Dernière mise à jour</dt>
          <dd className="mt-1 text-sm font-medium text-slate-900">
            {new Date(templateUpdatedAt).toLocaleDateString('fr-FR')}
          </dd>
        </div>
      </dl>

      {missingColumns.length > 0 && (
        <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Le template actif réclame des colonnes absentes du catalogue :{' '}
          <strong>{missingColumns.join(', ')}</strong>. Elles seront exportées vides. Rejouez
          l’import d’origine pour rétablir la cohérence.
        </p>
      )}
    </section>
  )
}
