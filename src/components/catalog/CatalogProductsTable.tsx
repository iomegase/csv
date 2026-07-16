interface CatalogProductsTableProps {
  columns: string[]
  products: Array<{ id: string; csvData: Record<string, unknown> }>
}

export function CatalogProductsTable({ columns, products }: CatalogProductsTableProps) {
  if (!products.length) {
    return (
      <p className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
        Le catalogue est vide.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-3xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column}
                className="whitespace-nowrap px-4 py-3 text-left font-medium text-slate-600"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id} className="border-t border-slate-100">
              {columns.map((column) => {
                const value = product.csvData[column]
                return (
                  <td key={column} className="whitespace-nowrap px-4 py-2 text-slate-700">
                    {value === null || value === undefined ? (
                      // Une cellule vide se voit : elle signifie « donnée absente
                      // de la source », pas « zéro ».
                      <span className="text-slate-300">—</span>
                    ) : (
                      String(value)
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
