import { NextResponse } from 'next/server'
import { connectToDatabase } from '@/lib/mongodb'
import { CsvImport } from '@/models/CsvImport'

export async function GET() {
  try {
    await connectToDatabase()
    const docs = await CsvImport.find({})
      .select('originalFileName columns rowCount encoding delimiter createdAt')
      .sort({ createdAt: -1 })
      .lean()

    return NextResponse.json({
      imports: docs.map((doc) => ({
        id: String(doc._id),
        originalFileName: doc.originalFileName,
        columnCount: doc.columns?.length ?? 0,
        rowCount: doc.rowCount,
        delimiter: doc.delimiter,
        encoding: doc.encoding,
        createdAt: doc.createdAt,
      })),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Lecture impossible.'
    return NextResponse.json({ error: 'database_error', message }, { status: 500 })
  }
}
