'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { FileText, Trash2 } from 'lucide-react'

interface InvoiceRow {
  id: string
  originalFileName: string
  status: 'pending' | 'processing' | 'succeeded' | 'error'
  itemCount: number
  createdAt: string
  validatedAt: string | null
}

const STATUS_LABEL: Record<InvoiceRow['status'], string> = {
  pending: 'En attente',
  processing: 'Analyse en cours',
  succeeded: 'Analysée',
  error: 'Erreur',
}

export function InvoicesList() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([])
  const [error, setError] = useState('')

  async function refresh() {
    const data = await fetch('/api/admin/invoices').then((response) => response.json())
    setInvoices(data.invoices ?? [])
  }

  useEffect(() => {
    // setTimeout(…,0) : diffère l'appel hors du corps synchrone de l'effet (convention csv-editor, règle set-state-in-effect)
    const timer = window.setTimeout(() => {
      refresh().catch(() => setError('Chargement impossible.'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function remove(id: string) {
    await fetch(`/api/admin/invoices/${id}`, { method: 'DELETE' })
    await refresh()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Factures</h1>
        <Link
          href="/admin/invoices/import"
          className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          <FileText className="h-4 w-4" />
          Importer une facture
        </Link>
      </div>

      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-600">
            <tr>
              <th className="px-4 py-3 font-medium">Fichier</th>
              <th className="px-4 py-3 font-medium">Statut</th>
              <th className="px-4 py-3 font-medium">Lignes</th>
              <th className="px-4 py-3 font-medium">Date d’import</th>
              <th className="px-4 py-3 font-medium">Validée</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-slate-500">
                  Aucune facture importée.
                </td>
              </tr>
            ) : (
              invoices.map((invoice) => (
                <tr key={invoice.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Link href={`/admin/invoices/${invoice.id}`} className="font-medium text-slate-800 underline">
                      {invoice.originalFileName}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700">{STATUS_LABEL[invoice.status]}</td>
                  <td className="px-4 py-2 text-slate-700">{invoice.itemCount}</td>
                  <td className="px-4 py-2 text-slate-700">{new Date(invoice.createdAt).toLocaleString('fr-FR')}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {invoice.validatedAt ? new Date(invoice.validatedAt).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button type="button" onClick={() => remove(invoice.id)} className="text-slate-400 hover:text-red-600">
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
