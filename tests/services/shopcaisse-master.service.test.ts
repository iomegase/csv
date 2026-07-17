import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvTemplate } from '@/models/CsvTemplate'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, MASTER_COLUMNS } from '@/lib/shopcaisse-columns'
import {
  ensureMasterTemplate,
  listMasterEntries,
  MASTER_TEMPLATE_NAME,
  normalizeSupprime,
  toMasterRow,
  withMovement,
} from '@/services/shopcaisse-master.service'

withTestDatabase()

describe('normalizeSupprime', () => {
  it('convertit Oui en 1', () => {
    expect(normalizeSupprime('Oui')).toBe('1')
    expect(normalizeSupprime('oui')).toBe('1')
    expect(normalizeSupprime('1')).toBe('1')
  })

  it('convertit Non en 0', () => {
    expect(normalizeSupprime('Non')).toBe('0')
    expect(normalizeSupprime('non')).toBe('0')
    expect(normalizeSupprime('0')).toBe('0')
  })

  it('traite le vide comme « non supprimé » — la seule règle qui comble un vide', () => {
    expect(normalizeSupprime('')).toBe('0')
    expect(normalizeSupprime(null)).toBe('0')
    expect(normalizeSupprime(undefined)).toBe('0')
  })
})

describe('toMasterRow', () => {
  it('range chaque valeur dans sa colonne maître', () => {
    const row = toMasterRow({ Nom: 'Café Latte', 'Code barre': '0037600', Référence: 'REF-001' })
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.codeBarre]).toBe('0037600')
    expect(row[COL.reference]).toBe('REF-001')
  })

  it('porte toujours les 22 colonnes', () => {
    expect(Object.keys(toMasterRow({ Nom: 'Café' }))).toEqual([...MASTER_COLUMNS])
  })

  it('conserve les cellules vides sans les remplacer par 0', () => {
    const row = toMasterRow({ Nom: 'Café', "Prix d'achat": '' })
    expect(row[COL.prixAchat]).toBeNull()
    expect(row[COL.stockActuel]).toBeNull()
  })

  it('conserve le 0 significatif', () => {
    expect(toMasterRow({ 'Gestion du stock': '0' })[COL.gestionStock]).toBe('0')
  })

  it('garde le code-barres en chaîne, zéros de tête compris', () => {
    expect(toMasterRow({ 'Code barre': '0003760001000001' })[COL.codeBarre]).toBe('0003760001000001')
  })

  it('retrouve une colonne dont l’intitulé diverge par la casse ou les accents', () => {
    expect(toMasterRow({ REFERENCE: 'REF-001' })[COL.reference]).toBe('REF-001')
  })

  it('ignore une colonne inconnue du maître', () => {
    const row = toMasterRow({ Nom: 'Café', 'Colonne maison': 'x' })
    expect(Object.keys(row)).not.toContain('Colonne maison')
  })

  it('normalise Supprimé en binaire', () => {
    expect(toMasterRow({ Supprimé: 'Oui' })[COL.supprime]).toBe('1')
    expect(toMasterRow({ Nom: 'Café' })[COL.supprime]).toBe('0')
  })
})

describe('withMovement', () => {
  it('recalcule le mouvement à partir des deux stocks', () => {
    const row = withMovement(toMasterRow({ 'Stock actuel': '5', 'Stock souhaité': '8' }))
    expect(row[COL.mouvementStock]).toBe('3')
  })

  it('vide le mouvement quand un stock manque', () => {
    const row = withMovement(toMasterRow({ 'Stock souhaité': '8' }))
    expect(row[COL.mouvementStock]).toBeNull()
  })

  it('vide le mouvement quand un stock est illisible, sans jeter', () => {
    const row = withMovement(toMasterRow({ 'Stock actuel': 'abc', 'Stock souhaité': '8' }))
    expect(row[COL.mouvementStock]).toBeNull()
  })
})

