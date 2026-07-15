import chardet from 'chardet'
import iconv from 'iconv-lite'
import Papa from 'papaparse'
import type { DetectedType } from '@/models/CsvTemplate'
import { parseLocalizedNumber } from '@/lib/product-views'

export interface ParsedCsv {
  columns: string[]
  rows: Record<string, string>[]
  delimiter: string
  encoding: string
  /** false quand chardet n'a rien reconnu et qu'on est retombé sur utf-8. */
  encodingConfident: boolean
}

const SAMPLE_SIZE = 200

const BOOLEAN_VALUES = new Set(['true', 'false', 'vrai', 'faux', 'oui', 'non'])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FR_DATE = /^\d{2}\/\d{2}\/\d{4}$/

export function detectEncoding(buffer: Buffer): { encoding: string; confident: boolean } {
  const detected = chardet.detect(buffer)

  if (!detected || !iconv.encodingExists(detected)) {
    // Repli explicite, jamais silencieux : l'appelant remonte le doute à
    // l'utilisateur via encodingConfident.
    return { encoding: 'utf-8', confident: false }
  }

  const encoding = detected.toLowerCase()

  // chardet classe souvent un CSV d'accents français en ISO-8859-1, alors que
  // ShopCaisse (une caisse enregistreuse) produit aussi des euros. Les deux
  // encodages sont identiques sur les accents mais divergent sur 0x80-0x9F,
  // où windows-1252 place l'euro (0x80) : en ISO-8859-1 ce même octet devient
  // un caractère de contrôle invisible. windows-1252 est un sur-ensemble
  // strict sur tout caractère imprimable, donc ce repli est sans contrepartie
  // (c'est d'ailleurs le comportement imposé par la spec HTML5).
  if (encoding === 'iso-8859-1') {
    return { encoding: 'windows-1252', confident: true }
  }

  return { encoding, confident: true }
}

export function parseCsvBuffer(buffer: Buffer): ParsedCsv {
  const { encoding, confident } = detectEncoding(buffer)
  const text = iconv.decode(buffer, encoding)

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    // Le BOM survit au décodage et collerait à la première colonne, la rendant
    // introuvable par nom.
    transformHeader: (header) => header.replace(/^\uFEFF/, '').trim(),
  })

  const columns = (result.meta.fields ?? []).filter(Boolean)

  if (!columns.length) {
    throw new Error("Le fichier ne contient pas de ligne d'en-tête exploitable.")
  }

  const rows = result.data.map((row) =>
    Object.fromEntries(columns.map((column) => [column, String(row[column] ?? '')])),
  )

  return {
    columns,
    rows,
    delimiter: result.meta.delimiter || ';',
    encoding,
    encodingConfident: confident,
  }
}

export function inferColumnType(values: string[]): DetectedType {
  const sample = values
    .slice(0, SAMPLE_SIZE)
    .map((value) => String(value ?? '').trim())
    .filter((value) => value !== '')

  // Une colonne entièrement vide n'est pas une colonne de texte : on ne sait
  // rien d'elle.
  if (!sample.length) return 'unknown'

  const every = (predicate: (value: string) => boolean) => sample.every(predicate)

  // Les booléens passent avant les nombres : sinon « 0 »/« 1 » seraient
  // ambigus. On ne les traite volontairement pas comme des booléens.
  if (every((value) => BOOLEAN_VALUES.has(value.toLocaleLowerCase('fr')))) return 'boolean'
  // Les dates passent avant les nombres : parseLocalizedNumber retire les
  // séparateurs non numériques (ex. « / »), donc « 15/07/2026 » se lirait
  // sinon comme le nombre 15072026.
  if (every((value) => ISO_DATE.test(value) || FR_DATE.test(value))) return 'date'
  if (every((value) => parseLocalizedNumber(value) !== null)) return 'number'
  if (every(isJsonValue)) return 'json'

  return 'string'
}

function isJsonValue(value: string): boolean {
  if (!value.startsWith('{') && !value.startsWith('[')) return false
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

export function buildColumnDefinitions(parsed: ParsedCsv) {
  return parsed.columns.map((name, position) => ({
    name,
    position,
    detectedType: inferColumnType(parsed.rows.map((row) => row[name])),
  }))
}
