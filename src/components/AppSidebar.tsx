'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FileSpreadsheet, FileText, GitCompare, Home, PanelLeft, Tags, Truck } from 'lucide-react'

const ITEMS = [
  { href: '/tous-les-produits', label: 'Produits Shopcaisse', icon: Home },
  { href: '/admin/invoices', label: 'Importer facture', icon: FileText },
  { href: '/familles', label: 'Familles', icon: Tags },
  { href: '/fournisseurs', label: 'Fournisseurs', icon: Truck },
  { href: '/admin/catalog/diff', label: 'Comparer', icon: GitCompare },
  { href: '/admin/csv-template', label: 'Import CSV', icon: FileSpreadsheet },
]

export function AppSidebar() {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  // Choix mémorisé d'un chargement à l'autre.
  useEffect(() => {
    setCollapsed(localStorage.getItem('sidebar-collapsed') === '1')
  }, [])

  function toggle() {
    setCollapsed((current) => {
      const next = !current
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  return (
    <aside
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-2 transition-[width] ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <button
        type="button"
        onClick={toggle}
        title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
        aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
        className="mb-2 flex items-center justify-center rounded-lg p-2 text-slate-500 hover:bg-slate-100"
      >
        <PanelLeft className={`h-5 w-5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
      </button>

      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium ${
                collapsed ? 'justify-center' : ''
              } ${active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
