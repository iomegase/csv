import { afterEach, describe, expect, it, vi } from 'vitest'
import { beginInvoiceAnalysis, pollInvoiceAnalysis } from '@/services/azure-invoice.service'

const ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('beginInvoiceAnalysis', () => {
  it('poste le PDF et renvoie l’operation-location', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT = 'https://exemple.cognitiveservices.azure.com/'
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'

    const fetchMock = vi.fn().mockResolvedValue({
      status: 202,
      ok: true,
      headers: new Headers({ 'operation-location': 'https://exemple/operations/123' }),
      text: async () => '',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { operationLocation } = await beginInvoiceAnalysis(Buffer.from('%PDF-1.4'))
    expect(operationLocation).toBe('https://exemple/operations/123')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('échoue clairement sans configuration Azure', async () => {
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
    delete process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
    await expect(beginInvoiceAnalysis(Buffer.from('%PDF-1.4'))).rejects.toThrow(/AZURE_DOCUMENT_INTELLIGENCE/)
  })
})

describe('pollInvoiceAnalysis', () => {
  it('rend running tant qu’Azure travaille', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: 'running' }) }),
    )
    expect((await pollInvoiceAnalysis('https://exemple/op/1')).status).toBe('running')
  })

  it('rend succeeded avec le résultat', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'succeeded', analyzeResult: { documents: [] } }),
      }),
    )
    const outcome = await pollInvoiceAnalysis('https://exemple/op/1')
    expect(outcome.status).toBe('succeeded')
    expect(outcome.result).toEqual({ documents: [] })
  })

  it('rend failed avec un message', async () => {
    process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY = 'clef'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'failed', error: { message: 'document illisible' } }),
      }),
    )
    const outcome = await pollInvoiceAnalysis('https://exemple/op/1')
    expect(outcome.status).toBe('failed')
    expect(outcome.error).toMatch(/illisible/)
  })
})
