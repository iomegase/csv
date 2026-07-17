'use client'

import { useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { PURGE_CONFIRM_WORD } from '@/lib/validations/purge.schema'

export function PurgeDataButton() {
  const [open, setOpen] = useState(false)
  const [word, setWord] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const armed = word === PURGE_CONFIRM_WORD

  function close() {
    setOpen(false)
    setWord('')
    setError('')
  }

  async function purge() {
    if (!armed) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/admin/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: word }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message ?? 'Purge impossible.')
      // Le catalogue est vide : on recharge pour retomber sur l'écran d'accueil.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Purge impossible.')
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-semibold text-red-700 hover:bg-red-50"
      >
        <Trash2 className="h-4 w-4" /> Tout effacer
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md space-y-4 rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-red-700">
                <Trash2 className="h-5 w-5" /> Tout effacer
              </h2>
              <button type="button" onClick={close} aria-label="Fermer" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-sm text-slate-600">
              Cette action supprime <strong>définitivement</strong> tout le contenu : produits du tableau maître,
              imports CSV, templates et factures. Elle est <strong>irréversible</strong>.
            </p>

            <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
              <span>
                Tapez <strong>{PURGE_CONFIRM_WORD}</strong> pour confirmer
              </span>
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                autoFocus
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-normal outline-none focus:border-red-500"
              />
            </label>

            {error && <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={purge}
                disabled={!armed || busy}
                className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" /> {busy ? 'Effacement…' : 'Effacer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
