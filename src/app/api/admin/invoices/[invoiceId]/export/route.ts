import { NextResponse } from 'next/server'
import { exportInvoiceCsv } from '@/services/invoice-import.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const { csv, fileName } = await exportInvoiceCsv(invoiceId)
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export impossible.'
    const status = message === NO_ACTIVE_TEMPLATE_MESSAGE ? 409 : /introuvable|invalide/.test(message) ? 404 : 500
    return NextResponse.json({ error: 'export_failed', message }, { status })
  }
}
