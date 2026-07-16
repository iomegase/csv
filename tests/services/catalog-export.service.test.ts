import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { exportCatalogCsv, serializeCsvValue } from '@/services/catalog-export.service'

withTestDatabase()

describe('serializeCsvValue', () => {
  it('rend une cellule vide pour null et undefined', () => {
    expect(serializeCsvValue(null)).toBe('')
    expect(serializeCsvValue(undefined)).toBe('')
  })

  it('échappe le séparateur, les guillemets et les sauts de ligne', () => {
    expect(serializeCsvValue('a;b')).toBe('"a;b"')
    expect(serializeCsvValue('dit "bonjour"')).toBe('"dit ""bonjour"""')
    expect(serializeCsvValue('deux\nlignes')).toBe('"deux\nlignes"')
  })

  it('laisse une valeur simple intacte', () => {
    expect(serializeCsvValue('Vase')).toBe('Vase')
    expect(serializeCsvValue(12.5)).toBe('12.5')
  })

  it('n’échappe pas une virgule quand le séparateur est le point-virgule', () => {
    expect(serializeCsvValue('12,50', ';')).toBe('12,50')
  })
})

describe('exportCatalogCsv', () => {
  async function seedTemplate(columns: string[]) {
    return CsvTemplate.create({
      name: 'T',
      sourceFileName: 'produits.csv',
      isActive: true,
      delimiter: ';',
      columns: columns.map((name, position) => ({ name, position, detectedType: 'string' })),
    })
  }

  it('respecte les colonnes, leur ordre et le séparateur du template actif', async () => {
    const template = await seedTemplate(['Référence', 'Nom', 'Code barre'])
    await CatalogProduct.create({
      templateId: template._id,
      csvData: { Nom: 'Vase décoratif', Référence: 'ABC-001', 'Code barre': null },
    })

    const { csv } = await exportCatalogCsv({ bom: false })

    // Le code-barres est vide parce qu'il vaut null — jamais « 0 » ni « N/A ».
    expect(csv).toBe('Référence;Nom;Code barre\r\nABC-001;Vase décoratif;\r\n')
  })

  it('ajoute le BOM par défaut', async () => {
    const template = await seedTemplate(['Nom'])
    await CatalogProduct.create({ templateId: template._id, csvData: { Nom: 'Vase' } })

    expect((await exportCatalogCsv()).csv.startsWith('﻿')).toBe(true)
  })

  it('rend une cellule vide pour une colonne absente de csvData (D6 forcé)', async () => {
    const template = await seedTemplate(['Nom', "Prix d'achat"])
    await CatalogProduct.create({ templateId: template._id, csvData: { Nom: 'Vase' } })

    expect((await exportCatalogCsv({ bom: false })).csv).toBe("Nom;Prix d'achat\r\nVase;\r\n")
  })

  it('exclut les produits supprimés', async () => {
    const template = await seedTemplate(['Nom'])
    await CatalogProduct.create({
      templateId: template._id,
      csvData: { Nom: 'Vase' },
      isDeleted: true,
    })

    expect((await exportCatalogCsv({ bom: false })).csv).toBe('Nom\r\n')
  })

  it('échoue explicitement sans template actif', async () => {
    await expect(exportCatalogCsv()).rejects.toThrow(/Aucun template CSV actif/)
  })
})
