import { describe, expect, it } from 'vitest'
import { normalizeAzureInvoice } from '@/lib/azure-invoice-normalize'

function resultWithItems(items: unknown[]) {
  return { documents: [{ fields: { Items: { valueArray: items } } }] }
}

describe('normalizeAzureInvoice', () => {
  it('projette les champs présents', () => {
    const result = resultWithItems([
      {
        valueObject: {
          ProductCode: { valueString: 'REF-1' },
          Description: { valueString: 'Chaise pliante' },
          Quantity: { valueNumber: 2 },
          UnitPrice: { valueCurrency: { amount: 15.5 } },
          Amount: { valueCurrency: { amount: 31 } },
          TaxRate: { valueString: '20%' },
        },
      },
    ])

    expect(normalizeAzureInvoice(result)).toEqual([
      {
        supplierReference: 'REF-1',
        barcode: null,
        description: 'Chaise pliante',
        quantity: 2,
        purchasePriceHT: 15.5,
        vatRate: 20,
        lineTotalHT: 31,
      },
    ])
  })

  it('met null pour tout champ absent, jamais 0', () => {
    const result = resultWithItems([{ valueObject: { Description: { valueString: 'Sans prix' } } }])
    expect(normalizeAzureInvoice(result)[0]).toEqual({
      supplierReference: null,
      barcode: null,
      description: 'Sans prix',
      quantity: null,
      purchasePriceHT: null,
      vatRate: null,
      lineTotalHT: null,
    })
  })

  it('ne déduit pas le taux de TVA depuis un montant de taxe', () => {
    // Tax fourni comme montant (pas TaxRate) : vatRate reste null.
    const result = resultWithItems([
      { valueObject: { Tax: { valueCurrency: { amount: 6.2 } }, Amount: { valueNumber: 31 } } },
    ])
    expect(normalizeAzureInvoice(result)[0].vatRate).toBeNull()
    expect(normalizeAzureInvoice(result)[0].lineTotalHT).toBe(31)
  })

  it('rend un tableau vide sans documents ni items', () => {
    expect(normalizeAzureInvoice({})).toEqual([])
    expect(normalizeAzureInvoice({ documents: [{ fields: {} }] })).toEqual([])
  })

  it('ignore une valeur numérique illisible (reste null)', () => {
    const result = resultWithItems([{ valueObject: { Quantity: { valueString: 'deux' } } }])
    expect(normalizeAzureInvoice(result)[0].quantity).toBeNull()
  })
})
