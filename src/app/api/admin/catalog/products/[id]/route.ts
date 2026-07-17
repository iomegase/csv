import { NextResponse } from 'next/server'
import { patchProductSchema } from '@/lib/validations/catalog-edit.schema'
import { softDeleteCatalogProduct, updateCatalogProductCells } from '@/services/catalog-product.service'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const parsed = patchProductSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    await updateCatalogProductCells(id, parsed.data.cells)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Mise à jour impossible.'
    const status = /invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'update_failed', message }, { status })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  try {
    await softDeleteCatalogProduct(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Suppression impossible.'
    const status = /invalide/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'delete_failed', message }, { status })
  }
}
