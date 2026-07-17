import { NextResponse } from 'next/server'
import { createProductSchema } from '@/lib/validations/catalog-edit.schema'
import { createCatalogProduct } from '@/services/catalog-product.service'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const parsed = createProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    const template = await getActiveTemplate()
    if (!template) {
      return NextResponse.json({ error: 'no_active_template', message: NO_ACTIVE_TEMPLATE_MESSAGE }, { status: 404 })
    }
    const id = await createCatalogProduct(String(template._id), parsed.data.csvData)
    return NextResponse.json({ id }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Création impossible.'
    return NextResponse.json({ error: 'create_failed', message }, { status: 400 })
  }
}
