import JSZip from 'jszip'
import { PRODUCT_COLUMNS, STOCK_COLUMNS } from '@/lib/shopcaisse-columns'
import {
  buildProductRows,
  buildStockRows,
  PRODUCTS_FILE_NAME,
  serializeCsv,
  STOCK_FILE_NAME,
} from '@/services/shopcaisse-export.service'
import { listMasterEntries } from '@/services/shopcaisse-master.service'
import { validateMasterEntries, type MasterValidation } from '@/services/shopcaisse-validation.service'

/**
 * L'export a été refusé. Porte la validation complète pour que l'appelant
 * puisse dire à l'utilisateur quelles lignes corriger, et non seulement « non ».
 */
export class ExportBlockedError extends Error {
  constructor(readonly validation: MasterValidation) {
    super('Export bloqué : corrigez les erreurs signalées avant de télécharger le lot.')
    this.name = 'ExportBlockedError'
  }
}

/**
 * Construit le lot ShopCaisse : les deux CSV, dans une archive, depuis une
 * seule et même liste de lignes maître.
 *
 * `listMasterEntries` est appelé une fois : relire la base pour chaque fichier
 * ouvrirait la porte à une écriture concurrente entre les deux lectures, et
 * donc à deux fichiers désalignés.
 */
export async function buildExportBundle(): Promise<{
  zip: Buffer
  fileName: string
  validation: MasterValidation
}> {
  const entries = await listMasterEntries()
  const validation = validateMasterEntries(entries)

  if (!validation.canExport) throw new ExportBlockedError(validation)

  const zip = new JSZip()
  zip.file(PRODUCTS_FILE_NAME, serializeCsv(PRODUCT_COLUMNS, buildProductRows(entries)))
  zip.file(STOCK_FILE_NAME, serializeCsv(STOCK_COLUMNS, buildStockRows(entries)))

  return {
    zip: await zip.generateAsync({ type: 'nodebuffer' }),
    fileName: `lot-shopcaisse-${new Date().toISOString().slice(0, 10)}.zip`,
    validation,
  }
}
