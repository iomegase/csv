import { describe, expect, it } from 'vitest'
import { assertPdfFile } from '@/lib/pdf-validation'

const PDF_HEADER = Buffer.from('%PDF-1.7\n')

describe('assertPdfFile', () => {
  it('accepte un PDF valide', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 1000, PDF_HEADER)).not.toThrow()
  })

  it('tolère application/octet-stream si les octets sont bien un PDF', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/octet-stream', 1000, PDF_HEADER)).not.toThrow()
  })

  it('refuse un fichier vide', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 0, PDF_HEADER)).toThrow(/vide/)
  })

  it('refuse une extension non PDF', () => {
    expect(() => assertPdfFile('facture.txt', 'application/pdf', 1000, PDF_HEADER)).toThrow(/PDF/)
  })

  it('refuse un type MIME image', () => {
    expect(() => assertPdfFile('facture.pdf', 'image/png', 1000, PDF_HEADER)).toThrow(/refusé/)
  })

  it('refuse un fichier trop volumineux', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 16 * 1024 * 1024, PDF_HEADER)).toThrow(/volumineux/)
  })

  it('refuse un fichier dont les octets ne commencent pas par %PDF-', () => {
    expect(() => assertPdfFile('facture.pdf', 'application/pdf', 1000, Buffer.from('PK\x03\x04'))).toThrow(/PDF/)
  })
})
