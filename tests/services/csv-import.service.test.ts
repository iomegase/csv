import { describe, expect, it } from 'vitest'
import { readFile, rm } from 'node:fs/promises'
import { withTestDatabase } from '../helpers/db'
import { assertCsvFile, createCsvImport } from '@/services/csv-import.service'
import { CsvImport } from '@/models/CsvImport'

withTestDatabase()

const csv = () => Buffer.from('Nom;Prix\r\nVase;12,50\r\n', 'utf-8')

describe('assertCsvFile', () => {
  it('accepte un CSV', () => {
    expect(() => assertCsvFile('produits.csv', 'text/csv', 1000)).not.toThrow()
  })

  it('refuse une extension non CSV', () => {
    expect(() => assertCsvFile('facture.pdf', 'application/pdf', 1000)).toThrow(/CSV/)
  })

  it('refuse un fichier vide', () => {
    expect(() => assertCsvFile('produits.csv', 'text/csv', 0)).toThrow(/vide/)
  })

  it('refuse un fichier trop volumineux', () => {
    expect(() => assertCsvFile('produits.csv', 'text/csv', 11 * 1024 * 1024)).toThrow(/volumineux/)
  })
})

describe('createCsvImport', () => {
  it('enregistre les métadonnées et écrit le fichier brut sur disque', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    expect(result.columns).toEqual(['Nom', 'Prix'])
    expect(result.rowCount).toBe(1)

    const doc = await CsvImport.findById(result.importId)
    expect(doc).not.toBeNull()

    // Les octets exacts doivent survivre : c'est ce qui permettra de
    // re-décoder fidèlement à la création du template.
    expect(await readFile(doc!.filePath)).toEqual(csv())
    await rm(doc!.filePath, { force: true })
  })

  it('ne stocke pas les lignes dans le document', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    const doc = await CsvImport.findById(result.importId).lean()
    expect(doc).not.toHaveProperty('rows')
    await rm((doc as { filePath: string }).filePath, { force: true })
  })

  it('nettoie le nom de fichier pour empêcher une traversée de répertoire', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: '../../../etc/passwd.csv',
      mimeType: 'text/csv',
    })

    const doc = await CsvImport.findById(result.importId)
    expect(doc!.filePath).not.toContain('..')
    expect(doc!.originalFileName).toBe('passwd.csv')
    await rm(doc!.filePath, { force: true })
  })
})
