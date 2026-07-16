import { NextResponse } from 'next/server'
import { createCsvImport } from '@/services/csv-import.service'
import { csvUploadSchema } from '@/lib/validations/csv-template.schema'

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const parsed = csvUploadSchema.safeParse(Object.fromEntries(formData))

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'missing_file', message: 'Aucun fichier reçu sous la clé « file ».' },
        { status: 400 },
      )
    }

    const { file } = parsed.data

    const result = await createCsvImport({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalFileName: file.name,
      mimeType: file.type || 'application/octet-stream',
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import impossible.'
    return NextResponse.json({ error: 'csv_import_failed', message }, { status: 400 })
  }
}
