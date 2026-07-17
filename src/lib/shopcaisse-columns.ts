/**
 * Les intitulés ShopCaisse, à la lettre près.
 *
 * ShopCaisse apparie ses colonnes par intitulé exact : un accent ou une
 * apostrophe qui diverge rend la colonne introuvable côté caisse. C'est
 * pourquoi rien ici n'est reconstruit ni normalisé, et pourquoi le test
 * associé compare ces valeurs aux fichiers d'exemple réels plutôt qu'à des
 * chaînes recopiées à la main.
 */
export const COL = {
  identifiant: 'Identifiant',
  reference: 'Référence',
  nom: 'Nom',
  stockActuel: 'Stock actuel',
  stockSouhaite: 'Stock souhaité',
  mouvementStock: 'Mouvement stock',
  famille: 'Famille',
  rangs: 'Rangs',
  fournisseur: 'Fournisseur',
  tvaSurPlace: 'TVA sur place',
  tvaAEmporter: 'TVA à emporter',
  type: 'Type',
  codeBarre: 'Code barre',
  description: 'Description',
  unite: 'Unité',
  prixAchat: "Prix d'achat",
  gestionStock: 'Gestion du stock',
  affichageStock: 'Affichage du stock',
  couleurFond: 'Couleur de fond',
  texteBouton: 'Texte du bouton',
  prixTtc: 'PRIX TTC - Défaut - Mon Magasin Caisse 1',
  supprime: 'Supprimé',
  quantite: 'Quantité',
} as const

/** Le tableau maître : toutes les données produit + les colonnes de stock internes. */
export const MASTER_COLUMNS: readonly string[] = [
  COL.identifiant,
  COL.reference,
  COL.nom,
  COL.stockActuel,
  COL.stockSouhaite,
  COL.mouvementStock,
  COL.famille,
  COL.rangs,
  COL.fournisseur,
  COL.tvaSurPlace,
  COL.tvaAEmporter,
  COL.type,
  COL.codeBarre,
  COL.description,
  COL.unite,
  COL.prixAchat,
  COL.gestionStock,
  COL.affichageStock,
  COL.couleurFond,
  COL.texteBouton,
  COL.prixTtc,
  COL.supprime,
]

/**
 * Internes à l'application : elles servent à calculer la quantité à
 * transmettre, et ShopCaisse ne les connaît pas. Elles ne sortent dans aucun
 * export.
 */
export const STOCK_INTERNAL_COLUMNS: readonly string[] = [
  COL.stockActuel,
  COL.stockSouhaite,
  COL.mouvementStock,
]

/** `export-produits.csv`, à l'import comme à l'export : ordre imposé par ShopCaisse. */
export const PRODUCT_COLUMNS: readonly string[] = [
  COL.identifiant,
  COL.nom,
  COL.famille,
  COL.rangs,
  COL.fournisseur,
  COL.tvaSurPlace,
  COL.tvaAEmporter,
  COL.type,
  COL.codeBarre,
  COL.reference,
  COL.description,
  COL.unite,
  COL.prixAchat,
  COL.gestionStock,
  COL.affichageStock,
  COL.couleurFond,
  COL.texteBouton,
  COL.prixTtc,
  COL.supprime,
]

/** `export-stock.csv`. `Quantité` porte le mouvement, jamais le stock souhaité. */
export const STOCK_COLUMNS: readonly string[] = [
  COL.identifiant,
  COL.reference,
  COL.nom,
  COL.quantite,
]

/**
 * Colonne portant la quantité dans le fichier ShopCaisse « Visualisation des
 * stocks » — l'export que ShopCaisse PRODUIT et que l'on réinjecte comme
 * « Stock actuel ». À ne pas confondre avec `Quantité` de `STOCK_COLUMNS`, qui
 * est le format que ShopCaisse ATTEND à l'import (donc notre export à nous).
 * On lit le stock physique, pas `Stock effectif` (qui déduit les réservés).
 */
export const STOCK_VISUALISATION_QUANTITY = 'En stock'

export type MasterRow = Record<string, string | null>

/** Une ligne maître neuve : les 22 colonnes présentes, toutes vides (jamais 0). */
export function makeEmptyMasterRow(): MasterRow {
  return Object.fromEntries(MASTER_COLUMNS.map((column) => [column, null]))
}

export function isMasterColumn(column: string): boolean {
  return MASTER_COLUMNS.includes(column)
}
