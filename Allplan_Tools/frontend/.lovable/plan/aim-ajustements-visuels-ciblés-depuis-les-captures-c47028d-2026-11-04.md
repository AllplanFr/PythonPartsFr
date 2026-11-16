# AIM — Ajustements visuels ciblés depuis les captures c47028d

## Périmètre

Préparer un delta frontend distinct, après validation de ce plan. La candidate native c47028d n’est ni reconstruite ni remplacée à cette étape. Les trois captures annotées du 4 novembre servent de références d’implantation, pas de preuve du cycle temporel des aides.

Conserver les valeurs, la sélection, les règles de disponibilité, les aides corrigées, les contrats Python et les parcours de déplacement. Aucun changement de `get_initial_data`, de délai de chargement, de backend ou d’application des valeurs à Allplan.

## Diagnostic ciblé

- **Démarrage sans présentation :** `AimEditor.tsx` possède une branche native distincte (`aim-contract-attributes`) qui rend en dur N°, Titre et Valeur. Elle n’utilise pas les options de visibilité du menu Colonnes. Ce branchement explique les colonnes absentes malgré « Colonnes 4/4 » ; il ne démontre pas un défaut des données Python.
- **Après import :** les rendus V1 et V2 utilisent les options N°, Titre, Saisie et Donnée ; Valeur reste toujours présente. Les actions passent dans Valeur lorsque Donnée est masquée.
- **Bande ∅ :** le bouton appartient à `InlineWorkingValue`, après le support Reset. Retirer son bouton et son espace exclusif ne nécessite ni suppression de null ni suppression du support Reset.
- **Flèches :** V1 ajoute Monter/Descendre dans les outils des lignes configurées. Le déplacement par poignée et menu est distinct. Ne pas retirer les commandes de groupe ni les autres flèches de l’interface par assimilation.
- **Voyant :** l’ancien point utilise `dirty ? status-modified : success`, avec le texte modifié/non modifié. Il représente l’état d’édition, pas la connexion, le chargement du projet ou une écriture Allplan. Son bloc est actuellement caché pour le contrat natif reconnu. Le texte « Modifications en mémoire » est, lui, placé séparément en bas à droite et peut empiéter sur Quitter.

## Rendu proposé

### 1. Valeur et actions de ligne

- Retirer ∅ et sa place dans toutes les vues utilisant l’éditeur direct, y compris avant import.
- Garder le support Reset à sa largeur actuelle, même vide. Reset restaure toujours la source exacte Python, y compris null, chaîne vide et zéro.
- Retirer les boutons haut/bas des lignes configurées et uniquement leur espace dédié. Garder la poignée, Déplacer et ses destinations, ainsi que les autres parcours existants.
- Proposer ce placement identique pour les lignes configurées et Hors présentation :

```text
N° + poignée | Titre | Valeur + support Reset | Saisie | Donnée : type … Déplacer Éditer Supprimer
```

- Le groupe Déplacer / Éditer / Supprimer reste à droite, dans les limites de la cellule Donnée, dans cet ordre. Le glyphe type reste identifiable à gauche de ce groupe. Réutiliser les dimensions et espacements des boutons existants ; réserver la largeur nécessaire à l’ensemble type + trois actions, plutôt que laisser les actions déborder.
- Si Donnée est masquée : même groupe à droite de Valeur, après le support Reset, sans modifier la place de Saisie. Aucun ajout d’une cinquième option au menu Colonnes.
- Conserver l’affichage conditionnel existant des outils selon survol/sélection/focus ; leur place réservée évite les sauts de mise en page.

### 2. Projet chargé sans présentation

