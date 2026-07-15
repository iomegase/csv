export type CsvRow = Record<string, string>

export type FilterOperator =
  | 'contains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'

export interface CsvFilter {
  id: string
  column: string
  operator: FilterOperator
  value: string
}

export function matchesFilter(row: CsvRow, filter: CsvFilter): boolean {
  const cell = String(row[filter.column] ?? '')
  const normalizedCell = cell.toLocaleLowerCase('fr')
  const normalizedValue = filter.value.toLocaleLowerCase('fr')

  switch (filter.operator) {
    case 'contains':
      return normalizedCell.includes(normalizedValue)
    case 'equals':
      return normalizedCell === normalizedValue
    case 'notEquals':
      return normalizedCell !== normalizedValue
    case 'startsWith':
      return normalizedCell.startsWith(normalizedValue)
    case 'endsWith':
      return normalizedCell.endsWith(normalizedValue)
    case 'isEmpty':
      return cell.trim() === ''
    case 'isNotEmpty':
      return cell.trim() !== ''
    default:
      return true
  }
}

export function makeEmptyRow(columns: string[]): CsvRow {
  return Object.fromEntries(columns.map((column) => [column, '']))
}