describe('ensureMasterTemplate', () => {
  it('crée et active un template portant les 22 colonnes maître', async () => {
    await ensureMasterTemplate()
    const active = await CsvTemplate.findOne({ isActive: true }).lean()
    expect(active?.name).toBe(MASTER_TEMPLATE_NAME)
    expect(active?.columns.map((c) => c.name)).toEqual([...MASTER_COLUMNS])
    expect(active?.delimiter).toBe(';')
  })

  it('est idempotent : deux appels ne créent qu’un seul template actif', async () => {
    const first = await ensureMasterTemplate()
    const second = await ensureMasterTemplate()
    expect(second).toBe(first)
    expect(await CsvTemplate.countDocuments({ isActive: true })).toBe(1)
  })

  it('migre un catalogue ancien vers le schéma maître sans perdre de valeur', async () => {
    const old = await CsvTemplate.create({
      name: 'Ancien',
      sourceFileName: 'a.csv',
      columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
      isActive: true,
    })
    await CatalogProduct.create({
      templateId: old._id,
      name: 'Vase',
      csvData: { Nom: 'Vase', 'Code barre': '007', Inconnue: 'x' },
      originalCsvData: { Nom: 'Vase', 'Code barre': '007' },
    })

    await ensureMasterTemplate()

    const product = await CatalogProduct.findOne({ name: 'Vase' }).lean()
    const csvData = product!.csvData as Record<string, unknown>
    expect(Object.keys(csvData)).toEqual([...MASTER_COLUMNS])
    expect(csvData[COL.nom]).toBe('Vase')
    expect(csvData[COL.codeBarre]).toBe('007')
    expect(csvData[COL.supprime]).toBe('0')
    // originalCsvData migre aussi : sinon la comparaison verrait tout comme modifié.
    expect(Object.keys(product!.originalCsvData as Record<string, unknown>)).toEqual([...MASTER_COLUMNS])
  })

  it('reporte isDeleted dans la colonne Supprimé à la migration', async () => {
    const old = await CsvTemplate.create({
      name: 'Ancien',
      sourceFileName: 'a.csv',
      columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
      isActive: true,
    })
    await CatalogProduct.create({ templateId: old._id, name: 'Vase', csvData: { Nom: 'Vase' }, isDeleted: true })

    await ensureMasterTemplate()

    const product = await CatalogProduct.findOne({ name: 'Vase' }).lean()
    expect((product!.csvData as Record<string, unknown>)[COL.supprime]).toBe('1')
    expect(product!.isDeleted).toBe(true)
  })

  it('calcule le mouvement dans l’original comme dans la copie de travail', async () => {
    const old = await CsvTemplate.create({
      name: 'Ancien',
      sourceFileName: 'a.csv',
      columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
      isActive: true,
    })
    // Un catalogue déjà au format maître, importé par l'ancien chemin générique :
    // les deux stocks sont là, le mouvement dérivé n'y est pas.
    const stocks = { Nom: 'Vase', 'Stock actuel': '5', 'Stock souhaité': '8' }
    await CatalogProduct.create({ templateId: old._id, name: 'Vase', csvData: stocks, originalCsvData: stocks })

    await ensureMasterTemplate()

    const product = await CatalogProduct.findOne({ name: 'Vase' }).lean()
    const csvData = product!.csvData as Record<string, unknown>
    const original = product!.originalCsvData as Record<string, unknown>
    expect(csvData[COL.mouvementStock]).toBe('3')
    // Sans cette symétrie, la page Comparer classerait le produit « modifié »
    // alors que rien n'a changé.
    expect(original[COL.mouvementStock]).toBe('3')
  })

  it('laisse originalCsvData à null pour un article sans original', async () => {
    const old = await CsvTemplate.create({
      name: 'Ancien',
      sourceFileName: 'a.csv',
      columns: [{ name: 'Nom', position: 0, detectedType: 'string' }],
      isActive: true,
    })
    // « Pas d'original » a un sens métier : la page Comparer classe l'article « ajouté ».
    await CatalogProduct.create({ templateId: old._id, name: 'Manuel', csvData: { Nom: 'Manuel' }, originalCsvData: null })

    await ensureMasterTemplate()

    const product = await CatalogProduct.findOne({ name: 'Manuel' }).lean()
    expect(product!.originalCsvData).toBeNull()
  })
})

describe('listMasterEntries', () => {
  it('rend les lignes dans l’ordre de création, supprimées comprises', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({ templateId, csvData: { [COL.nom]: 'A', [COL.supprime]: '0' } })
    await CatalogProduct.create({ templateId, csvData: { [COL.nom]: 'B', [COL.supprime]: '1' }, isDeleted: true })

    const entries = await listMasterEntries()
    expect(entries.map((e) => e.row[COL.nom])).toEqual(['A', 'B'])
  })
})
