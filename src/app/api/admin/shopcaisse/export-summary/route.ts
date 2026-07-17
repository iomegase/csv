import { NextResponse } from 'next/server'
import { validateMaster } from '@/services/shopcaisse-validation.service'

export async function GET() {
  try {
    return NextResponse.json({ validation: await validateMaster() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Résumé impossible.'
    return NextResponse.json({ error: 'summary_failed', message }, { status: 500 })
  }
}
