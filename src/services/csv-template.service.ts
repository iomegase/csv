import mongoose, { isValidObjectId } from 'mongoose'
import { readFile } from 'node:fs/promises'
import { connectToDatabase } from '@/lib/mongodb'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CsvImport } from '@/models/CsvImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import {
  buildColumnDefinitions,
  parseCsvBuffer,
  type ParsedCsv,
} from '@/services/csv-parser.service'

/** Levée quand les colonnes du template visé manquent au catalogue (D6). */
export class TemplateColumnsMissingError extends Error {
  constructor(readonly missingColumns: string[]) {
    super(
      `Colonnes absentes du catalogue : ${missingColumns.join(', ')}. ` +
        'Réactivez avec force: true, ou rejouez l’import d’origine.',
    )
    this.name = 'TemplateColumnsMissingError'
  }
}

const CATALOG_SAMPLE_SIZE = 100

export async function getActiveTemplate() {
  await connectToDatabase()
  return CsvTemplate.findOne({ isActive: true }).lean()
}

/**
 * Colonnes du template absentes des clés réellement présentes dans csvData.
 *
 * L'échantillon porte sur le catalogue et non sur le template précédent : un
 * produit peut avoir été créé par une facture sans porter toutes les colonnes.
 */
async function computeMissingColumns(
  columnNames: string[],
  session?: mongoose.ClientSession,
): Promise<string[]> {
  const sample = await CatalogProduct.find({ isDeleted: false })
    .limit(CATALOG_SAMPLE_SIZE)
    .select('csvData')
    .session(session ?? null)
    .lean()

  // Catalogue vide : rien à contredire, donc rien à refuser.
  if (!sample.length) return []

  const present = new Set<string>()
  for (const product of sample) {
    for (const key of Object.keys((product.csvData ?? {}) as Record<string, unknown>)) {
      present.add(key)
    }
  }

  return columnNames.filter((name) => !present.has(name))
}

export async function findMissingColumns(templateId: string): Promise<string[]> {
  await connectToDatabase()
  const template = await CsvTemplate.findById(templateId).lean()
  if (!template) throw new Error('Template introuvable.')
  return computeMissingColumns(template.columns.map((column) => column.name))
}

export async function activateTemplate(
  templateId: string,
  options: { force?: boolean } = {},
): Promise<void> {
  if (!isValidObjectId(templateId)) {
    throw new Error('Identifiant de template invalide.')
  }

  await connectToDatabase()
  const session = await mongoose.startSession()

  try {
    await session.withTransaction(async () => {
      const template = await CsvTemplate.findById(templateId).session(session)

      if (!template) {
        throw new Error('Template introuvable.')
      }

      // Le contrôle est DANS la transaction : une synchronisation concurrente
      // ne peut pas invalider le constat entre la vérification et l'écriture.
      if (!options.force) {
        const missing = await computeMissingColumns(
          template.columns.map((column) => column.name),
          session,
        )
        if (missing.length) throw new TemplateColumnsMissingError(missing)
      }

      await CsvTemplate.updateMany(
        { _id: { $ne: template._id } },
        { $set: { isActive: false } },
        { session },
      )

      await CsvTemplate.findByIdAndUpdate(
        template._id,
        { $set: { isActive: true } },
        { session, runValidators: true },
      )
    })
  } finally {
    await session.endSession()
  }
}

export async function createTemplateFromImport(
  importId: string,
  name?: string,
): Promise<{ templateId: string; parsed: ParsedCsv }> {
  if (!isValidObjectId(importId)) {
    throw new Error('Identifiant d’import invalide.')
  }

  await connectToDatabase()

  const csvImport = await CsvImport.findById(importId)
  if (!csvImport) {
    throw new Error('Import CSV introuvable.')
  }

  // Rejoue les octets d'origine : c'est la seule façon de retrouver l'encodage
  // exact et les valeurs telles qu'elles étaient dans le fichier.
  const buffer = await readFile(csvImport.filePath)
  const parsed = parseCsvBuffer(buffer)

  const template = await CsvTemplate.create({
    name: name?.trim() || defaultTemplateName(csvImport.originalFileName),
    sourceFileName: csvImport.originalFileName,
    sourceImportId: csvImport._id,
    columns: buildColumnDefinitions(parsed),
    delimiter: parsed.delimiter,
    encoding: parsed.encoding,
    isActive: false,
  })

  return { templateId: String(template._id), parsed }
}

function defaultTemplateName(fileName: string): string {
  const base = fileName.replace(/\.csv$/i, '')
  const date = new Date().toLocaleDateString('fr-FR')
  return `${base} — ${date}`
}
