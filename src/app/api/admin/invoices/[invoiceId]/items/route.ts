import { NextResponse } from 'next/server'
import { updateItemsSchema } from '@/lib/validations/invoice.schema'
import { updateInvoiceItems } from '@/services/invoice-import.service'

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  const parsed = updateItemsSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const doc = await updateInvoiceItems(invoiceId, parsed.data.items)
    return NextResponse.json({ items: doc.items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mise à jour impossible.'
    const status = /verrouillée|validée/.test(message) ? 409 : /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'items_update_failed', message }, { status })
  }
}
