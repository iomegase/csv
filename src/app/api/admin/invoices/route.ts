import { NextResponse } from 'next/server'
import { csvUploadSchema } from '@/lib/validations/csv-template.schema'
import { createInvoiceImport, listInvoiceImports, startAnalysis } from '@/services/invoice-import.service'

export async function GET() {
  try {
    return NextResponse.json({ invoices: await listInvoiceImports() })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}

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
    const family = formData.get('family')
    const supplier = formData.get('supplier')
    const result = await createInvoiceImport({
      buffer: Buffer.from(await file.arrayBuffer()),
      originalFileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      family: typeof family === 'string' ? family : null,
      supplier: typeof supplier === 'string' ? supplier : null,
    })

    // Lance l'analyse dès l'import ; le client suivra le statut via GET.
    await startAnalysis(result.invoiceId).catch(() => undefined)

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Import impossible.'
    return NextResponse.json({ error: 'invoice_import_failed', message }, { status: 400 })
  }
}
