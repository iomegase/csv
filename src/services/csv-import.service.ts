import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connectToDatabase } from '@/lib/mongodb'
import { CsvImport } from '@/models/CsvImport'
import { parseCsvBuffer } from '@/services/csv-parser.service'

export const MAX_CSV_BYTES = Number(process.env.MAX_CSV_BYTES ?? 10 * 1024 * 1024)

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'csv')

export interface CsvImportResult {
  importId: string
  columns: string[]
  rowCount: number
  encoding: string
  encodingConfident: boolean
  delimiter: string
}

export function assertCsvFile(fileName: string, mimeType: string, size: number): void {
  if (size === 0) {
    throw new Error('Le fichier est vide.')
  }

  if (size > MAX_CSV_BYTES) {
    throw new Error(
      `Fichier trop volumineux : ${Math.round(size / 1024 / 1024)} Mo pour une limite de ${Math.round(MAX_CSV_BYTES / 1024 / 1024)} Mo.`,
    )
  }

  if (!/\.csv$/i.test(fileName)) {
    throw new Error('Le fichier doit être un CSV (extension .csv attendue).')
  }

  // Les navigateurs et tableurs annoncent le CSV sous des types très variables,
  // et parfois sous application/octet-stream. On vérifie donc que le type n'est
  // pas manifestement autre chose, plutôt que d'exiger une liste blanche stricte.
  const forbidden = ['application/pdf', 'image/', 'application/zip']
  if (forbidden.some((prefix) => mimeType.startsWith(prefix))) {
    throw new Error(`Type de fichier refusé : ${mimeType}. Un CSV est attendu.`)
  }
}

export async function createCsvImport(input: {
  buffer: Buffer
  originalFileName: string
  mimeType: string
}): Promise<CsvImportResult> {
  // basename neutralise « ../ » : un nom de fichier vient du client et ne doit
  // jamais pouvoir désigner un chemin hors du dossier d'upload.
  const safeName = basename(input.originalFileName)

  assertCsvFile(safeName, input.mimeType, input.buffer.byteLength)

  const parsed = parseCsvBuffer(input.buffer)

  await connectToDatabase()
  await mkdir(UPLOAD_DIR, { recursive: true })

  const storedFileName = `${randomUUID()}.csv`
  const filePath = join(UPLOAD_DIR, storedFileName)

  await writeFile(filePath, input.buffer)

  try {
    const doc = await CsvImport.create({
      originalFileName: safeName,
      storedFileName,
      filePath,
      fileSize: input.buffer.byteLength,
      mimeType: input.mimeType,
      encoding: parsed.encoding,
      delimiter: parsed.delimiter,
      columns: parsed.columns,
      rowCount: parsed.rows.length,
    })

    return {
      importId: String(doc._id),
      columns: parsed.columns,
      rowCount: parsed.rows.length,
      encoding: parsed.encoding,
      encodingConfident: parsed.encodingConfident,
      delimiter: parsed.delimiter,
    }
  } catch (error) {
    // Sans ce nettoyage, un échec Mongo laisserait un fichier orphelin sur
    // disque, sans document pour le retrouver.
    await rm(filePath, { force: true })
    throw error
  }
}
