# Regroupement frontend — Suite Allplan

Intégrer les trois **applications complètes comme modules pairs**, sans modifier leur présentation métier ni les anciens projets. Le regroupement reste exclusivement dans cette variante ; aucun déploiement, changement de domaine, acceptation ou migration de données.

## Sources vérifiées
- SmartCatalog/VOB : projet `297630a7-1565-46a1-be88-827e783d171d`, HEAD local observé avant nos modifications `d70f3530521c697c1b51973674740d89839936a4` (différent du `0a3f54f` précédemment signalé).
- AIM : notre propre checkout complet du projet `3dd96c97-fb88-4d2d-8a0b-af87035cbf10`, révision `39011c34`, 123 fichiers. Sa page métier comporte 1 409 lignes et ses composants, traductions, sauvegardes et contrôles sont disponibles.
- Les dépendances déclarées des deux projets sont identiques : conserver TanStack Start, React 19 et le routeur existant, sans nouveau framework.
- Le document utilisateur `lovable_regroupement_suite_allplan.md` a été lu. La recette SmartCatalog `drft_01m5vg04qrf11s2mvyxgee8feg` reste une variante distincte, non absorbée et non activée ici.

## Résultat attendu
Un accueil neutre au nom de travail configurable **Suite Allplan**, puis trois ouvertures directes : SmartCatalog `/smartcatalog`, VOB `/vob-editor`, AIM `/information-manager`. L’accueil ne charge aucun document, store métier ni bridge.

## Réserves identifiées avant fusion
- Les onze images AIM renvoient **403** sur leurs URLs source autorisées. Aucun pointer ne sera copié, aucune autre adresse essayée. Huit icônes ont une candidate locale de même nom/type/taille, sans identité d’octets encore démontrée ; `aim-icon.png`, `vob_open_catalog.svg` et `vob_save_as.svg` n’en ont pas. Les images spécifiques requièrent un export utilisateur pour préserver exactement AIM ; la comparaison visuelle des candidates reste à faire. Aucun AIM inventé ne remplace les sources réelles.
- La référence de tests locale donne **136 succès et 2 échecs sur 138** : les empreintes RC1 de `schema.json` et `fixtures.json` ont été normalisées en LF dans les deux snapshots. L’archive utilisateur contient les octets CRLF correspondant exactement au manifeste. Restaurer ces octets, pas modifier le contrat ni les empreintes attendues.
- SmartCatalog ne possède actuellement pas de sauvegarde native de document branchée ; AIM legacy transmet sans confirmation d’écriture. Ces limites ne seront pas masquées par la suite : un enregistrement non confirmé bloquera la sortie native.