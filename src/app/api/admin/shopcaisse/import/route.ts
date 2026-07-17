import { NextResponse } from 'next/server'
import { shopcaisseImportSchema } from '@/lib/validations/shopcaisse.schema'
import { importCsvIntoMaster } from '@/services/shopcaisse-import.service'

export async function POST(request: Request) {
  const parsed = shopcaisseImportSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const summary = await importCsvIntoMaster(parsed.data.importId, parsed.data.kind)
    return NextResponse.json({ summary }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import impossible.'
    return NextResponse.json({ error: 'import_failed', message }, { status: 400 })
  }
}
