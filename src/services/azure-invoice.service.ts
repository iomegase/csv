const API_VERSION = '2024-11-30'
const MODEL_ID = 'prebuilt-invoice'

function azureConfig(): { endpoint: string; key: string } {
  const endpoint = process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  if (!endpoint || !key) {
    throw new Error(
      'AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT ou AZURE_DOCUMENT_INTELLIGENCE_KEY manquant.',
    )
  }
  return { endpoint: endpoint.replace(/\/$/, ''), key }
}

/**
 * Soumet le PDF au modèle prebuilt-invoice et renvoie l'operation-location à
 * sonder. Requête courte : Azure répond 202 immédiatement.
 */
export async function beginInvoiceAnalysis(pdf: Buffer): Promise<{ operationLocation: string }> {
  const { endpoint, key } = azureConfig()
  const url = `${endpoint}/documentintelligence/documentModels/${MODEL_ID}:analyze?api-version=${API_VERSION}`

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'Ocp-Apim-Subscription-Key': key },
    body: new Uint8Array(pdf),
  })

  const operationLocation = response.headers.get('operation-location')
  if (!response.ok || !operationLocation) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Azure a refusé l’analyse (${response.status}). ${detail}`.trim())
  }

  return { operationLocation }
}

/** Sonde une fois l'opération. Ne bloque pas : l'appelant réinterroge. */
export async function pollInvoiceAnalysis(
  operationLocation: string,
): Promise<{ status: 'running' | 'succeeded' | 'failed'; result?: unknown; error?: string }> {
  const key = process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY
  if (!key) {
    throw new Error('AZURE_DOCUMENT_INTELLIGENCE_KEY manquant.')
  }

  const response = await fetch(operationLocation, {
    headers: { 'Ocp-Apim-Subscription-Key': key },
  })
  if (!response.ok) {
    return { status: 'failed', error: `Azure a renvoyé ${response.status} au sondage.` }
  }

  const body = (await response.json()) as {
    status?: string
    analyzeResult?: unknown
    error?: { message?: string }
  }

  if (body.status === 'succeeded') return { status: 'succeeded', result: body.analyzeResult }
  if (body.status === 'failed') {
    return { status: 'failed', error: body.error?.message ?? 'Analyse Azure échouée.' }
  }
  return { status: 'running' }
}
