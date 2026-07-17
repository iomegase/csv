import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CsvImport } from '@/models/CsvImport'
import { CatalogProduct } from '@/models/CatalogProduct'
import { COL } from '@/lib/shopcaisse-columns'
import { POST as importRoute } from '@/app/api/admin/shopcaisse/import/route'
import { GET as exportRoute } from '@/app/api/admin/shopcaisse/export/route'
import { GET as summaryRoute } from '@/app/api/admin/shopcaisse/export-summary/route'
import { GET as diffRoute } from '@/app/api/admin/catalog/diff/route'

withTestDatabase()

const FIXTURES = join(process.cwd(), 'tests/fixtures/shopcaisse')

async function upload(fixture: string): Promise<string> {
  const buffer = readFileSync(join(FIXTURES, fixture))
  const doc = await CsvImport.create({
    originalFileName: fixture,
    rawContent: buffer,
    fileSize: buffer.byteLength,
    mimeType: 'text/csv',
    encoding: 'utf-8',
    delimiter: ';',
    columns: [],
    rowCount: 1,
  })
  return String(doc._id)
}

function post(body: unknown) {
  return importRoute(
    new Request('http://localhost/api/admin/shopcaisse/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/admin/shopcaisse/import', () => {
  it('importe le fichier produits dans le maître', async () => {
    const response = await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    expect(response.status).toBe(201)

    const { summary } = await response.json()
    expect(summary.created).toBe(1)

    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.csvData as Record<string, unknown>)[COL.nom]).toBe('Café Latte')
  })

  it('importe ensuite le fichier stock dans Stock actuel', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const response = await post({ importId: await upload('export-stock-modele.csv'), kind: 'stock' })

    expect(response.status).toBe(201)
    const product = await CatalogProduct.findOne({}).lean()
    expect((product!.csvData as Record<string, unknown>)[COL.stockActuel]).toBe('2')
  })

  it('refuse un corps invalide', async () => {
    expect((await post({ importId: 'pas-un-id', kind: 'products' })).status).toBe(400)
    expect((await post({ importId: await upload('export-produits.csv'), kind: 'stocks' })).status).toBe(400)
  })

  it('refuse un import inexistant', async () => {
    const response = await post({ importId: '000000000000000000000000', kind: 'products' })
    expect(response.status).toBe(400)
    expect((await response.json()).message).toContain('introuvable')
  })
})

describe('GET /api/admin/shopcaisse/export-summary', () => {
  it('rend la validation sans télécharger', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const { validation } = await (await summaryRoute()).json()

    expect(validation.summary.total).toBe(1)
    expect(validation.summary.alignment).toBe('Conforme')
    expect(validation.canExport).toBe(true)
  })
})

describe('GET /api/admin/shopcaisse/export', () => {
  it('renvoie une archive ZIP contenant les deux fichiers', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const response = await exportRoute()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/zip')
    expect(response.headers.get('Content-Disposition')).toContain('lot-shopcaisse-')

    const archive = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()))
    expect(Object.keys(archive.files).sort()).toEqual(['export-produits.csv', 'export-stock.csv'])
  })

  it('répond 409 et détaille les erreurs quand l’export est bloqué', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    // Un second produit au même Identifiant : conflit non résolu.
    const product = await CatalogProduct.findOne({}).lean()
    await CatalogProduct.create({
      templateId: product!.templateId,
      csvData: { ...(product!.csvData as Record<string, unknown>), [COL.identifiant]: 'X', [COL.reference]: 'REF-001' },
    })
    await CatalogProduct.updateOne({ _id: product!._id }, { $set: { [`csvData.${COL.identifiant}`]: 'X' } })

    const response = await exportRoute()
    expect(response.status).toBe(409)

    const body = await response.json()
    expect(body.error).toBe('export_blocked')
    expect(body.validation.conflicts.length).toBeGreaterThan(0)
  })
})

describe('GET /api/admin/catalog/diff', () => {
  it('rend la validation d’export à côté du diff', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const body = await (await diffRoute()).json()

    expect(body.diff).toBeTruthy()
    expect(body.validation.summary.alignment).toBe('Conforme')
    expect(body.validation.summary.productRowCount).toBe(1)
    expect(body.validation.summary.stockRowCount).toBe(1)
  })

  it('expose les doublons pour affichage dans la page Comparer', async () => {
    await post({ importId: await upload('export-produits.csv'), kind: 'products' })
    const product = await CatalogProduct.findOne({}).lean()
    await CatalogProduct.create({
      templateId: product!.templateId,
      csvData: { ...(product!.csvData as Record<string, unknown>), [COL.nom]: 'Autre' },
    })

    const body = await (await diffRoute()).json()
    expect(body.validation.conflicts.length).toBeGreaterThan(0)
    expect(body.validation.conflicts[0]).toMatchObject({ rule: 'Référence', reference: 'REF-001' })
    expect(body.validation.canExport).toBe(false)
  })
})
