import { NextResponse } from 'next/server'
import { purgeSchema } from '@/lib/validations/purge.schema'
import { purgeAllData } from '@/services/data-purge.service'

export async function POST(request: Request) {
  const parsed = purgeSchema.safeParse(await request.json().catch(() => null))

  // Sans le mot de confirmation exact, on ne touche à rien : le garde-fou de
  // l'UI est doublé côté serveur, pour qu'un appel direct ne suffise pas.
  if (!parsed.success) {
    return NextResponse.json({ error: 'confirmation_requise' }, { status: 400 })
  }

  try {
    const { deleted } = await purgeAllData()
    return NextResponse.json({ deleted })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Purge impossible.'
    return NextResponse.json({ error: 'purge_failed', message }, { status: 500 })
  }
}
