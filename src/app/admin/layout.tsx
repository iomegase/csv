export default function AdminLayout({ children }: { children: React.ReactNode }) {
  // Le menu vient du layout racine ; l'admin ne fournit que l'espacement,
  // car ses pages n'ont pas de padding propre.
  return <div className="overflow-x-auto p-6 md:p-8">{children}</div>
}
