import { NextResponse } from 'next/server'
import { listProductsQuerySchema } from '@/lib/validations/catalog.schema'
import { listCatalogProducts } from '@/services/catalog-product.service'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = listProductsQuerySchema.safeParse(Object.fromEntries(url.searchParams))

  if (!query.success) {
    return NextResponse.json({ error: 'invalid_query', issues: query.error.issues }, { status: 400 })
  }

  try {
    const template = await getActiveTemplate()

    if (!template) {
      return NextResponse.json(
        { error: 'no_active_template', message: NO_ACTIVE_TEMPLATE_MESSAGE },
        { status: 404 },
      )
    }

    const result = await listCatalogProducts(query.data)

    return NextResponse.json({
      ...result,
      columns: [...template.columns]
        .sort((a, b) => a.position - b.position)
        .map((column) => column.name),
      delimiter: template.delimiter,
      templateName: template.name,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture du catalogue impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}
