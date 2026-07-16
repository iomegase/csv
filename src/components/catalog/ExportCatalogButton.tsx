'use client'

import { Download } from 'lucide-react'

export function ExportCatalogButton() {
  return (
    <a
      href="/api/catalog/export"
      className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
    >
      <Download className="h-4 w-4" />
      Exporter le catalogue
    </a>
  )
}
