import { z } from 'zod'
import { objectIdSchema } from '@/lib/validations/csv-template.schema'

export const bulkUpdateSchema = z.object({
  ids: z.array(objectIdSchema).min(1),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('family'), value: z.string() }),
    z.object({ type: z.literal('supplier'), value: z.string() }),
    z.object({ type: z.literal('ttcFromHt'), coefficient: z.number().positive() }),
  ]),
})
