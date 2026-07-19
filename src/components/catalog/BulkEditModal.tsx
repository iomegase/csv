'use client'

import { useState } from 'react'
import { X } from 'lucide-react'

type ActionType = 'family' | 'supplier' | 'ttcFromHt'

export function BulkEditModal({
  ids,
  families,
  suppliers,
  onClose,
  onApplied,
}: {
  ids: string[]
  families: string[]
  suppliers: string[]
  onClose: () => void
  onApplied: (updated: number) => void
}) {
  const [type, setType] = useState<ActionType>('family')
  const [family, setFamily] = useState('')
  const [supplier, setSupplier] = useState('')
  const [coefficient, setCoefficient] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const count = ids.length

  async function apply() {
    let action: Record<string, unknown>
    if (type === 'family') {
      if (!family.trim()) return setError('Choisissez une famille.')
      action = { type, value: family.trim() }
    } else if (type === 'supplier') {
      if (!supplier.trim()) return setError('Choisissez un fournisseur.')
      action = { type, value: supplier.trim() }
    } else {
      const coef = Number(coefficient.replace(',', '.'))
      if (!Number.isFinite(coef) || coef <= 0) return setError('Coefficient invalide (nombre strictement positif).')
      action = { type, coefficient: coef }
    }

    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/catalog/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Modification impossible.')
      onApplied(data.updated ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Modification impossible.')
      setBusy(false)
    }
  }

  const options: Array<{ value: ActionType; label: string }> = [
    { value: 'family', label: 'Modifier la famille' },
    { value: 'supplier', label: 'Modifier le fournisseur' },
    { value: 'ttcFromHt', label: 'Calculer le prix TTC à partir du HT' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-slate-900">
            Modifier {count} article{count > 1 ? 's' : ''}
          </h2>
          <button type="button" onClick={onClose} aria-label="Fermer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="radio" name="bulk-action" checked={type === option.value} onChange={() => { setType(option.value); setError('') }} />
              {option.label}
            </label>
          ))}
        </div>

        {type === 'family' && (
          <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
            <span>Famille à appliquer</span>
            <input
              list="bulk-families"
              value={family}
              onChange={(e) => setFamily(e.target.value)}
              placeholder="Choisir ou saisir une famille"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-normal"
            />
            <datalist id="bulk-families">
              <option value="Pas de famille" />
              {families.map((f) => <option key={f} value={f} />)}
            </datalist>
          </label>
        )}

        {type === 'supplier' && (
          <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
            <span>Fournisseur à appliquer</span>
            <input
              list="bulk-suppliers"
              value={supplier}
              onChange={(e) => setSupplier(e.target.value)}
              placeholder="Choisir ou saisir un fournisseur"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-normal"
            />
            <datalist id="bulk-suppliers">
              <option value="Pas de fournisseur" />
              {suppliers.map((s) => <option key={s} value={s} />)}
            </datalist>
          </label>
        )}

        {type === 'ttcFromHt' && (
          <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
            <span>Coefficient (Prix TTC = Prix d’achat HT × coefficient)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={coefficient}
              onChange={(e) => setCoefficient(e.target.value)}
              placeholder="ex. 2.4"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-normal"
            />
            <span className="text-xs font-normal text-slate-500">
              Un article sans prix d’achat renseigné est ignoré.
            </span>
          </label>
        )}

        {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Annuler
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy}
            className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
          >
            {busy ? 'Application…' : `Appliquer à ${count} article${count > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
