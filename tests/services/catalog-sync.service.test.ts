import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { syncCatalogFromCsv } from '@/services/catalog-sync.service'
import type { ParsedCsv } from '@/services/csv-parser.service'

withTestDatabase()

const COLUMNS = ['Identifiant', 'Nom', 'Fournisseur', 'Référence', 'Code barre']

function parsed(rows: Record<string, string>[]): ParsedCsv {
  return { columns: COLUMNS, rows, delimiter: ';', encoding: 'utf-8', encodingConfident: true }
}

async function makeTemplate() {
  const template = await CsvTemplate.create({
    name: 'T',
    sourceFileName: 't.csv',
    columns: COLUMNS.map((name, position) => ({ name, position, detectedType: 'string' })),
  })
  return String(template._id)
}

const row = (over: Partial<Record<string, string>> = {}) => ({
  Identifiant: '',
  Nom: 'Vase',
  Fournisseur: 'Fournisseur A',
  Référence: '',
  'Code barre': '',
  ...over,
})

describe('syncCatalogFromCsv', () => {
  it('crée les produits et remplit csvData avec les noms de colonnes du template', async () => {
    const templateId = await makeTemplate()

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'VASE-001' })]))

    expect(summary.created).toBe(1)
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.csvData).toMatchObject({ Nom: 'Vase', Référence: 'VASE-001' })
    expect(product!.reference).toBe('VASE-001')
  })

  it('met à jour par référence sans dupliquer', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'VASE-001' })]))

    const summary = await syncCatalogFromCsv(
      templateId,
      parsed([row({ Référence: 'VASE-001', Nom: 'Vase rouge' })]),
    )

    expect(summary.updated).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
    expect((await CatalogProduct.findOne({}).lean())!.csvData).toMatchObject({ Nom: 'Vase rouge' })
  })

  it('respecte l’ordre de priorité : identifiant avant référence', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Identifiant: 'A1', Référence: 'REF-1' })]))

    // Même identifiant, référence différente : c'est l'identifiant qui gagne.
    const summary = await syncCatalogFromCsv(
      templateId,
      parsed([row({ Identifiant: 'A1', Référence: 'REF-2' })]),
    )

    expect(summary.updated).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })

  it('ne fusionne jamais deux produits aux noms similaires', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase décoratif' })]))

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase décoratif bleu' })]))

    expect(summary.created).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(2)
  })

  it('fait correspondre nom + fournisseur malgré casse et accents', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase décoratif' })]))

    const summary = await syncCatalogFromCsv(
      templateId,
      parsed([row({ Nom: '  VASE DECORATIF  ' })]),
    )

    expect(summary.updated).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })

  it('ne fait pas correspondre deux produits sur une valeur vide partagée', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Vase', Fournisseur: '' })]))

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Nom: 'Bol', Fournisseur: '' })]))

    expect(summary.created).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(2)
  })

  it('signale une correspondance ambiguë et crée un nouveau produit (D4)', async () => {
    const templateId = await makeTemplate()
    // Deux produits partageant le même code-barres : le catalogue est ambigu.
    await CatalogProduct.create([
      { templateId, barcode: '370', csvData: { Nom: 'A', 'Code barre': '370' } },
      { templateId, barcode: '370', csvData: { Nom: 'B', 'Code barre': '370' } },
    ])

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ 'Code barre': '370' })]))

    expect(summary.ambiguous).toHaveLength(1)
    expect(summary.ambiguous[0].matchedBy).toBe('barcode')
    expect(summary.ambiguous[0].candidateIds).toHaveLength(2)
    expect(summary.created).toBe(1)
  })

  it('n’écrase pas originalCsvData au ré-import (D3)', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1', Nom: 'Nom initial' })]))

    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1', Nom: 'Nom modifié' })]))

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.originalCsvData as Record<string, unknown>).Nom).toBe('Nom initial')
    expect((product!.csvData as Record<string, unknown>).Nom).toBe('Nom modifié')
  })

  it('ne supprime ni ne marque un produit absent du CSV (D2)', async () => {
    const templateId = await makeTemplate()
    await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1' }), row({ Référence: 'R2' })]))

    const summary = await syncCatalogFromCsv(templateId, parsed([row({ Référence: 'R1' })]))

    expect(summary.missingFromCsv).toHaveLength(1)
    expect(await CatalogProduct.countDocuments({ isDeleted: true })).toBe(0)
    expect(await CatalogProduct.countDocuments({})).toBe(2)
  })

  it('re-pointe templateId vers le template actif (D1)', async () => {
    const premier = await makeTemplate()
    await syncCatalogFromCsv(premier, parsed([row({ Référence: 'R1' })]))

    const second = await makeTemplate()
    await syncCatalogFromCsv(second, parsed([row({ Référence: 'R1' })]))

    const product = await CatalogProduct.findOne({}).lean()
    expect(String(product!.templateId)).toBe(second)
  })

  it('conserve les colonnes supplémentaires dans csvData', async () => {
    const templateId = await makeTemplate()
    const withExtra = { ...row({ Référence: 'R1' }), 'Colonne Maison': 'valeur' }

    await syncCatalogFromCsv(templateId, {
      ...parsed([withExtra]),
      columns: [...COLUMNS, 'Colonne Maison'],
    })

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.csvData as Record<string, unknown>)['Colonne Maison']).toBe('valeur')
  })
})
