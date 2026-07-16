import { NextResponse } from 'next/server'
import { fromImportSchema } from '@/lib/validations/csv-template.schema'
import { activateTemplate, createTemplateFromImport } from '@/services/csv-template.service'
import { syncCatalogFromCsv } from '@/services/catalog-sync.service'

export async function POST(request: Request) {
  const parsedBody = fromImportSchema.safeParse(await request.json().catch(() => null))

  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsedBody.error.issues },
      { status: 400 },
    )
  }

  try {
    const { templateId, parsed } = await createTemplateFromImport(
      parsedBody.data.importId,
      parsedBody.data.name,
    )

    // La synchronisation précède l'activation : le contrôle des colonnes de
    // activateTemplate compare aux clés du catalogue, qui doivent donc déjà
    // porter les colonnes du nouveau template.
    const summary = await syncCatalogFromCsv(templateId, parsed)
    await activateTemplate(templateId)

    return NextResponse.json({ templateId, summary }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Création du template impossible.'
    return NextResponse.json({ error: 'from_import_failed', message }, { status: 400 })
  }
}
