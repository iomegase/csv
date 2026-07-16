import { z } from 'zod'

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
})

export const exportQuerySchema = z.object({
  bom: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
})
