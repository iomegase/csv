import { z } from 'zod'

const nullableString = z.string().trim().min(1).nullable()
const nullableNumber = z.number().finite().nullable()

export const invoiceItemSchema = z.object({
  supplierReference: nullableString,
  barcode: nullableString,
  description: nullableString,
  quantity: nullableNumber,
  purchasePriceHT: nullableNumber,
  vatRate: nullableNumber,
  lineTotalHT: nullableNumber,
})

export const updateItemsSchema = z.object({
  items: z.array(invoiceItemSchema),
})

export type UpdateItemsInput = z.infer<typeof updateItemsSchema>
