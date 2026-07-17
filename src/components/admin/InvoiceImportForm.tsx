'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'

export function InvoiceImportForm() {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [families, setFamilies] = useState<string[]>([])
  const [suppliers, setSuppliers] = useState<string[]>([])
  const [family, setFamily] = useState('')
  const [supplier, setSupplier] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch('/api/catalog/facets')
        .then((r) => (r.ok ? r.json() : { families: [], suppliers: [] }))
        .then((data) => {
          setFamilies(data.families ?? [])
          setSuppliers(data.suppliers ?? [])
        })
        .catch(() => undefined)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function importPdf(file: File) {
    setBusy(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
      // Famille et fournisseur, toujours absents d'une facture, choisis ici et
      // appliqués aux produits créés lors de l'intégration au catalogue.
      if (family) formData.append('family', family)
      if (supplier) formData.append('supplier', supplier)
      const data = await fetch('/api/admin/invoices', { method: 'POST', body: formData }).then((r) => r.json())
      if (!data.invoiceId) throw new Error(data.message ?? 'Import impossible.')
      router.push(`/admin/invoices/${data.invoiceId}`)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import impossible.')
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold text-slate-900">Importer une facture PDF</h1>

      <div className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          <span>Famille des produits</span>
          <select
            value={family}
            onChange={(e) => setFamily(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"
          >
            <option value="">— À renseigner —</option>
            {families.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="space-y-1.5 text-sm font-semibold text-slate-700">
          <span>Fournisseur</span>
          <select
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal"
          >
            <option value="">— À renseigner —</option>
            {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <p className="text-xs text-slate-500 sm:col-span-2">
          Une facture ne porte ni famille ni fournisseur. Ces deux valeurs seront appliquées aux
          produits créés à partir de cette facture.
        </p>
      </div>

      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <p className="text-sm text-slate-600">Sélectionnez un fichier PDF de facture.</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="mt-4 inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {busy ? 'Import…' : 'Choisir un PDF'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importPdf(file)
          }}
        />
      </div>
      {error && <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    </div>
  )
}
