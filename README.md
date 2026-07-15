# Lecteur CSV ShopCaisse

Mini-application Next.js permettant d’importer, contrôler, modifier et réexporter un fichier CSV localement.

## Pages automatiques

- `/tous-les-produits` : toutes les références
- `/sans-stock` : quantité vide, nulle ou négative
- `/sans-prix` : prix de vente vide, N/A ou égal à zéro
- `/avec-stock-et-prix` : quantité positive et prix de vente positif
- `/sans-famille` : famille ou catégorie vide

Les colonnes `Quantité`, `Valeur à la vente` et `Famille` sont détectées automatiquement. Le bouton **Configurer les colonnes** permet de corriger l’association si les intitulés du CSV sont différents.

Les données importées sont conservées dans `sessionStorage` afin de rester disponibles lors du passage d’une page à l’autre. Aucun fichier n’est envoyé à un serveur.

## Fonctionnalités

- import CSV avec détection du séparateur ; , ou tabulation ;
- navigation entre les pages prédéfinies avec compteur ;
- modification directe des cellules ;
- ajout et suppression de lignes ;
- recherche et filtres complémentaires ;
- pagination ;
- export complet ou export de la page active ;
- encodage UTF-8 avec BOM pour Excel.

## Installation

```bash
npm install
npm run dev
```

Ouvrir `http://localhost:3000`.

## Vérifications

```bash
npm run lint
npm run build
```
