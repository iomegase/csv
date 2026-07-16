import { NextResponse } from 'next/server'
import { exportQuerySchema } from '@/lib/validations/catalog.schema'
import { exportCatalogCsv } from '@/services/catalog-export.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = exportQuerySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!query.success) {
    return NextResponse.json({ error: 'invalid_query', issues: query.error.issues }, { status: 400 })
  }

  try {
    const { csv, fileName } = await exportCatalogCsv({ bom: query.data.bom })

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export impossible.'
    const status = message === NO_ACTIVE_TEMPLATE_MESSAGE ? 404 : 500
    return NextResponse.json({ error: 'export_failed', message }, { status })
  }
}
