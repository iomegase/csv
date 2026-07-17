import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, MASTER_COLUMNS, PRODUCT_COLUMNS } from '@/lib/shopcaisse-columns'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { importProductsIntoMaster } from '@/services/shopcaisse-import.service'
import type { ParsedCsv } from '@/services/csv-parser.service'

withTestDatabase()

/** Un ParsedCsv produits, colonnes dans l'ordre ShopCaisse. */
function parsedProducts(rows: Array<Record<string, string>>): ParsedCsv {
  return {
    columns: [...PRODUCT_COLUMNS],
    rows: rows.map((row) => Object.fromEntries(PRODUCT_COLUMNS.map((c) => [c, row[c] ?? '']))),
    delimiter: ';',
    encoding: 'utf-8',
    encodingConfident: true,
  }
}

async function masterRows() {
  const products = await CatalogProduct.find({}).sort({ _id: 1 }).lean()
  return products.map((p) => p.csvData as Record<string, unknown>)
}

describe('importProductsIntoMaster', () => {
  it('crée le tableau maître à partir du fichier produits', async () => {
    const summary = await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001', Famille: 'Boissons' }]),
    )
    expect(summary.created).toBe(1)
    expect(summary.updated).toBe(0)

    const [row] = await masterRows()
    expect(Object.keys(row)).toEqual([...MASTER_COLUMNS])
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.reference]).toBe('REF-001')
    expect(row[COL.famille]).toBe('Boissons')
  })

  it('mappe par intitulé et non par position', async () => {
    // Colonnes volontairement inversées par rapport à l'ordre ShopCaisse.
    const parsed: ParsedCsv = {
      columns: ['Référence', 'Nom'],
      rows: [{ Référence: 'REF-001', Nom: 'Café Latte' }],
      delimiter: ';',
      encoding: 'utf-8',
      encodingConfident: true,
    }
    await importProductsIntoMaster(parsed)

    const [row] = await masterRows()
    expect(row[COL.nom]).toBe('Café Latte')
    expect(row[COL.reference]).toBe('REF-001')
  })

  it('conserve les cellules vides sans les remplacer par 0', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001' }]))
    const [row] = await masterRows()
    expect(row[COL.prixAchat]).toBeNull()
    expect(row[COL.description]).toBeNull()
  })

  it('conserve le 0 significatif', async () => {
    await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café', Référence: 'REF-001', 'Gestion du stock': '0' }]),
    )
    const [row] = await masterRows()
    expect(row[COL.gestionStock]).toBe('0')
  })

  it('conserve les décimales', async () => {
    await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café', Référence: 'REF-001', "Prix d'achat": '2.50' }]),
    )
    const [row] = await masterRows()
    expect(row[COL.prixAchat]).toBe('2.50')
  })

  it('garde le code-barres en chaîne, zéros de tête compris', async () => {
    await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café', Référence: 'REF-001', 'Code barre': '0003760001000001' }]),
    )
    const [row] = await masterRows()
    expect(row[COL.codeBarre]).toBe('0003760001000001')
  })

  it('met à jour un produit existant par Identifiant, sans créer de doublon', async () => {
    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importProductsIntoMaster(
      parsedProducts([{ Identifiant: '42', Nom: 'Café Latte', Référence: 'REF-001' }]),
    )

    expect(summary.updated).toBe(1)
    expect(summary.created).toBe(0)
    const rows = await masterRows()
    expect(rows).toHaveLength(1)
    expect(rows[0][COL.nom]).toBe('Café Latte')
  })

  it('met à jour un produit existant par Référence quand l’Identifiant est vide', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const summary = await importProductsIntoMaster(
      parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001' }]),
    )

    expect(summary.updated).toBe(1)
    const rows = await masterRows()
    expect(rows).toHaveLength(1)
    expect(rows[0][COL.nom]).toBe('Café Latte')
  })

  it('conserve les stocks internes lors de la mise à jour d’un produit existant', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({
      templateId,
      shopcaisseId: '42',
      reference: 'REF-001',
      csvData: {
        [COL.identifiant]: '42',
        [COL.reference]: 'REF-001',
        [COL.nom]: 'Café',
        [COL.stockActuel]: '5',
        [COL.stockSouhaite]: '8',
        [COL.mouvementStock]: '3',
        [COL.supprime]: '0',
      },
    })

    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café Latte', Référence: 'REF-001' }]))

    const [row] = await masterRows()
    expect(row[COL.stockActuel]).toBe('5')
    expect(row[COL.stockSouhaite]).toBe('8')
    expect(row[COL.mouvementStock]).toBe('3')
    expect(row[COL.nom]).toBe('Café Latte')
  })

  it('laisse les stocks vides pour un nouveau produit — jamais de quantité inventée', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const [row] = await masterRows()
    expect(row[COL.stockActuel]).toBeNull()
    expect(row[COL.stockSouhaite]).toBeNull()
    expect(row[COL.mouvementStock]).toBeNull()
  })

  it('conserve une ligne existante absente du nouvel import', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Thé', Référence: 'REF-002' }]))

    const rows = await masterRows()
    expect(rows.map((r) => r[COL.reference])).toEqual(['REF-001', 'REF-002'])
  })

  it('n’écrase pas originalCsvData d’un produit existant', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café Latte', Référence: 'REF-001' }]))

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.originalCsvData as Record<string, unknown>)[COL.nom]).toBe('Café')
  })

  it('signale l’ambiguïté et ne fusionne pas deux lignes de même Référence', async () => {
    const templateId = await ensureMasterTemplate()
    for (const nom of ['Café', 'Thé']) {
      await CatalogProduct.create({
        templateId,
        csvData: { [COL.reference]: 'REF-001', [COL.nom]: nom, [COL.supprime]: '0' },
      })
    }

    const summary = await importProductsIntoMaster(parsedProducts([{ Nom: 'Autre', Référence: 'REF-001' }]))

    expect(summary.ambiguous).toEqual([{ row: 0, rule: 'Référence' }])
    // Ni fusion, ni écrasement : les deux lignes restent, telles quelles.
    const rows = await masterRows()
    expect(rows.map((r) => r[COL.nom])).toEqual(['Café', 'Thé'])
    expect(summary.created).toBe(0)
    expect(summary.updated).toBe(0)
  })

  it('signale deux lignes du fichier en collision, et conserve les deux', async () => {
    const summary = await importProductsIntoMaster(
      parsedProducts([
        { Nom: 'Café', Référence: 'REF-001' },
        { Nom: 'Thé', Référence: 'REF-001' },
      ]),
    )

    // Rien n'est perdu : les deux produits du fichier entrent au maître...
    expect(summary.created).toBe(2)
    const rows = await masterRows()
    expect(rows.map((r) => r[COL.nom])).toEqual(['Café', 'Thé'])
    // ...mais les deux lignes sont signalées, pour que la tâche 8 bloque l'export.
    expect(summary.ambiguous).toEqual([
      { row: 0, rule: 'Référence' },
      { row: 1, rule: 'Référence' },
    ])
  })

  it('n’applique qu’une fois deux lignes du fichier visant le même produit existant', async () => {
    await importProductsIntoMaster(parsedProducts([{ Identifiant: '42', Nom: 'Café', Référence: 'REF-001' }]))

    const summary = await importProductsIntoMaster(
      parsedProducts([
        { Identifiant: '42', Nom: 'Café Latte', Référence: 'REF-001' },
        { Identifiant: '42', Nom: 'Café Crème', Référence: 'REF-001' },
      ]),
    )

    // Deux updateOne sur le même _id en mode non ordonné rendaient le nom final
    // dépendant du driver. La première ligne gagne, la seconde est signalée.
    expect(summary.updated).toBe(1)
    expect(summary.ambiguous).toEqual([{ row: 1, rule: 'Identifiant' }])
    const rows = await masterRows()
    expect(rows).toHaveLength(1)
    expect(rows[0][COL.nom]).toBe('Café Latte')
  })

  it('convertit Oui en 1 dans la colonne Supprimé', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001', Supprimé: 'Oui' }]))
    const [row] = await masterRows()
    expect(row[COL.supprime]).toBe('1')
  })

  it('tient isDeleted en miroir de la colonne Supprimé', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001', Supprimé: '1' }]))
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.isDeleted).toBe(true)
  })

  it('active le template maître', async () => {
    await importProductsIntoMaster(parsedProducts([{ Nom: 'Café', Référence: 'REF-001' }]))
    const product = await CatalogProduct.findOne({}).lean()
    expect(product!.templateId).toBeTruthy()
  })
})
