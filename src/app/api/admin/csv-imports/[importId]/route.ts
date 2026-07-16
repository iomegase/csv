import { NextResponse } from 'next/server'
import { deleteCsvImport } from '@/services/csv-import.service'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ importId: string }> },
) {
  const { importId } = await params
  try {
    await deleteCsvImport(importId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suppression impossible.'
    const status = /invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'csv_import_delete_failed', message }, { status })
  }
}
