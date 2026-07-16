# Lecteur CSV ShopCaisse

Mini-application Next.js permettant d’importer, contrôler, modifier et réexporter un fichier CSV localement.

## Pages automatiques

- `/tous-les-produits` : toutes les références
- `/sans-stock` : quantité vide, nulle ou négative
- `/sans-prix` : prix de vente vide, N/A ou égal à zéro
- `/avec-stock-et-prix` : quantité positive et prix de vente positif
- `/sans-famille` : famille ou catégorie vide

Les colonnes `Quantité`, `Valeur à la vente` et `Famille` sont détectées automatiquement. Le bouton **Configurer les colonnes** permet de corriger l’association si les intitulés du CSV sont différents.

L’éditeur travaille sur le fichier que vous importez : les données restent dans `sessionStorage` et rien n’est envoyé à un serveur tant que vous ne cliquez pas sur **Définir comme template actif**. Ce bouton téléverse le CSV, l’analyse côté serveur et alimente le catalogue MongoDB, sans quitter votre fichier. Le catalogue se consulte à part via le lien **Voir le catalogue** (page `/catalogue`).

## Fonctionnalités

- import CSV avec détection du séparateur ; , ou tabulation ;
- navigation entre les pages prédéfinies avec compteur ;
- modification directe des cellules ;
- ajout et suppression de lignes ;
- recherche et filtres complémentaires ;
- pagination ;
- export complet ou export de la page active ;
- encodage UTF-8 avec BOM pour Excel.

## Développement

```bash
npm install
cp .env.example .env.local
npm run mongo:start   # MongoDB dédié, port 27018, replica set (transactions)
npm run dev
```

`npm run mongo:start` est à relancer après chaque redémarrage de la machine.
Les transactions exigent un replica set : le service MongoDB par défaut du port
27017, en standalone, ne convient pas.

Ouvrir `http://localhost:3000`.

### Mise en route du catalogue

1. Importer un CSV ShopCaisse depuis `/tous-les-produits`.
2. Cliquer « Définir comme template actif » : le template est créé et le
   catalogue synchronisé.
3. Consulter `/catalogue` et exporter au format ShopCaisse.

### Tests

```bash
npm test
```

## Vérifications

```bash
npm run lint
npm run build
```
