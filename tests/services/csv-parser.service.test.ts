import { describe, expect, it } from 'vitest'
import iconv from 'iconv-lite'
import { detectEncoding, inferColumnType, parseCsvBuffer } from '@/services/csv-parser.service'

describe('parseCsvBuffer', () => {
  it('analyse un CSV UTF-8 point-virgule', () => {
    const buffer = Buffer.from('Nom;Prix\r\nVase;12,50\r\n', 'utf-8')
    const parsed = parseCsvBuffer(buffer)

    expect(parsed.columns).toEqual(['Nom', 'Prix'])
    expect(parsed.delimiter).toBe(';')
    expect(parsed.rows).toEqual([{ Nom: 'Vase', Prix: '12,50' }])
  })

  it('conserve les accents d’un fichier windows-1252', () => {
    // Le cas ShopCaisse : décodé en UTF-8 par erreur, « Décoratif » devient
    // « D�coratif ». C'est la raison d'être de la détection serveur.
    const buffer = iconv.encode('Nom;Famille\r\nVase Décoratif;Objets déco\r\n', 'windows-1252')
    const parsed = parseCsvBuffer(buffer)

    expect(parsed.rows[0].Nom).toBe('Vase Décoratif')
    expect(parsed.rows[0].Famille).toBe('Objets déco')
  })

  it('retire le BOM de l’en-tête', () => {
    const buffer = Buffer.from('\uFEFFNom;Prix\r\nVase;12,50\r\n', 'utf-8')
    expect(parseCsvBuffer(buffer).columns).toEqual(['Nom', 'Prix'])
  })

  it('détecte un séparateur virgule', () => {
    const buffer = Buffer.from('Nom,Prix\r\nVase,12.50\r\n', 'utf-8')
    expect(parseCsvBuffer(buffer).delimiter).toBe(',')
  })

  it('rejette un fichier sans en-tête exploitable', () => {
    expect(() => parseCsvBuffer(Buffer.from('', 'utf-8'))).toThrow(/en-tête/)
  })

  it('conserve les colonnes supplémentaires', () => {
    const buffer = Buffer.from('Nom;Colonne Maison\r\nVase;valeur\r\n', 'utf-8')
    expect(parseCsvBuffer(buffer).rows[0]['Colonne Maison']).toBe('valeur')
  })

  it('conserve l’euro d’un fichier windows-1252', () => {
    // Sur ce petit échantillon chardet reconnaît déjà windows-1252, mais
    // c'est le bug qu'on prévient : si l'euro (0x80) était décodé comme en
    // ISO-8859-1, il deviendrait un caractère de contrôle invisible.
    const buffer = iconv.encode('Nom;Prix\r\nVase;12,50 €\r\n', 'windows-1252')
    const parsed = parseCsvBuffer(buffer)

    expect(parsed.rows[0].Prix).toBe('12,50 €')
  })
})

describe('detectEncoding', () => {
  it('ne rend jamais iso-8859-1 : un fichier d’accents seuls bascule sur windows-1252', () => {
    // chardet classe ce buffer en ISO-8859-1 (vérifié empiriquement), un cas
    // plausible pour un gros export ShopCaisse avec peu ou pas d'euros.
    const buffer = iconv.encode(
      'Nom;Famille\r\nVase Décoratif;Objets déco\r\nCoussin brodé;Décoration\r\n',
      'windows-1252',
    )

    expect(detectEncoding(buffer).encoding).toBe('windows-1252')
  })
})

describe('inferColumnType', () => {
  it('reconnaît les nombres au format français', () => {
    expect(inferColumnType(['12,50', '3', '1 200,00'])).toBe('number')
  })

  it('reconnaît les booléens', () => {
    expect(inferColumnType(['oui', 'non', 'VRAI'])).toBe('boolean')
  })

  it('reconnaît les dates', () => {
    expect(inferColumnType(['2026-07-15', '2026-01-02'])).toBe('date')
    expect(inferColumnType(['15/07/2026'])).toBe('date')
  })

  it('retombe sur string dès qu’une valeur diverge', () => {
    expect(inferColumnType(['12,50', 'gratuit'])).toBe('string')
  })

  it('rend unknown pour une colonne vide plutôt que de deviner', () => {
    expect(inferColumnType([])).toBe('unknown')
    expect(inferColumnType(['', '  '])).toBe('unknown')
  })

  it('ne prend pas 0 et 1 pour des booléens', () => {
    expect(inferColumnType(['0', '1'])).toBe('number')
  })
})
