# Accès libre, menu global, application des factures au catalogue

Date : 2026-07-16

## Contexte

L'application Next.js « Lecteur CSV ShopCaisse » importe, contrôle et
réexporte des CSV. Un espace `/admin` (protégé par mot de passe) gère les
templates CSV et l'import de factures PDF analysées par Azure Document
Intelligence. Le catalogue MongoDB (`/catalogue`) est la source de vérité du
stock, alimenté par `syncCatalogFromCsv` (écrasement complet à partir d'un CSV).

Le modèle `CatalogProduct` réserve déjà des champs dormants
`createdFromInvoiceId` / `lastUpdatedFromInvoiceId` pour l'application des
factures au catalogue — c'est le cœur de ce lot.

## Objectifs

1. **Accès libre** : supprimer l'authentification admin ; toute l'application
   est accessible sans connexion.
2. **Menu latéral global** : un `<aside>` visible sur tout le site avec 4 items
   (Accueil, Factures, Stock/Catalogue, Import CSV).
3. **Suppression d'imports** : corbeille sur les factures et sur les imports CSV,
   avec confirmation.
4. **Appliquer une facture au catalogue** : pousser les quantités d'une facture
   validée dans le catalogue en **ajoutant** au stock existant (facture = achat /
   marchandise reçue).

## Décisions

- **D1 — Stock additif.** Pour un produit déjà présent :
  `nouveau stock = stock actuel + quantité facture`. On ne remplace pas.
- **D2 — Création des inconnus.** Un produit de la facture absent du catalogue
  est créé (cohérent avec `syncCatalogFromCsv`).
- **D3 — Menu global à 4 items.** Accueil (`/`), Factures (`/admin/invoices`),
  Stock (`/catalogue`), Import CSV (`/admin/csv-template`). Affiché sur toutes
  les pages via le layout racine.
- **D4 — Déclencheur explicite.** L'application au catalogue se fait via un
  bouton dédié « Appliquer au catalogue », disponible seulement après validation
  de la facture, avec récapitulatif (créés / mis à jour / ambigus).
- **D5 — Anti double comptage.** Une facture déjà appliquée ne peut pas l'être à
  nouveau (champ `appliedToCatalogAt`).
- **D6 — Pas de colonne quantité → erreur.** Si le template actif n'a pas de
  colonne stock reconnaissable, l'application échoue avec un message explicite ;
  on n'invente pas de colonne.

## Périmètre

### 1. Suppression de l'authentification

- Supprimer la garde `src/proxy.ts` (garde edge sur `/admin/*` et
  `/api/admin/*`).
- Supprimer la page `src/app/admin/login/page.tsx` et les routes
  `src/app/api/admin/login/route.ts` et `src/app/api/admin/logout/route.ts`.
- Supprimer `src/lib/admin-auth.ts` et `tests/lib/admin-auth.test.ts`.
- Retirer le bouton « Déconnexion » du sidebar.
- Nettoyer les références à `ADMIN_PASSWORD` / `SESSION_SECRET` dans
  `.env.example`, `.env.local` (documenter), et le README.
- Les routes `/api/admin/*` demeurent mais ne sont plus gardées.

### 2. Menu latéral global

- Généraliser `src/components/admin/AdminSidebar.tsx` en un composant
  `AppSidebar` (nouveau nom / nouvel emplacement `src/components/AppSidebar.tsx`).
- Items :
  - Accueil → `/` (icône Home)
  - Factures → `/admin/invoices` (icône FileText)
  - Stock → `/catalogue` (icône Package)
  - Import CSV → `/admin/csv-template` (icône FileSpreadsheet)
- Item actif surligné selon `usePathname` (préfixe).
- Monter le sidebar dans le **layout racine** `src/app/layout.tsx` :
  `<div class="flex min-h-screen"><AppSidebar/><main class="flex-1">{children}</main></div>`.
- `src/app/admin/layout.tsx` ne fait plus que rendre ses enfants (le sidebar et
  le padding viennent du layout racine).
- Vérifier que les pages existantes (`/`, `/catalogue`, vues produit) restent
  correctes dans ce cadre (elles ont déjà leur propre `main` / padding — ajuster
  pour éviter le double `main`).

### 3. Suppression d'imports (corbeille)

- **Factures** : la corbeille existe déjà dans `InvoicesList.tsx` et
  `InvoiceDetail.tsx`. Ajouter une confirmation (`window.confirm`) avant l'appel
  `DELETE`.
- **Import CSV** : s'assurer que `CsvTemplateManager.tsx` expose une corbeille
  par import (via `DELETE /api/admin/csv-imports` — vérifier l'existence de la
  route ; l'ajouter si absente) avec confirmation.

### 4. Application d'une facture au catalogue

#### Modèle

- `src/models/InvoiceImport.ts` : ajouter `appliedToCatalogAt: Date | null`
  (défaut `null`).

#### Service — `src/services/invoice-catalog.service.ts`

`applyInvoiceToCatalog(invoiceId: string): Promise<ApplyInvoiceSummary>`

Étapes :

1. Charger la facture. Exiger `validatedAt` non nul et `appliedToCatalogAt` nul,
   sinon lever une erreur métier (statut 409).
2. Charger le template actif. Détecter la colonne stock via
   `detectColumnMapping(columns).stock`. Si absente → erreur (D6).
3. Charger le catalogue non supprimé et l'indexer en mémoire par
   `reference` / `barcode` / `nameSupplier` (réutiliser `normalizeMatchValue`,
   `nameSupplierKey`, la logique d'appariement de `catalog-sync.service.ts` —
   extraire/partager si utile, sans introduire de couplage inutile).
4. Pour chaque ligne de facture (`InvoiceItem`) :
   - Construire une identité { reference: supplierReference, barcode,
     name: description } et chercher un match (reference → barcode → nom+
     fournisseur — le fournisseur de la facture n'existe pas au niveau ligne ;
     n'utiliser nom seul que si une clé `nameSupplier` est disponible, sinon
     s'appuyer sur reference/barcode).
   - **Match unique** : lire le stock actuel
     (`parseLocalizedNumber(csvData[stockCol]) ?? 0`), ajouter
     `item.quantity ?? 0`, réécrire `csvData[stockCol]` (chaîne), positionner
     `lastUpdatedFromInvoiceId`. `updated += 1`.
   - **Aucun match** : créer un `CatalogProduct` à partir du mapping
     champ→colonne de `invoice-to-csv.ts` (mêmes alias), stock = `quantity`,
     `createdFromInvoiceId = invoiceId`, `originalCsvData = csvData`.
     `created += 1`.
   - **Ambigu** (plusieurs candidats) : ne rien écrire, ajouter au récap
     `ambiguous`.
5. Écrire via `bulkWrite` (par lots), hors transaction (idempotence assurée par
   `appliedToCatalogAt`).
6. Positionner `appliedToCatalogAt = now` sur la facture.
7. Retourner `ApplyInvoiceSummary`.

```ts
interface ApplyInvoiceSummary {
  updated: number
  created: number
  ambiguous: Array<{ row: number; matchedBy: string; candidateIds: string[] }>
  skipped: Array<{ row: number; reason: string }> // ex. quantité null
}
```

#### API — `POST /api/admin/invoices/[invoiceId]/apply-to-catalog`

- Renvoie `{ summary }` (200) ou `{ error, message }` (409 déjà appliquée /
  non validée, 422 pas de colonne stock, 404 introuvable).

#### UI — `InvoiceDetail.tsx`

- Après validation (`invoice.validatedAt` non nul) et si `appliedToCatalogAt`
  nul : bouton **« Appliquer au catalogue »**.
- Au succès : afficher le récap (« 8 mis à jour, 2 créés, 1 ambigu ») et
  masquer le bouton (facture désormais appliquée).
- Exposer `appliedToCatalogAt` dans la réponse `GET /api/admin/invoices/[id]`.

## Tests (TDD)

- `tests/services/invoice-catalog.service.test.ts` :
  - ajout de stock sur produit existant (10 + 6 = 16) ;
  - création d'un produit inconnu (stock = quantité) ;
  - appariement par barcode et par reference ;
  - cas ambigu → non appliqué, listé ;
  - quantité `null` → `skipped` (ou +0), pas de crash ;
  - re-application bloquée (409) ;
  - template sans colonne stock → erreur (D6).
- Supprimer `tests/lib/admin-auth.test.ts`.
- Ajuster tout test dépendant de la garde d'auth.

## Hors périmètre (YAGNI)

- Annulation / rollback d'une application de facture.
- Rôles, multi-utilisateurs, journalisation d'audit.
- Fusion de doublons ambigus (on les signale, l'utilisateur tranche).

## Vérifications

- `npm test`
- `npm run lint`
- `npm run build`
- Parcours manuel : import facture → analyse → validation → « Appliquer au
  catalogue » → vérifier le stock dans `/catalogue`.
