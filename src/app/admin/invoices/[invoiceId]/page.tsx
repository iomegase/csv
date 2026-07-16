import { InvoiceDetail } from '@/components/admin/InvoiceDetail'

export const dynamic = 'force-dynamic'

export default async function AdminInvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>
}) {
  const { invoiceId } = await params
  return <InvoiceDetail invoiceId={invoiceId} />
}
