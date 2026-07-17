'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileSpreadsheet, FileText, GitCompare, Home, Package, Tags, Truck } from 'lucide-react'

const ITEMS = [
  { href: '/tous-les-produits', label: 'Accueil', icon: Home },
  { href: '/admin/invoices', label: 'Factures', icon: FileText },
  { href: '/catalogue', label: 'Stock', icon: Package },
  { href: '/familles', label: 'Familles', icon: Tags },
  { href: '/fournisseurs', label: 'Fournisseurs', icon: Truck },
  { href: '/admin/catalog/diff', label: 'Comparer', icon: GitCompare },
  { href: '/admin/csv-template', label: 'Import CSV', icon: FileSpreadsheet },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
