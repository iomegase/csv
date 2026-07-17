import { z } from 'zod'

/** Le mot que l'utilisateur doit taper pour confirmer la purge. */
export const PURGE_CONFIRM_WORD = 'EFFACER'

export const purgeSchema = z.object({
  confirm: z.literal(PURGE_CONFIRM_WORD),
})
