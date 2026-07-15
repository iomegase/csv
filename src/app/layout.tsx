import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lecteur CSV',
  description: 'Importer, filtrer, modifier et exporter des fichiers CSV.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
