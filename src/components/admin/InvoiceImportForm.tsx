'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload } from 'lucide-react'

export function InvoiceImportForm() {
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function importPdf(file: File) {
    setBusy(true)
    setError('')
    try {
      const formData = new FormData()
      formData.append('file', file)
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
