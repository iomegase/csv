import { z } from 'zod'

export const loginSchema = z.object({
  password: z.string().min(1, 'Mot de passe requis.'),
})

export type LoginInput = z.infer<typeof loginSchema>
