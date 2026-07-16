export const MAX_PDF_BYTES = Number(process.env.MAX_PDF_BYTES ?? 15 * 1024 * 1024)

// Les 5 premiers octets d'un PDF : « %PDF- ».
const PDF_MAGIC = Buffer.from('%PDF-')

export function assertPdfFile(
  fileName: string,
  mimeType: string,
  size: number,
  header: Buffer,
): void {
  if (size === 0) {
    throw new Error('Le fichier est vide.')
  }

  if (size > MAX_PDF_BYTES) {
    throw new Error(
      `Fichier trop volumineux : ${Math.round(size / 1024 / 1024)} Mo pour une limite de ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} Mo.`,
    )
  }

  if (!/\.pdf$/i.test(fileName)) {
    throw new Error('Le fichier doit être un PDF (extension .pdf attendue).')
  }

  // application/octet-stream toléré : certains navigateurs n'annoncent pas le
  // type. Le contrôle réel est celui des octets d'en-tête ci-dessous.
  const allowed = ['application/pdf', 'application/octet-stream']
  if (!allowed.includes(mimeType)) {
    throw new Error(`Type de fichier refusé : ${mimeType}. Un PDF est attendu.`)
  }

  // Garantie réelle du format, indépendante du nom et du type annoncé.
  if (!header.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC)) {
    throw new Error('Le contenu n\'est pas un PDF (signature %PDF- absente).')
  }
}
