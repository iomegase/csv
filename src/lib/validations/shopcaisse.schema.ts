import { z } from 'zod'
import { objectIdSchema } from '@/lib/validations/csv-template.schema'

export const shopcaisseImportSchema = z.object({
  importId: objectIdSchema,
  kind: z.enum(['products', 'stock']),
})

export type ShopcaisseImportKind = z.infer<typeof shopcaisseImportSchema>['kind']
