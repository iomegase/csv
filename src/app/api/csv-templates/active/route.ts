import { NextResponse } from 'next/server'
import { getActiveTemplate } from '@/services/csv-template.service'
import { NO_ACTIVE_TEMPLATE_MESSAGE } from '@/lib/messages'

export async function GET() {
  try {
    const template = await getActiveTemplate()

    if (!template) {
      return NextResponse.json(
        { error: 'no_active_template', message: NO_ACTIVE_TEMPLATE_MESSAGE },
        { status: 404 },
      )
    }

    return NextResponse.json({ template })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture du template impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}
