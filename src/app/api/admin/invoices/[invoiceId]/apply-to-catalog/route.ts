import { NextResponse } from 'next/server'
import { applyInvoiceToCatalog } from '@/services/invoice-catalog.service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const summary = await applyInvoiceToCatalog(invoiceId)
    return NextResponse.json({ summary })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Application impossible.'
    let status = 400
    if (/introuvable|invalide/.test(message)) status = 404
    else if (/non validée|déjà appliquée/.test(message)) status = 409
    else if (/template|colonne quantité|stock/.test(message)) status = 422
    return NextResponse.json({ error: 'apply_to_catalog_failed', message }, { status })
  }
}
