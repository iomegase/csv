import { describe, expect, it } from 'vitest'
import { invoiceItemsToCsv } from '@/lib/invoice-to-csv'
import type { InvoiceItem } from '@/models/InvoiceImport'

const template = {
  delimiter: ';',
  columns: [
    { name: 'Référence', position: 0 },
    { name: 'Nom', position: 1 },
    { name: "Prix d'achat", position: 2 },
    { name: 'Famille', position: 3 },
  ],
}

const item = (over: Partial<InvoiceItem> = {}): InvoiceItem => ({
  supplierReference: 'REF-1',
  barcode: null,
  description: 'Chaise',
  quantity: 2,
  purchasePriceHT: 15.5,
  vatRate: null,
  lineTotalHT: 31,
  ...over,
})

describe('invoiceItemsToCsv', () => {
  it('respecte colonnes, ordre et séparateur du template', () => {
    const csv = invoiceItemsToCsv([item()], template, { bom: false })
    // Famille n'est mappée à aucun champ InvoiceItem → cellule vide.
    expect(csv).toBe("Référence;Nom;Prix d'achat;Famille\r\nREF-1;Chaise;15.5;\r\n")
  })

  it('laisse une cellule vide quand la valeur est null', () => {
    const csv = invoiceItemsToCsv([item({ purchasePriceHT: null })], template, { bom: false })
    expect(csv).toBe("Référence;Nom;Prix d'achat;Famille\r\nREF-1;Chaise;;\r\n")
  })

  it('ajoute le BOM par défaut', () => {
    expect(invoiceItemsToCsv([item()], template).startsWith('﻿')).toBe(true)
  })

  it('échoue explicitement sans template actif', () => {
    expect(() => invoiceItemsToCsv([item()], null)).toThrow(/Aucun template CSV actif/)
  })

  it('rend un CSV avec seulement l\'en-tête si aucune ligne', () => {
    expect(invoiceItemsToCsv([], template, { bom: false })).toBe("Référence;Nom;Prix d'achat;Famille\r\n")
  })
})
