import { NextResponse } from 'next/server'
import { validateInvoice } from '@/services/invoice-import.service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const doc = await validateInvoice(invoiceId)
    return NextResponse.json({ validatedAt: doc.validatedAt })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Validation impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'validate_failed', message }, { status })
  }
}
