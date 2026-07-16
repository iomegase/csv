import { z } from 'zod'
import { isValidObjectId } from 'mongoose'

export const objectIdSchema = z
  .string()
  .refine((value) => isValidObjectId(value), { message: 'Identifiant MongoDB invalide.' })

export const fromImportSchema = z.object({
  importId: objectIdSchema,
  name: z.string().trim().min(1).max(200).optional(),
})

export const activateTemplateSchema = z.object({
  force: z.boolean().optional().default(false),
})

export const csvUploadSchema = z.object({
  file: z.instanceof(File, { message: 'Aucun fichier reçu sous la clé « file ».' }),
})

export type FromImportInput = z.infer<typeof fromImportSchema>
export type ActivateTemplateInput = z.infer<typeof activateTemplateSchema>
export type CsvUploadInput = z.infer<typeof csvUploadSchema>
