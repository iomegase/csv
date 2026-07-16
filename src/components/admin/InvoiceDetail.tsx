'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Plus, RefreshCw, Trash2 } from 'lucide-react'

type InvoiceItem = {
  supplierReference: string | null
  barcode: string | null
  description: string | null
  quantity: number | null
  purchasePriceHT: number | null
  vatRate: number | null
  lineTotalHT: number | null
}

interface Invoice {
  status: 'pending' | 'processing' | 'succeeded' | 'error'
  originalFileName: string
  errorMessage: string | null
  validatedAt: string | null
  items: InvoiceItem[]
}

const FIELDS: { key: keyof InvoiceItem; label: string; numeric: boolean }[] = [
  { key: 'supplierReference', label: 'Référence', numeric: false },
  { key: 'barcode', label: 'Code-barres', numeric: false },
  { key: 'description', label: 'Désignation', numeric: false },
  { key: 'quantity', label: 'Quantité', numeric: true },
  { key: 'purchasePriceHT', label: 'Prix achat HT', numeric: true },
  { key: 'vatRate', label: 'TVA %', numeric: true },
  { key: 'lineTotalHT', label: 'Total HT', numeric: true },
]

const emptyItem = (): InvoiceItem => ({
  supplierReference: null, barcode: null, description: null,
  quantity: null, purchasePriceHT: null, vatRate: null, lineTotalHT: null,
})

export function InvoiceDetail({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const data = await fetch(`/api/admin/invoices/${invoiceId}`).then((response) => response.json())
    if (data.invoice) {
      setInvoice(data.invoice)
      setItems(data.invoice.items ?? [])
    }
  }, [invoiceId])

  useEffect(() => {
    // setTimeout(…,0) : diffère l'appel hors du corps synchrone de l'effet (convention csv-editor, règle set-state-in-effect)
    const timer = window.setTimeout(() => {
      load().catch(() => setError('Chargement impossible.'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Tant que l'analyse tourne, on réinterroge (chaque GET fait un sondage Azure).
  useEffect(() => {
    if (invoice?.status !== 'processing') return
    const timer = setInterval(() => load().catch(() => undefined), 2500)
    return () => clearInterval(timer)
  }, [invoice?.status, load])

  const locked = Boolean(invoice?.validatedAt)

  function updateCell(index: number, key: keyof InvoiceItem, raw: string, numeric: boolean) {
    setItems((current) =>
      current.map((item, i) => {
        if (i !== index) return item
        // Cellule vidée → null (jamais 0). Champ numérique illisible → null.
        if (raw.trim() === '') return { ...item, [key]: null }
        if (numeric) {
          const parsed = Number(raw.replace(',', '.'))
          return { ...item, [key]: Number.isNaN(parsed) ? null : parsed }
        }
        return { ...item, [key]: raw }
      }),
    )
  }

  async function saveItems() {
    setError('')
    setMessage('')
    const response = await fetch(`/api/admin/invoices/${invoiceId}/items`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message ?? 'Enregistrement impossible.')
      return
    }
    setMessage('Lignes enregistrées.')
  }

  async function reanalyze() {
    setError('')
    await fetch(`/api/admin/invoices/${invoiceId}/analyze`, { method: 'POST' })
    await load()
  }

  async function validate() {
    setError('')
    const response = await fetch(`/api/admin/invoices/${invoiceId}/validate`, { method: 'POST' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      setError(data.message ?? 'Validation impossible.')
      return
    }
    await load()
  }

  async function remove() {
    await fetch(`/api/admin/invoices/${invoiceId}`, { method: 'DELETE' })
    router.push('/admin/invoices')
  }

  if (!invoice) return <p className="text-sm text-slate-500">Chargement…</p>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{invoice.originalFileName}</h1>
        <div className="flex flex-wrap gap-2">
          {(invoice.status === 'error' || invoice.status === 'succeeded') && (
            <button type="button" onClick={reanalyze} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
              <RefreshCw className="h-4 w-4" /> Relancer l’analyse
            </button>
          )}
          <a href={`/api/admin/invoices/${invoiceId}/export`} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            <Download className="h-4 w-4" /> Télécharger le CSV
          </a>
          <button type="button" onClick={remove} className="inline-flex items-center gap-2 rounded-full border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <Trash2 className="h-4 w-4" /> Supprimer
          </button>
        </div>
      </div>

      <p className="text-sm text-slate-600">
        Statut : <strong>{invoice.status}</strong>
        {invoice.status === 'processing' && ' — analyse en cours, actualisation automatique…'}
        {invoice.validatedAt && ' — validée (édition verrouillée)'}
      </p>
      {invoice.errorMessage && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{invoice.errorMessage}</p>}
      {message && <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">{message}</p>}
      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              {FIELDS.map((field) => (
                <th key={field.key} className="px-3 py-3 font-medium">{field.label}</th>
              ))}
              <th className="px-3 py-3" />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={index} className="border-t border-slate-100">
                {FIELDS.map((field) => (
                  <td key={field.key} className="px-2 py-1">
                    <input
                      value={item[field.key] === null ? '' : String(item[field.key])}
                      disabled={locked}
                      onChange={(event) => updateCell(index, field.key, event.target.value, field.numeric)}
                      className="w-full rounded-lg border border-transparent px-2 py-1 hover:border-slate-200 focus:border-slate-400 disabled:bg-slate-50"
                    />
                  </td>
                ))}
                <td className="px-2 py-1 text-right">
                  {!locked && (
                    <button type="button" onClick={() => setItems((c) => c.filter((_, i) => i !== index))} className="text-slate-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!locked && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setItems((c) => [...c, emptyItem()])} className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Ajouter une ligne
          </button>
          <button type="button" onClick={saveItems} className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
            Enregistrer les lignes
          </button>
          <button type="button" onClick={validate} className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">
            Valider la facture
          </button>
        </div>
      )}
    </div>
  )
}
