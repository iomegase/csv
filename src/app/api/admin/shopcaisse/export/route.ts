import { NextResponse } from 'next/server'
import { buildExportBundle, ExportBlockedError } from '@/services/shopcaisse-bundle.service'

export async function GET() {
  try {
    const { zip, fileName } = await buildExportBundle()

    return new NextResponse(new Uint8Array(zip), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (error) {
    // 409 et non 400 : la requête est correcte, c'est l'état du tableau maître
    // qui interdit l'export. La validation part avec, pour que l'utilisateur
    // sache quoi corriger.
    if (error instanceof ExportBlockedError) {
      return NextResponse.json(
        { error: 'export_blocked', message: error.message, validation: error.validation },
        { status: 409 },
      )
    }

    const message = error instanceof Error ? error.message : 'Export impossible.'
    return NextResponse.json({ error: 'export_failed', message }, { status: 500 })
  }
}
