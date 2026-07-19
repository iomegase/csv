'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  Boxes,
  FileSpreadsheet,
  GitCompare,
  PanelLeft,
  ReceiptText,
  Store,
  Tags,
  Truck,
} from 'lucide-react'

const ITEMS = [
  { href: '/tous-les-produits', label: 'Produits Shopcaisse', icon: Boxes },
  { href: '/admin/invoices', label: 'Importer facture', icon: ReceiptText },
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
      className={`sticky top-0 flex h-screen shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white p-3 transition-[width] ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      <div className={`mb-4 flex items-center ${collapsed ? 'flex-col gap-3' : 'justify-between'}`}>
        <span className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <Store className="h-5 w-5" />
          </span>
          {!collapsed && <span className="text-sm font-bold tracking-tight text-slate-900">ShopCaisse</span>}
        </span>
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
          aria-label={collapsed ? 'Agrandir le menu' : 'Réduire le menu'}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <PanelLeft className={`h-5 w-5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                collapsed ? 'justify-center' : ''
              } ${active ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              <Icon
                className={`h-[18px] w-[18px] shrink-0 ${active ? 'text-white' : 'text-slate-400 group-hover:text-indigo-600'}`}
              />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
