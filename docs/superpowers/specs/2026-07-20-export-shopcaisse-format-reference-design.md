# Export ShopCaisse strictement aligné sur les fichiers de référence — design

## Intention

Le lot ZIP exporté par l'application doit produire deux CSV dont le format est
strictement identique aux fichiers ShopCaisse fournis le 20 juillet 2026 :

- `Produits_du_20260719_0549.csv` ;
- `Visualisation_des_stocks_du_20260719.csv`.

Les fichiers fournis font autorité sur les intitulés, l'ordre des colonnes,
l'encodage et le séparateur.

## Décisions validées

1. Le ZIP conserve deux CSV, construits à partir de la même liste de produits.
2. Le CSV produits porte exactement les 19 colonnes du fichier Produits fourni,
   dans le même ordre.
3. Le CSV stocks porte exactement les 13 colonnes du fichier Visualisation des
   stocks fourni, dans le même ordre. L'ancien format interne à quatre colonnes
   `Identifiant;Référence;Nom;Quantité` disparaît de l'export ZIP.
4. Les trois colonnes de travail `Stock actuel`, `Stock souhaité` et
   `Mouvement stock` restent internes au tableau maître et ne sont exportées
   dans aucun CSV.
5. Les deux CSV sont sérialisés en UTF-8 avec BOM, séparateur `;`. Les fichiers
   de référence utilisent des fins de ligne LF ; l'export reproduit ce format.
6. Une valeur source absente reste vide. L'export n'invente ni réservation, ni
   prix, ni valeur de stock.

## Schémas contractuels

### CSV produits

```text
Identifiant;Nom;Famille;Rangs;Fournisseur;TVA sur place;TVA à emporter;Type;Code barre;Référence;Description;Unité;Gestion du stock;Affichage du stock;PRIX TTC - Défaut - Mon Magasin Caisse 1;Couleur de fond;Texte du bouton;Supprimé;Prix d'achat
```

### CSV stocks

```text
Identifiant;Nom;Référence;En stock;Mon Magasin;Réservés client;Réservés fournisseur;Stock effectif;Prix d'achat H.T.;Valeur H.T.;Prix par défaut;Fournisseur;Famille
```

## Données et transformation

- L'import du fichier Visualisation des stocks conserve désormais les 13
  cellules source de chaque produit, au lieu de ne garder que `En stock`.
- `Stock actuel` continue d'être alimenté par `En stock` pour les calculs du
  tableau maître.
- À l'export, les cellules stocks conservées sont réémises dans leur ordre
  d'origine. Les champs d'identité (`Identifiant`, `Nom`, `Référence`) et les
  données communes disponibles dans le maître (`Prix d'achat`, prix par défaut,
  fournisseur, famille) suivent la version courante du produit.
- Quand `Stock souhaité` est renseigné, il devient la valeur exportée dans
  `En stock`; sinon l'export conserve `Stock actuel`. Les autres valeurs stock
  importées restent inchangées. Une cellule inconnue reste vide.
- Les produits absents du dernier fichier stocks restent présents dans le CSV
  stock pour maintenir l'alignement ; seules les cellules connues sont remplies.

## Validation et erreurs

- L'export reste bloqué en présence des conflits d'identité déjà contrôlés.
- Les deux fichiers doivent conserver le même nombre de lignes et le même ordre
  pour `Identifiant`, `Nom` et `Référence`.
- Les en-têtes sont comparés caractère par caractère aux deux fixtures copiées
  depuis les fichiers fournis.

## Tests

1. Un test de colonnes compare les deux en-têtes générés aux fichiers de
   référence, sans recopier les chaînes attendues dans le test.
2. Un test de ligne produit verrouille l'ordre réel, notamment `Prix d'achat`
   en dernière position.
3. Un test de ligne stock verrouille les 13 cellules et la priorité de
   `Stock souhaité` sur `Stock actuel` pour `En stock`.
4. Un test d'import/export vérifie la conservation des colonnes stocks source.
5. Un test du bundle ouvre le ZIP et compare les deux en-têtes, le BOM, les
   fins de ligne et la liste exacte des fichiers.

## Hors périmètre

- Refonte visuelle du tableau maître.
- Modification du calcul interne de `Mouvement stock`.
- Synchronisation directe par API avec ShopCaisse.
