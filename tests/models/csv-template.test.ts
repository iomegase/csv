import { beforeAll, describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'

withTestDatabase()

describe('CsvTemplate', () => {
  const base = {
    name: 'Produits',
    sourceFileName: 'produits.csv',
    columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
  }

  beforeAll(async () => {
    await CsvTemplate.init()
  })

  it('applique les valeurs par défaut ShopCaisse', async () => {
    const template = await CsvTemplate.create(base)

    expect(template.delimiter).toBe(';')
    expect(template.encoding).toBe('utf-8')
    expect(template.isActive).toBe(false)
  })

  it("interdit deux templates actifs au niveau de la base", async () => {
    await CsvTemplate.create({ ...base, isActive: true })

    // L'index partiel unique est la seule garantie contre deux activations
    // concurrentes : le code applicatif seul ne suffirait pas.
    await expect(CsvTemplate.create({ ...base, isActive: true })).rejects.toThrow(
      /E11000|duplicate key/,
    )
  })

  it('autorise plusieurs templates inactifs', async () => {
    await CsvTemplate.create({ ...base, isActive: false })
    await CsvTemplate.create({ ...base, isActive: false })

    expect(await CsvTemplate.countDocuments({})).toBe(2)
  })

  it('refuse un detectedType hors énumération', async () => {
    await expect(
      CsvTemplate.create({
        ...base,
        columns: [{ name: 'Nom', position: 0, detectedType: 'devine' }],
      }),
    ).rejects.toThrow(/detectedType/)
  })
})
