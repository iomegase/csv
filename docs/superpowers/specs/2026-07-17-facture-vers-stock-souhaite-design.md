# Factures → Stock souhaité, et Référence facultative — design

## Intention

Rendre exportables vers ShopCaisse les produits reçus par facture (un Nom, une
quantité, ni Identifiant ni Référence), et faire remonter la quantité reçue comme
un mouvement de stock.

## Décisions (validées)

1. **Référence facultative.** Un « nouveau produit » (ni Identifiant ni Référence)
   n'exige plus de Référence à l'export. Restent obligatoires : un **Nom** et un
   **Stock souhaité (quantité) strictement positif**.
2. **Quantité de facture → Stock souhaité.** La quantité reçue alimente le
   `Stock souhaité` (la cible), pas le `Stock actuel`. Ainsi la règle « Stock
   souhaité obligatoire » est satisfaite, et l'export envoie un mouvement =
   quantité reçue. Vaut pour les produits créés comme pour les existants.

## Changements

### A. Validation — `src/services/shopcaisse-validation.service.ts`

Dans `rowBlockers`, retirer le bloqueur « Référence obligatoire pour un nouveau
produit. ». On garde « Nom obligatoire » et « Stock souhaité obligatoire et
strictement positif ».

### B. Facture → catalogue — `src/services/invoice-catalog.service.ts`

La quantité reçue alimente `Stock souhaité` au lieu de la colonne de stock
auto-détectée, et le `Mouvement stock` est recalculé :

- **Produit existant apparié** : `Stock souhaité ← (Stock souhaité ?? Stock
  actuel ?? 0) + quantité reçue`. `Mouvement stock ← Stock souhaité − Stock actuel`.
- **Nouveau produit** : `Stock actuel = 0` (ShopCaisse ne l'a pas encore, c'est
  factuel), `Stock souhaité = quantité reçue`, `Mouvement stock = quantité reçue`.
  Plus le `Nom` (identité). Ni Identifiant ni Référence inventés.

`Mouvement` reste vide si `Stock actuel` d'un produit existant est inconnu
(jamais de zéro inventé pour un produit que ShopCaisse pourrait déjà stocker).

## Tests

- Validation : un nouveau produit **sans Référence** mais avec Nom + Stock
  souhaité > 0 est exportable ; l'ancien bloqueur « Référence obligatoire »
  disparaît ; le Nom et le stock restent exigés.
- Facture : une quantité reçue alimente `Stock souhaité` et un `Mouvement` =
  quantité ; un nouveau produit de facture a `Stock actuel = 0`, `Stock souhaité
  = quantité`, `Mouvement = quantité`, et passe la validation d'export.
