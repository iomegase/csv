'use client'

import { useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Cellule « Couleur de fond » : une pastille de la couleur courante, et un menu
 * de pastilles listant les couleurs déjà utilisées dans le catalogue.
 *
 * Le menu est positionné en `fixed` (coordonnées calculées à l'ouverture) pour
 * ne pas être rogné par le conteneur de défilement du tableau.
 */
export function ColorCell({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (color: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)

  // La couleur courante figure toujours dans le choix, même si elle est seule.
  const colors = value && !options.includes(value) ? [value, ...options] : options

  function openMenu() {
    const rect = btnRef.current?.getBoundingClientRect()
    if (rect) setPos({ top: rect.bottom + 4, left: rect.left })
    setOpen(true)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openMenu())}
        title={value || 'Aucune couleur'}
        className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-1 py-0.5 hover:border-slate-400"
      >
        <span
          className="h-4 w-4 rounded-sm border border-slate-300"
          style={{ backgroundColor: value || '#ffffff' }}
        />
        <ChevronDown className="h-3 w-3 text-slate-400" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 grid max-h-64 w-44 grid-cols-6 gap-1 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-xl"
          >
            <button
              type="button"
              title="Aucune couleur"
              onClick={() => {
                onChange('')
                setOpen(false)
              }}
              className={`col-span-6 mb-1 rounded border px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 ${
                value ? 'border-slate-300' : 'border-slate-900 ring-1 ring-slate-900'
              }`}
            >
              Aucune couleur
            </button>
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                onClick={() => {
                  onChange(color)
                  setOpen(false)
                }}
                className={`h-6 w-6 rounded border ${
                  color === value ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300'
                }`}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </>
      )}
    </>
  )
}
