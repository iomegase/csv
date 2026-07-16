import { NextResponse } from 'next/server'
import { startAnalysis } from '@/services/invoice-import.service'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> },
) {
  const { invoiceId } = await params
  try {
    const doc = await startAnalysis(invoiceId)
    return NextResponse.json({ status: doc.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Analyse impossible.'
    const status = /introuvable|invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'analyze_failed', message }, { status })
  }
}
