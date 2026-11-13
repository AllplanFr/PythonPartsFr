# AIM — diagnostic ciblé du retour natif 3001786

## Cadre
Révision inspectée : `3001786f16b9f1dd00489f1cea63a8014197f255`, arbre `1a043ff275eddafe0d33f0c44e58f6aa627b4c7f`, identiques au lot testé. Aucun changement de sources ou de tests, aucune exécution de test/build, aucun assemblage ni publication dans cette analyse.

La recette fournie établit un import V1 et des observations partielles de Reset ; elle ne constitue pas une recette native complète. V2 n’a pas été exécutée. Les traces sans payload ne prouvent pas le retour exact à null, vide ou "0".

## 1. Aide STR : défaut de portée démontrable, persistance native non reproduite
En V1, le titre STR appartient à toute la cellule Donnée, actions incluses. Le composant d’aide ignore une nouvelle cible située à l’intérieur du déclencheur actif : passer de STR à une action imbriquée peut donc conserver l’aide STR au lieu de prendre l’aide plus précise.

En V2, le titre appartient seulement au support de l’icône : les actions sont à côté. Cet emboîtement n’existe pas.

Le code ferme l’aide à la sortie réelle du déclencheur, au blur et au pointerdown. Un focus conservé ne neutralise pas cette fermeture ; un nouvel événement de focus peut rouvrir une aide. La capture décrite montrant STR et « Non disponible » simultanément ne suffit pas à attribuer toute la persistance à l’emboîtement V1 : le composant AIM n’affiche qu’une aide à la fois.

**Delta minimal proposé, après autorisation :** en V1, déplacer le titre de type de la cellule vers le support existant de l’icône, comme en V2, pour les lignes ordinaires et Hors présentation. Aucun changement de dimensions, d’ordre, de sélection ou de gestion globale des aides. Préserver les supports focusables et les boutons Éditer/Supprimer désactivés.

**Vérification ciblée proposée :** ouvrir STR, déplacer réellement le pointeur vers Éditer puis Supprimer, puis hors de la cellule ; refaire au clavier en relevant le focus. Si STR subsiste après une sortie réelle, qualifier ce second défaut avant d’élargir la correction.

## 2. Hors présentation : correction géométrique non justifiée à ce stade
La référence `image-55.png` est disponible. La capture native `2026-11-04_12-45-50.png` citée n’est pas jointe aux fichiers reçus. Le compte rendu conserve l’ordre ABC / Déplacer / Éditer / Supprimer et ne démontre ni absence de Reset/Saisie ni différence de largeur.

**Éléments nécessaires :** transmettre la capture native et une vue équivalente à la référence montrant la ligne complète, poignée et Reset compris, avec les en-têtes ; préciser l’élément non conforme. Comparer à zoom/échelle connus, avec Donnée visible et un état de Reset comparable. L’encadré rouge de référence n’est pas une décoration à reproduire.

Aucun changement arbitraire de taille, d’espacement ou d’ordre proposé. L’emplacement vide de Reset reste exigé.

## 3. Tests ciblés proposés, non exécutés
- Cycle de l’aide AIM : ouverture après délai existant, annulation avant ouverture, fermeture à la sortie/blur/pointerdown, sans réouverture par un ancien délai.
- Passage STR → Éditer/Supprimer en V1/V2 avec Donnée visible : l’aide suivante remplace STR ; sortie et blur ferment l’aide ; les actions restent désactivées et accessibles au clavier.
- Conserver le test existant V1/V2 avec Donnée masquée : aides au focus et actions dans Valeur, sans mutation. Ne pas lancer de campagne générale.

## Fichiers techniques concernés
- Delta proposé : `src/modules/information_manager/components/organized-presentation.tsx` (titre de type, lignes 172 et 200).
- Références sans modification prévue : `components/tree-presentation.tsx` (lignes 461–467 et 644–645), `components/app-tooltips.tsx` (lignes 23–48), `components/unavailable-row-actions.tsx`.
- Tests : compléter `src/test/information_manager/aim-inline-value.test.tsx` ; si nécessaire créer une petite suite ciblant directement le composant d’aide AIM. `src/test/app-tooltips.test.tsx` cible celui de SmartCatalog, pas celui d’AIM.
- Géométrie à comparer seulement après réception de la preuve : `src/modules/information_manager/aim.css` et tableaux V1/V2 ; aucun delta CSS justifié actuellement.

## Hors périmètre
- Retrait de « Définir comme non renseigné » : demande séparée, non appliquée ; préciser ultérieurement les vues/contrôles. Préserver support null, attributs absents et Reset vers null.
- Timeout de `get_initial_data` incluant le sélecteur natif : défaut antérieur, non corrigé par le chargement depuis l’historique ; cadrage frontend/Python distinct requis.
- Aucun changement Python, contrat, capacité, écriture finale Allplan ou autre plugin.

## Décision attendue
Autorisation du seul ajustement de portée STR V1 et des tests ciblés ; la géométrie reste en attente des captures comparables. Le lot livré 3001786 reste figé.