- Respecter les mêmes quatre options de visibilité et l’ordre N°, Titre, Valeur, Saisie, Donnée ; ne pas imposer un import pour afficher les en-têtes et cellules.
- Réutiliser le traitement déjà établi pour les attributs natifs Hors présentation : champ STR et indicateurs existants, sans interpréter de nouvelles métadonnées natives ni prétendre à une autorisation Allplan.
- Afficher la zone Déplacer / Éditer / Supprimer : Éditer et Supprimer restent indisponibles ; Déplacer reste bloqué tant qu’aucune destination de présentation réelle n’existe. Ne pas créer une configuration, un groupe ou un identifiant d’occurrence pour rendre ce bouton actif.
- Sans capacité de travail ou en lecture seule : conserver les valeurs lisibles et les contrôles réellement bloqués. Le rendu supplémentaire ne change pas les données.
- Après import V1/V2 : conserver les modèles, contrôles typés et destinations confirmés par Python, avec le placement proposé ci-dessus.

### 3. Bas de fenêtre et état réel

- Retirer uniquement l’affichage inférieur de « Importez une présentation organisée avant de modifier sa configuration ». Garder le refus fonctionnel correspondant et les autres erreurs utiles.
- Rétablir le point associé à l’état d’édition dans le pied natif : vert pour un état confirmé sans modification en attente ; couleur de modification pour les changements de travail ou de configuration en attente, selon l’état existant. Sans état confirmé, ne pas afficher un faux état vert.
- Libellé explicite : « Aucune modification en attente » ou « Modifications en mémoire / Configuration en attente », selon les signaux disponibles. Aucun libellé de sauvegarde ou d’application Allplan.
- Retirer le texte flottant séparé et placer cet état dans le pied de fenêtre, avant Quitter. Le chemin projet garde la zone flexible principale et son chemin complet accessible dans l’aide ; les états et Quitter gardent leur place. Si la largeur ne suffit pas, une seconde ligne dédiée aux informations d’état est préférable à une superposition.
- Ne pas réutiliser ce voyant pour la disponibilité de l’hôte. Conserver séparément les diagnostics existants de projet et d’hôte.

## Fichiers concernés

### Application
- `src/modules/information_manager/AimEditor.tsx` : branche native initiale, bouton ∅, garde Reset, message et état du pied.
- `src/modules/information_manager/components/organized-presentation.tsx` : flèches de ligne V1 et placement des outils.
- `src/modules/information_manager/components/tree-presentation.tsx` : cohérence du placement V2 et des actions dans Valeur.
- `src/modules/information_manager/components/aim-columns.tsx` : réutiliser la définition existante des quatre options ; ajuster seulement si la mutualisation du rendu le nécessite.
- `src/modules/information_manager/aim.css` : largeur/alignement ciblés des cellules et outils, pied de fenêtre ; pas de refonte du style des lignes.
- `unavailable-row-actions.tsx` et le cycle partagé des aides : réutilisation, sans changement prévu.

### Tests ciblés à adapter après autorisation
- `src/test/information_manager/aim-inline-value.test.tsx` : remplacer uniquement les attendus liés à ∅ retiré ; conserver null/vide/zéro, validation unique, Échap, lecture seule, refus/stale et Reset exact avec support vide.
- `src/test/information_manager/aim-columns-import.test.tsx` : ajouter le projet chargé sans présentation et vérifier les en-têtes ET cellules ; couvrir V1/V2, masquage Saisie/Donnée et actions dans Valeur sans mutation de configuration ni des valeurs.
- `src/test/information_manager/aim-working-restoration.test.tsx` : état confirmé propre/modifié/en attente, absence de faux voyant de sauvegarde, protections toujours actives sans le message inférieur.
- Réutiliser les tests de déplacements existants pour confirmer poignée/menu V1/V2 et absence des boutons haut/bas de ligne, sans retirer les autres parcours.
- Vérification visuelle ciblée après autorisation : trois actions sans débordement, support Reset vide stable, noms longs, pied étroit et chemin long sans chevauchement de Quitter. Les tests DOM ne prouvent pas cette géométrie ; la conformité WebView2 nécessite une comparaison native.

## Validation et limites

Aucun test ni build exécuté pour ce plan. Le voyant est identifié par le code ; il ne constitue pas une preuve de disponibilité native. Les captures permettent de proposer le placement, mais ne valident ni les délais d’aide ni toutes les largeurs de fenêtre.

Attendre validation du placement et de ce plan avant tout changement applicatif. Aucun build, assemblage, déploiement, publication ou nouvelle candidate dans cette étape.