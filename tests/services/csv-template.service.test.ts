import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import {
  TemplateColumnsMissingError,
  activateTemplate,
  getActiveTemplate,
} from '@/services/csv-template.service'

withTestDatabase()

async function makeTemplate(columnNames: string[], isActive = false) {
  return CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    isActive,
    columns: columnNames.map((name, position) => ({ name, position, detectedType: 'string' })),
  })
}

describe('activateTemplate', () => {
  it("désactive l'ancien template et active le nouveau", async () => {
    const ancien = await makeTemplate(['Nom'], true)
    const nouveau = await makeTemplate(['Nom'])

    await activateTemplate(String(nouveau._id))

    expect((await CsvTemplate.findById(ancien._id))!.isActive).toBe(false)
    expect((await CsvTemplate.findById(nouveau._id))!.isActive).toBe(true)
    expect(await CsvTemplate.countDocuments({ isActive: true })).toBe(1)
  })

  it('refuse un template dont les colonnes manquent au catalogue', async () => {
    const source = await makeTemplate(['Nom'], true)
    await CatalogProduct.create({
      templateId: source._id,
      csvData: { Nom: 'Vase' },
    })

    const cible = await makeTemplate(['Nom', 'Code barre', "Prix d'achat"])

    const error = await activateTemplate(String(cible._id)).catch((e) => e)

    expect(error).toBeInstanceOf(TemplateColumnsMissingError)
    expect(error.missingColumns).toEqual(['Code barre', "Prix d'achat"])

    // Le refus ne doit rien avoir activé.
    expect((await CsvTemplate.findById(cible._id))!.isActive).toBe(false)
    expect((await CsvTemplate.findById(source._id))!.isActive).toBe(true)
  })

  it('active malgré tout avec force', async () => {
    const source = await makeTemplate(['Nom'], true)
    await CatalogProduct.create({ templateId: source._id, csvData: { Nom: 'Vase' } })
    const cible = await makeTemplate(['Nom', 'Code barre'])

    await activateTemplate(String(cible._id), { force: true })

    expect((await CsvTemplate.findById(cible._id))!.isActive).toBe(true)
  })

  it('n’applique aucun contrôle quand le catalogue est vide', async () => {
    const template = await makeTemplate(['Nom', 'Code barre'])
    await activateTemplate(String(template._id))
    expect((await CsvTemplate.findById(template._id))!.isActive).toBe(true)
  })

  it('ne laisse aucun état partiel si le template cible n’existe pas', async () => {
    const ancien = await makeTemplate(['Nom'], true)
    const absent = '507f1f77bcf86cd799439011'

    await expect(activateTemplate(absent)).rejects.toThrow(/introuvable/)

    // La transaction doit avoir annulé la désactivation de l'ancien.
    expect((await CsvTemplate.findById(ancien._id))!.isActive).toBe(true)
  })
})

describe('getActiveTemplate', () => {
  it('rend null quand aucun template n’est actif', async () => {
    await makeTemplate(['Nom'])
    expect(await getActiveTemplate()).toBeNull()
  })

  it('rend le template actif', async () => {
    const actif = await makeTemplate(['Nom'], true)
    expect(String((await getActiveTemplate())!._id)).toBe(String(actif._id))
  })
})
