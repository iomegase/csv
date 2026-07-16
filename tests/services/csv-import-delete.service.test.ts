import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvImport } from '@/models/CsvImport'
import { deleteCsvImport } from '@/services/csv-import.service'

withTestDatabase()

describe('deleteCsvImport', () => {
  it('supprime un import existant', async () => {
    const doc = await CsvImport.create({
      originalFileName: 't.csv',
      rawContent: Buffer.from('Nom;Qté\nVase;1\n'),
      fileSize: 15,
      mimeType: 'text/csv',
      encoding: 'utf-8',
      delimiter: ';',
      columns: ['Nom', 'Qté'],
      rowCount: 1,
    })

    await deleteCsvImport(String(doc._id))

    expect(await CsvImport.countDocuments({})).toBe(0)
  })

  it('rejette un identifiant invalide', async () => {
    await expect(deleteCsvImport('pas-un-id')).rejects.toThrow(/invalide/)
  })
})
