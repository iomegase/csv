import { NextResponse } from 'next/server'
import { bulkUpdateSchema } from '@/lib/validations/bulk.schema'
import { bulkUpdateProducts } from '@/services/catalog-product.service'

export async function POST(request: Request) {
  const parsed = bulkUpdateSchema.safeParse(await request.json().catch(() => null))

  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }

  try {
    const result = await bulkUpdateProducts(parsed.data.ids, parsed.data.action)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Modification impossible.'
    return NextResponse.json({ error: 'bulk_update_failed', message }, { status: 500 })
  }
}
