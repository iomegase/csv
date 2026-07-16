import type { Metadata } from 'next'
import { AppSidebar } from '@/components/AppSidebar'
import './globals.css'

export const metadata: Metadata = {
  title: 'Lecteur CSV',
  description: 'Importer, filtrer, modifier et exporter des fichiers CSV.',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      {/* Les extensions de navigateur (ColorZilla, Grammarly…) ajoutent des
          attributs au body avant l'hydratation, ce que le serveur ne peut pas
          anticiper. La suppression ne porte que sur le body lui-même : les
          écarts dans les enfants continuent d'être signalés. */}
      <body suppressHydrationWarning>
        <div className="flex min-h-screen bg-slate-50">
          <AppSidebar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  )
}
