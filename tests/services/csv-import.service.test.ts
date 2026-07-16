import { describe, expect, it } from 'vitest'
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

  it('refuse un type MIME interdit malgré une extension .csv', () => {
    expect(() => assertCsvFile('produits.csv', 'application/pdf', 1000)).toThrow(/refusé/)
  })
})

describe('createCsvImport', () => {
  it('enregistre les métadonnées et stocke les octets bruts dans le document', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    expect(result.columns).toEqual(['Nom', 'Prix'])
    expect(result.rowCount).toBe(1)

    const doc = await CsvImport.findById(result.importId)
    expect(doc).not.toBeNull()

    // Les octets exacts doivent survivre en base : c'est ce qui permet de
    // re-décoder fidèlement à la création du template, sans dépendre d'un
    // disque local (indisponible en serverless).
    expect(Buffer.from(doc!.rawContent).equals(csv())).toBe(true)
    expect(doc!.fileSize).toBe(csv().byteLength)
  })

  it('ne stocke pas les lignes dans le document', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: 'produits.csv',
      mimeType: 'text/csv',
    })

    const doc = await CsvImport.findById(result.importId).lean()
    expect(doc).not.toHaveProperty('rows')
  })

  it('nettoie le nom de fichier d’origine', async () => {
    const result = await createCsvImport({
      buffer: csv(),
      originalFileName: '../../../etc/passwd.csv',
      mimeType: 'text/csv',
    })

    const doc = await CsvImport.findById(result.importId)
    expect(doc!.originalFileName).toBe('passwd.csv')
  })
})
