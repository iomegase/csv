import { describe, expect, it, vi } from 'vitest'
import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { withTestDatabase } from '../helpers/db'
import { assertCsvFile, createCsvImport } from '@/services/csv-import.service'
import { CsvImport } from '@/models/CsvImport'

// Même chemin que UPLOAD_DIR dans le service : non exporté, donc reconstruit
// ici pour observer le disque sans dépendre d'un mock de fs/promises.
const UPLOAD_DIR = join(process.cwd(), 'uploads', 'csv')

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

  it('supprime le fichier écrit sur disque si la création du document Mongo échoue', async () => {
    const before = new Set(await readdir(UPLOAD_DIR).catch(() => []))

    const createSpy = vi
      .spyOn(CsvImport, 'create')
      .mockRejectedValueOnce(new Error('échec Mongo simulé'))

    await expect(
      createCsvImport({ buffer: csv(), originalFileName: 'produits.csv', mimeType: 'text/csv' }),
    ).rejects.toThrow('échec Mongo simulé')

    // Le fichier a bien été écrit (create a été appelé après writeFile), puis
    // supprimé par le catch : aucun fichier neuf ne doit subsister.
    expect(createSpy).toHaveBeenCalled()
    createSpy.mockRestore()

    const after = await readdir(UPLOAD_DIR).catch(() => [])
    const newFiles = after.filter((name) => !before.has(name))
    expect(newFiles).toEqual([])
  })
})
