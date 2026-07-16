import { NextResponse } from 'next/server'
import { deleteInvoiceImport, getInvoiceImport, refreshAnalysis } from '@/services/invoice-import.service'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    // Fait avancer l'analyse si elle est en cours (un sondage Azure par appel).
    await refreshAnalysis(invoiceId).catch(() => undefined)
    return NextResponse.json({ invoice: await getInvoiceImport(invoiceId) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 500
    return NextResponse.json({ error: 'invoice_read_failed', message }, { status })
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    await deleteInvoiceImport(invoiceId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suppression impossible.'
    return NextResponse.json({ error: 'invoice_delete_failed', message }, { status: 400 })
  }
}
