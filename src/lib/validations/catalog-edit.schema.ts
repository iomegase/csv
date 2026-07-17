import { z } from 'zod'

// Une cellule est une chaîne ou null (valeur absente). Jamais un nombre : le
// catalogue stocke les valeurs telles quelles.
const cell = z.union([z.string(), z.null()])

export const patchProductSchema = z.object({
  cells: z.record(z.string(), cell),
})

export const createProductSchema = z.object({
  csvData: z.record(z.string(), cell).default({}),
})
