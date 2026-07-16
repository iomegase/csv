import { NextResponse } from 'next/server'
import { activateTemplateSchema, objectIdSchema } from '@/lib/validations/csv-template.schema'
import { TemplateColumnsMissingError, activateTemplate } from '@/services/csv-template.service'

// Next 16 : params est une Promise. La signature synchrone de Next 14 compile
// mais échoue à l'exécution.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ templateId: string }> },
) {
  const { templateId } = await params

  if (!objectIdSchema.safeParse(templateId).success) {
    return NextResponse.json(
      { error: 'invalid_template_id', message: 'Identifiant de template invalide.' },
      { status: 400 },
    )
  }

  const body = activateTemplateSchema.safeParse(await request.json().catch(() => ({})))

  if (!body.success) {
    return NextResponse.json({ error: 'invalid_body', issues: body.error.issues }, { status: 400 })
  }

  try {
    await activateTemplate(templateId, { force: body.data.force })
    return NextResponse.json({ templateId, isActive: true })
  } catch (error) {
    if (error instanceof TemplateColumnsMissingError) {
      return NextResponse.json(
        {
          error: 'template_columns_missing_from_catalog',
          missingColumns: error.missingColumns,
          hint: 'Réactivez malgré tout avec force: true, ou rejouez l’import d’origine via from-import.',
        },
        { status: 409 },
      )
    }

    const message = error instanceof Error ? error.message : 'Activation impossible.'
    const status = /introuvable/.test(message) ? 404 : 400
    return NextResponse.json({ error: 'activation_failed', message }, { status })
  }
}
