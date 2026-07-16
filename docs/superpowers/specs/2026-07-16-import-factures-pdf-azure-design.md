# Lot 2 — Import de factures PDF (Azure Document Intelligence) — Design

**Goal :** doter l'application d'un espace administrateur permettant d'importer
une facture PDF, de l'analyser via Azure Document Intelligence, de corriger les
lignes extraites, puis de les convertir en CSV ShopCaisse au format du template
de référence actif — sans jamais inventer de donnée.

**Architecture :**

```text
PDF téléversé
→ stocké en base (octets bruts)
→ Azure Document Intelligence (prebuilt-invoice, async)
→ JSON Azure brut conservé
→ normalisation → InvoiceItem[] (format interne indépendant d'Azure)
→ correction par l'administrateur
→ conversion en CSV via le CsvTemplate actif (colonnes/ordre/séparateur/format)
→ téléchargement
```

**Tech Stack :** Next.js 16.2.10 (App Router), React 19.2.7, TypeScript,
Tailwind, Mongoose, Zod, `@azure-rest/ai-document-intelligence`, Vitest,
mongodb-memory-server. Réutilise les fondations du lot 1 (connexion MongoDB,
`CsvTemplate`, `CsvImport`, sérialisation CSV, `findColumn`/`normalizeHeader`).

Spec de référence lot 1 :
`docs/superpowers/specs/2026-07-15-lot-1-mongodb-template-catalogue-design.md`

---

## Contraintes globales

- **Réutiliser le lot 1, ne pas le dupliquer.** Le template de référence est le
  `CsvTemplate` **actif** (`getActiveTemplate()`). Les imports CSV sont les
  `CsvImport` existants. Seul le modèle `InvoiceImport` est nouveau.
- **Ne jamais inventer.** Référence, code-barres, prix, famille, rang, quantité,
  TVA absents ⇒ `null`, jamais `0`, `N/A`, ni valeur déduite. À l'export, `null`
  donne une cellule vide.
- **Format ShopCaisse exact.** Le CSV de facture emprunte au template actif ses
  colonnes, leur ordre et le séparateur ; fins de ligne `\r\n`, BOM UTF-8, ligne
  d'en-tête incluse — identique à l'export catalogue du lot 1.
- **Azure côté serveur uniquement.** `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` et
  `AZURE_DOCUMENT_INTELLIGENCE_KEY` ne sont jamais exposés au client. Aucun appel
  Azure depuis le navigateur.
- **Ne pas utiliser `pdf-parse` comme moteur principal** — ni comme secours dans
  ce lot. Azure est le seul moteur d'extraction.
- **Serverless (Vercel).** Pas de système de fichiers persistant : le PDF et les
  données extraites vivent en base. L'analyse Azure est asynchrone (statut +
  polling) pour tenir dans les limites de durée des fonctions.
- **Toutes les routes admin protégées** par le middleware (voir §Auth).
- **Toute entrée de route validée par Zod.** Tout identifiant Mongo validé par
  `mongoose.isValidObjectId` avant requête.

## Périmètre (et non-objectifs)

- **Inclus :** espace admin protégé, menu latéral, import + liste des templates
  CSV, import + liste + analyse + correction + validation + export + suppression
  + relance des factures.
- **Exclu (lots ultérieurs) :** la conversion produit un **CSV téléchargeable**,
  elle **n'alimente pas** le catalogue `CatalogProduct`. Les refs
  `createdFromInvoiceId` / `lastUpdatedFromInvoiceId` de `CatalogProduct` restent
  inertes. Pas de multi-utilisateurs (un seul mot de passe admin). Pas d'édition
  du mapping colonnes par l'admin (détection automatique par alias).

---

## Authentification admin

- **Secrets serveur :** `ADMIN_PASSWORD` (mot de passe admin), `SESSION_SECRET`
  (clé de signature HMAC du cookie). Jamais exposés au client.
- **Connexion :** page `/admin/login` → `POST /api/admin/login`. Le handler
  compare le mot de passe (comparaison à temps constant) ; en cas de succès il
  pose un cookie **httpOnly, SameSite=Lax, Secure en production**, nommé
  `admin_session`, contenant un jeton signé `HMAC-SHA256(payload, SESSION_SECRET)`
  où `payload` porte une date d'expiration (p. ex. 12 h).
- **Garde :** `src/middleware.ts` intercepte `/admin/:path*` et
  `/api/admin/:path*`. Cookie absent ou invalide/expiré ⇒ redirection vers
  `/admin/login` pour les pages, réponse `401 JSON` pour les routes API.
  `/admin/login` et `/api/admin/login` sont exemptés.
