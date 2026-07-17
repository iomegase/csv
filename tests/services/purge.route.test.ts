import { describe, expect, it } from 'vitest'
import { withTestDatabase } from '../helpers/db'
import { CatalogProduct } from '@/models/CatalogProduct'
import { ensureMasterTemplate } from '@/services/shopcaisse-master.service'
import { POST as purgeRoute } from '@/app/api/admin/purge/route'

withTestDatabase()

function post(body: unknown) {
  return purgeRoute(
    new Request('http://localhost/api/admin/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/admin/purge', () => {
  it('refuse un mot de confirmation erroné et n’efface rien', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({ templateId, csvData: { Nom: 'Café' } })

    const response = await post({ confirm: 'oui' })

    expect(response.status).toBe(400)
    expect(await CatalogProduct.countDocuments({})).toBe(1)
  })

  it('refuse un corps sans confirmation', async () => {
    expect((await post({})).status).toBe(400)
  })

  it('efface tout quand le mot exact est fourni', async () => {
    const templateId = await ensureMasterTemplate()
    await CatalogProduct.create({ templateId, csvData: { Nom: 'Café' } })

    const response = await post({ confirm: 'EFFACER' })

    expect(response.status).toBe(200)
    const { deleted } = await response.json()
    expect(deleted.catalogProducts).toBe(1)
    expect(await CatalogProduct.countDocuments({})).toBe(0)
  })
})
