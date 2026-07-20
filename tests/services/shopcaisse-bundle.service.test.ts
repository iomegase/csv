import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL, makeEmptyMasterRow } from '@/lib/shopcaisse-columns'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { PRODUCTS_FILE_NAME, STOCK_FILE_NAME } from '@/services/shopcaisse-export.service'
import { buildExportBundle, ExportBlockedError } from '@/services/shopcaisse-bundle.service'

withTestDatabase()

const FIXTURES = join(process.cwd(), 'tests/fixtures/shopcaisse')

function referenceHeader(fileName: string): string {
  return readFileSync(join(FIXTURES, fileName), 'utf-8').replace(/^﻿/, '').split('\n')[0]
}

async function seed(rows: Array<Partial<Record<string, string>>>) {
  const templateId = await ensureMasterTemplate()
  for (const values of rows) {
    const csvData = { ...makeEmptyMasterRow(), [COL.supprime]: '0', ...values }
    await CatalogProduct.create({ templateId, csvData, isDeleted: csvData[COL.supprime] === '1' })
  }
}

/** Les fichiers de l'archive, décodés en texte. */
async function readZip(zip: Buffer): Promise<Record<string, string>> {
  const archive = await JSZip.loadAsync(zip)
  const out: Record<string, string> = {}
  for (const name of Object.keys(archive.files)) out[name] = await archive.files[name].async('string')
  return out
}

describe('buildExportBundle', () => {
  it('génère une archive contenant les deux fichiers, et rien d’autre', async () => {
    await seed([{ [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café' }])
    const { zip, fileName } = await buildExportBundle()

    const files = await readZip(zip)
    expect(Object.keys(files).sort()).toEqual([PRODUCTS_FILE_NAME, STOCK_FILE_NAME].sort())
    expect(fileName).toMatch(/^lot-shopcaisse-\d{4}-\d{2}-\d{2}\.zip$/)
  })

  it('écrit les deux fichiers avec les en-têtes, le BOM et les LF des références', async () => {
    await seed([{ [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café à emporter' }])
    const files = await readZip((await buildExportBundle()).zip)

    for (const name of [PRODUCTS_FILE_NAME, STOCK_FILE_NAME]) {
      expect(files[name].startsWith('﻿')).toBe(true)
      expect(files[name]).toContain(';')
      expect(files[name]).toContain('Café à emporter')
      expect(files[name]).not.toContain('\r\n')
    }

    expect(files[PRODUCTS_FILE_NAME].replace(/^﻿/, '').split('\n')[0]).toBe(
      referenceHeader('produits-reference-20260719.csv'),
    )
    expect(files[STOCK_FILE_NAME].replace(/^﻿/, '').split('\n')[0]).toBe(
      referenceHeader('stocks-reference-20260719.csv'),
    )
  })

  it('donne aux deux fichiers le même nombre de lignes et le même ordre', async () => {
    await seed([
      { [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café', [COL.mouvementStock]: '3' },
      { [COL.identifiant]: '2', [COL.reference]: 'REF-2', [COL.nom]: 'Thé' },
      { [COL.identifiant]: '3', [COL.reference]: 'REF-3', [COL.nom]: 'Vase', [COL.supprime]: '1' },
    ])
    const files = await readZip((await buildExportBundle()).zip)

    const lines = (csv: string) => csv.replace(/^﻿/, '').split(/\r?\n/).slice(1).filter(Boolean)
    const products = lines(files[PRODUCTS_FILE_NAME])
    const stock = lines(files[STOCK_FILE_NAME])

    expect(products).toHaveLength(3)
    expect(stock).toHaveLength(3)
    // Ligne à ligne, le même produit : le Nom est en 2e position dans les deux fichiers.
    expect(products.map((line) => line.split(';')[1])).toEqual(['Café', 'Thé', 'Vase'])
    expect(stock.map((line) => line.split(';')[1])).toEqual(['Café', 'Thé', 'Vase'])
  })

  it('renvoie le résumé de l’export', async () => {
    await seed([
      { [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café', [COL.mouvementStock]: '3' },
      { [COL.reference]: 'REF-2', [COL.nom]: 'Nouveau', [COL.stockSouhaite]: '2', [COL.mouvementStock]: '2' },
    ])
    const { validation } = await buildExportBundle()

    expect(validation.summary).toMatchObject({
      total: 2,
      existing: 1,
      newWithoutId: 1,
      movementsPositive: 2,
      alignment: 'Conforme',
      sameRowCount: true,
      productRowCount: 2,
      stockRowCount: 2,
    })
  })

  it('bloque l’export en cas de doublon non résolu', async () => {
    await seed([
      { [COL.identifiant]: '42', [COL.reference]: 'REF-1', [COL.nom]: 'A' },
      { [COL.identifiant]: '42', [COL.reference]: 'REF-2', [COL.nom]: 'B' },
    ])

    await expect(buildExportBundle()).rejects.toThrow(ExportBlockedError)
  })

  it('bloque l’export en cas d’ambiguïté et rend la validation avec l’erreur', async () => {
    await seed([
      { [COL.identifiant]: '1', [COL.reference]: 'REF-1', [COL.nom]: 'Café', [COL.codeBarre]: '111' },
      { [COL.identifiant]: '2', [COL.reference]: 'REF-2', [COL.nom]: 'café', [COL.codeBarre]: '111' },
    ])

    const error = await buildExportBundle().catch((e: ExportBlockedError) => e)
    expect(error).toBeInstanceOf(ExportBlockedError)
    expect((error as ExportBlockedError).validation.conflicts).toHaveLength(2)
    expect((error as ExportBlockedError).validation.canExport).toBe(false)
  })

  it('bloque l’export quand une donnée obligatoire manque', async () => {
    // Nouveau produit (ni Identifiant ni Référence) sans Stock souhaité : la
    // Référence n'est plus exigée, mais un stock strictement positif l'est.
    await seed([{ [COL.nom]: 'Nouveau sans stock' }])
    await expect(buildExportBundle()).rejects.toThrow(ExportBlockedError)
  })

  it('exporte un catalogue vide sans jeter', async () => {
    await ensureMasterTemplate()
    const files = await readZip((await buildExportBundle()).zip)
    expect(files[PRODUCTS_FILE_NAME].replace(/^﻿/, '').split(/\r?\n/).filter(Boolean)).toHaveLength(1)
  })
})