- **Déconnexion :** `POST /api/admin/logout` efface le cookie.
- **Vérification du jeton :** fonctions pures `signSession` / `verifySession`
  dans `src/lib/admin-auth.ts`, testées unitairement (signature valide, jeton
  falsifié rejeté, jeton expiré rejeté).

Le middleware n'utilise que l'API Web Crypto / `crypto` compatible edge pour la
vérification HMAC (pas d'accès Mongo dans le middleware).

---

## Modèle de données — `InvoiceImport`

Collection `invoiceimports`. Le PDF et les données extraites sont portés par le
document (pas de disque).

```ts
type InvoiceItem = {
  supplierReference: string | null
  barcode: string | null
  description: string | null
  quantity: number | null
  purchasePriceHT: number | null
  vatRate: number | null
  lineTotalHT: number | null
}

// Schéma Mongoose (résumé)
{
  originalFileName: string        // requis
  pdfContent: Buffer              // requis, BSON Binary (PDF original)
  fileSize: number                // requis
  status: 'pending' | 'processing' | 'succeeded' | 'error'  // défaut 'pending'
  azureModelId: string            // 'prebuilt-invoice'
  azureOperationLocation: string | null   // handle de polling async, défaut null
  azureRawResult: unknown | null           // JSON Azure brut (audit), défaut null
  items: InvoiceItem[]                      // normalisées puis corrigées, défaut []
  errorMessage: string | null              // message d'échec, défaut null
  templateIdAtConversion: ObjectId | null  // ref CsvTemplate figée à la validation
  validatedAt: Date | null                 // défaut null ; verrouille l'édition
  // timestamps: createdAt (= date d'import), updatedAt
}
```

- `InvoiceItem` est le **format interne**, indépendant de la structure Azure :
  toute la suite du pipeline ne dépend que de lui.
- Plafond `MAX_PDF_BYTES` (défaut 15 Mo) < limite 16 Mo d'un document MongoDB.

---

## Pipeline Azure (asynchrone, piloté par statut)

SDK `@azure-rest/ai-document-intelligence`, modèle `prebuilt-invoice`. Toute la
logique Azure est isolée dans `src/services/azure-invoice.service.ts`
(construction du client, soumission, polling) ; la normalisation est une
fonction pure séparée et testable sans réseau.

**Cycle de vie :**

1. **Upload** — `POST /api/admin/invoices` (multipart). Valide le PDF (voir
   §Validation), stocke les octets, `status='pending'`. Retourne `invoiceId`.
2. **Analyse** — `POST /api/admin/invoices/[id]/analyze`. Relit `pdfContent`,
   soumet à Azure (`beginAnalyze`), enregistre l'`operation-location`,
   `status='processing'`. Retour immédiat (requête courte).
3. **Poll** — `GET /api/admin/invoices/[id]`. Si `status='processing'` et
   `operationLocation` présent : un **seul** appel de sondage à Azure.
   - Azure « running » ⇒ renvoyer `processing` inchangé.
   - Azure « succeeded » ⇒ `azureRawResult` = JSON brut ; `items` =
     `normalizeAzureInvoice(raw)` ; `status='succeeded'`.
   - Azure « failed » ⇒ `status='error'`, `errorMessage` renseigné.
   Le client interroge cette route périodiquement (≈ 2 s) tant que `processing`.
4. **Relance** — `POST /api/admin/invoices/[id]/analyze` de nouveau : réinitialise
   `status='processing'`, `errorMessage=null`, resoumet. Autorisé depuis
   `error` (et depuis `succeeded` pour ré-analyser).

**Normalisation `normalizeAzureInvoice(raw): InvoiceItem[]`** (pure, testée) —
lit les `Items` du résultat `prebuilt-invoice` et projette champ par champ :

| InvoiceItem        | Champ Azure (item)     | Absent ⇒ |
|--------------------|------------------------|----------|
| supplierReference  | `ProductCode`          | `null`   |
| barcode            | (aucun champ dédié)    | `null`   |
| description        | `Description`          | `null`   |
| quantity           | `Quantity`             | `null`   |
| purchasePriceHT    | `UnitPrice` (montant)  | `null`   |
| vatRate            | `TaxRate` si fourni    | `null`   |
| lineTotalHT        | `Amount` (montant)     | `null`   |

- Aucun calcul dérivé : si Azure ne fournit qu'un montant de taxe et pas un taux,
  `vatRate` reste `null` (on n'infère pas le taux). `barcode` reste toujours
  `null` (le modèle facture n'expose pas de code-barres) — jamais inventé.
- Les montants Azure (objets `{ amount, currencyCode }`) sont réduits au nombre ;
  une valeur non numérique ⇒ `null`.

---

## Conversion `InvoiceItem[]` → CSV ShopCaisse

Module pur `src/lib/invoice-to-csv.ts`, testé sans base.

- **Mapping colonnes par alias**, en réutilisant `findColumn` / `normalizeHeader`
  du lot 1. Chaque champ `InvoiceItem` cherche sa colonne dans le template actif :

  | InvoiceItem       | Alias de colonne template (extrait)                         |
  |-------------------|-------------------------------------------------------------|
  | supplierReference | reference, référence, ref, code article, sku, code produit  |
  | barcode           | code barre, code barres, ean, ean13, gencod                 |
  | description       | nom, désignation, libellé, produit, article, description    |
  | quantity          | quantité, qté, qte, stock                                   |
  | purchasePriceHT   | prix d'achat, prix achat, prix achat ht, prix ht, coût      |
  | vatRate           | tva, taux tva, taux de tva                                  |
  | lineTotalHT       | total ht, montant ht, total                                 |

- **Construction du CSV :** en-tête = colonnes du template dans leur ordre
  (`position`). Pour chaque `InvoiceItem`, une ligne : chaque colonne reçoit la
  valeur du champ mappé, ou **vide** si la colonne n'est mappée à aucun champ ou
  si la valeur est `null`. Séparateur, `\r\n`, BOM et échappement via
  `serializeCsvValue` du lot 1.
- Une colonne du template sans correspondance (famille, rang…) reste **toujours
  vide** : on ne l'invente pas.
- Sans template actif : l'export échoue explicitement avec le message imposé du
  lot 1 (`NO_ACTIVE_TEMPLATE_MESSAGE`).
- **Quel template pour l'export ?** Si la facture est validée, on utilise
  `templateIdAtConversion` (figé à la validation), garantissant que le CSV
  téléchargé correspond au template en vigueur au moment de la validation. Sinon
  (export avant validation), on utilise le template **actif** courant.

---

## Pages & coquille admin

- **`src/app/admin/layout.tsx`** — coquille avec **menu latéral dynamique**
  (composant client, surlignage de l'item actif selon la route) à **2 items** :
  - **Import CSV** → `/admin/csv-template`
  - **Import facture** → `/admin/invoices`
  Plus un bouton de déconnexion. La coquille ne couvre que `/admin/*` ; les pages
  publiques (`/tous-les-produits`, `/catalogue`…) gardent leur en-tête actuel.
- **`/admin/login`** — formulaire de connexion (hors coquille).
- **`/admin/csv-template`** — importer un template CSV ShopCaisse + **liste de
  tous les imports CSV avec leur date** (`CsvImport`, triés par date). Indique le
  template actif. Réutilise `POST /api/csv-imports` et `from-import`.
- **`/admin/invoices`** — **liste de toutes les factures avec date et statut** ;
  lien vers l'import et vers le détail ; suppression.
- **`/admin/invoices/import`** — téléversement d'un PDF ; à la création, redirige
  vers le détail et lance l'analyse.
- **`/admin/invoices/[invoiceId]`** — détail : statut (avec polling tant que
  `processing`), tableau des `InvoiceItem` éditable (corriger une cellule,
  ajouter/supprimer une ligne), boutons **Valider**, **Télécharger le CSV**,
  **Supprimer**, **Relancer l'analyse** (visible si `error`/`succeeded`). Après
  validation, le tableau passe en lecture seule.

**Validation d'une facture :** `POST /api/admin/invoices/[id]/validate` pose
`validatedAt` et fige `templateIdAtConversion` = template actif courant. L'édition
des lignes est alors **verrouillée** (les routes de modification refusent une
facture validée). Le CSV reste téléchargeable.

---

## Routes API (toutes sous `/api/admin`, protégées)

| Route | Méthode | Rôle |
|---|---|---|
| `/api/admin/login` | POST | Connexion (exemptée de la garde) |
| `/api/admin/logout` | POST | Déconnexion |
| `/api/admin/invoices` | GET | Lister les factures (date, statut) |
| `/api/admin/invoices` | POST | Téléverser un PDF (validation), créer l'import |
| `/api/admin/invoices/[id]` | GET | Détail + poll Azure si `processing` |
| `/api/admin/invoices/[id]` | DELETE | Supprimer un import |
| `/api/admin/invoices/[id]/analyze` | POST | Lancer / relancer l'analyse |
| `/api/admin/invoices/[id]/items` | PUT | Remplacer les lignes corrigées (refus si validée) |
| `/api/admin/invoices/[id]/validate` | POST | Valider + verrouiller |
| `/api/admin/invoices/[id]/export` | GET | Télécharger le CSV ShopCaisse |

Le listing et l'import de templates CSV **réutilisent les routes existantes du
lot 1** (`/api/csv-imports`, `/api/csv-templates/*`), inchangées et laissées
publiques comme aujourd'hui (l'éditeur public s'en sert déjà). La garde admin du
middleware ne porte donc que sur `/admin/*` et `/api/admin/*` (les nouvelles
routes facture + auth). La page `/admin/csv-template`, elle, est protégée car
sous `/admin`.

---

## Validation des fichiers PDF

`assertPdfFile(fileName, mimeType, size, headerBytes)` (pure, testée) :

- taille `> 0` et `<= MAX_PDF_BYTES` (défaut 15 Mo) ;
- extension `.pdf` (insensible à la casse) ;
- type MIME `application/pdf` (ou `application/octet-stream` toléré) ;
- **octets d'en-tête `%PDF-`** (magic bytes) — la garantie réelle que c'est un
  PDF, indépendamment du nom et du type annoncé.

Le nom d'origine est nettoyé par `basename` (comme le CSV du lot 1).

---

## Plan de test (Vitest)

Fonctions pures et services, Azure et réseau **mockés** (aucune clé requise pour
les tests ; les appels réels nécessitent une ressource Azure) :

- `admin-auth` : `signSession`/`verifySession` — valide, falsifié, expiré.
- `assertPdfFile` : accepte un PDF, refuse extension/MIME/taille/magic bytes.
- `normalizeAzureInvoice` : projette les champs, met `null` pour l'absent, ne
  calcule pas la TVA, `barcode` toujours `null`, montants réduits au nombre.
- `invoice-to-csv` : respecte colonnes/ordre/séparateur du template, cellule vide
  pour colonne non mappée ou valeur `null`, en-tête + BOM + `\r\n`, échec sans
  template actif.
- `invoice-import.service` : upload stocke les octets et `status='pending'` ;
  `analyze` pose l'`operation-location` et `processing` (client Azure mocké) ;
  poll `succeeded` normalise et fige les items ; poll `failed` ⇒ `error` +
  message ; `validate` verrouille (PUT items refusé ensuite) ; delete supprime.
- Intégration : upload → analyze(mock) → poll succeeded → correction → validate →
  export CSV cohérent avec le template actif.

Vérification finale : `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## Variables d'environnement

| Variable | Rôle | Existante ? |
|---|---|---|
| `MONGODB_URI` | Connexion MongoDB | oui (lot 1) |
| `ADMIN_PASSWORD` | Mot de passe de l'espace admin | **nouveau** |
| `SESSION_SECRET` | Clé HMAC de signature du cookie de session | **nouveau** |
| `AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT` | Endpoint de la ressource Azure | **nouveau** |
| `AZURE_DOCUMENT_INTELLIGENCE_KEY` | Clé de la ressource Azure | **nouveau** |
| `MAX_PDF_BYTES` | Plafond de taille PDF (défaut 15 Mo) | **nouveau, optionnel** |

`.env.example` sera complété. Les 4 secrets doivent être définis dans Vercel.

---

## Couverture de la spec

| Exigence | Section |
|---|---|
| Menu latéral dynamique, 2 items | Pages & coquille |
| Lister les imports CSV avec date | `/admin/csv-template` |
| Lister les factures converties avec date | `/admin/invoices` |
| PDF → Azure → JSON normalisé → correction → CSV | Pipeline, Conversion |
| Ne pas utiliser pdf-parse | Contraintes |
| Azure Document Intelligence | Pipeline |
| Conserver PDF + données extraites en base | Modèle `InvoiceImport` |
| Dernier CSV comme template de référence | Contraintes (template actif) |
| Colonnes/ordre/séparateur/format exacts | Conversion |
| Cellules vides si donnée absente | Contraintes, Conversion |
| Ne jamais inventer | Contraintes, Normalisation |
| Pages /admin/csv-template, /admin/invoices(+import, +[id]) | Pages |
| Importer template CSV / PDF | Pages, Routes |
| Consulter/corriger, ajouter/supprimer une ligne | `/admin/invoices/[id]`, Routes |
| Valider la facture | Validation |
| Télécharger le CSV généré | Routes (export) |
| Supprimer un import | Routes (DELETE) |
| Relancer une analyse en erreur | Pipeline (relance) |
| Collections csvTemplates, invoiceImports | Réutilise `csvtemplates`, ajoute `invoiceimports` |
| Format interne InvoiceItem | Modèle |
| Routes admin protégées | Auth |
| Clés Azure côté serveur | Contraintes, Pipeline |
| Valider les fichiers PDF | Validation PDF |
