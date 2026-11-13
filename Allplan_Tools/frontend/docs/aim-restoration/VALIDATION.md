# AIM — restauration raccordée, 2 novembre 2026

## FAIT
- Paquet Copilot vérifié : SHA256 `379fb0df78c3240d6f8ed71bb0faea9f8f5d0e13138e4df5f4673863f1618031`.
- Les quatre sources TypeScript livrées sont conservées octet pour octet sous `src/modules/information_manager/contracts`. Les types de travail importés viennent de `AIM_PROJECT_MANAGER_CONTRACT.ts`, sans schéma métier parallèle.
- Profil `working_state_contract === 1` indépendant ; valeurs modifiables seulement si `read_only === false`. Source toujours en lecture seule ; état Python complet adopté, valeurs effectives et occurrences jamais recalculées par le navigateur.
- `work.get`, `work.value.set`, `work.transition`, `work.discard`, `work.close` utilisent le transport existant et les payloads exacts. Relecture après mutations, présentation et import ; annulation/refus conserve l’état. Sortie Suite abandonne via Python, fermeture native utilise `work.close`.
- `project_manager_assignment_contract === 1` choisit les validateurs enrichis de list/add/preview seulement ; les payloads restent `{}` ou `{path}` comme le guide. Aucun marqueur supplémentaire de requête n’est documenté, donc aucun champ inventé n’est envoyé.
- Classement exclusif par `projectInstallation`, installations distinguées par version/vérification/PRJ ; externe/inconnu dans utilisateur, inconnu indiqué. Sans marqueur, aucune version d’appartenance déduite. Doublons de chemins rejetés.
- `list` affiche la dernière résolution mémorisée. Sélection initiale du projet actif sans relecture automatique ; l’aperçu se recharge uniquement sur action explicite et reste indépendant du brouillon.
- Restaurations catégories, formulaires, icônes incorporées, couleurs de groupe, infobulles et déplacement préservées. Aucun changement des autres plugins.

## TESTÉ
- Compilation isolée des quatre fichiers Copilot : `bunx --package @typescript/native-preview tsgo --project /tmp/aim-copilot-package/tsconfig.json`, sans erreur. Le journal isolé et sa configuration sont dans la livraison.
- Compilation TypeScript de l’application et construction : contrôles automatiques de la plateforme, dernier résultat `build OK`. Pas de construction manuelle parallèle.
- 70 tests ciblés / 8 fichiers réussis, aucun échec/ignoré : 37 tests préexistants préservés (deux adaptations de parcours désormais sans aperçu automatique/doublon), 11 tests nouveaux ciblés et 22 tests existants du gestionnaire adaptés/rejoués.
- Chromium, hôte synthétique : valeur appliquée en mémoire affichée dans deux occurrences, source `"0"` intacte, trois projets dans trois lignes uniques, externe avec source 2025 non classé par version, inconnu indiqué ; aperçu relu affichant la source et non le brouillon. Aucune erreur JavaScript. Captures inspectées.
- Les routes de contenu conservent leurs métadonnées propres ; aucune route ni publication modifiée.

## RESTE / LIMITES
- Cette validation frontend ne constitue pas une recette Python/WebView/Allplan. Vérifier côté hôte réel : validations métier Python, sélection locale d’icône WebView, annulation/refus/transitions/fermeture native et persistance technique des informations du gestionnaire.
- Aucune écriture de fichier métier, export, prjtools, publication, déploiement ou activation RC1. L’inventaire/favoris techniques Python existants restent distincts du métier.
- L’intégration MCP antérieure reste hors de ce lot : pas de chemin authentifié compatible avec le Python local établi.

## Reconstruction
La livraison comprend toutes les sources de la révision et un bundle Git complet, sans dépendances ni sortie générée. Installer avec `bun install --frozen-lockfile`, puis `bun run build`. Le script `COMMANDS.sh` donne les commandes ciblées de tests ; ces commandes de reconstruction sont fournies, pas exécutées ici en remplacement des contrôles automatiques.