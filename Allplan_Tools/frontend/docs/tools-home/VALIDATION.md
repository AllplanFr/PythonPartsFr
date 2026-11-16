# Allplan Tools — accueil local raccordé

## Périmètre
Accueil existant ToolsHome, liste, icônes, langues, thème, À propos et Quitter conservés. Aucun fichier des modules AIM, SmartCatalog ou VOB ni des gardes d’identité communes n’est modifié. Pas de publication ou basculement du PythonPart actif.

## Contrat
Paquet Copilot reçu : SHA256 `b4127a900aa9ecc828be0efcbd46c6bab669fd70bbf732fe51394aad34a25789`.
`get_home_info()` et `launch(plugin_id, year, verification, country)` exclusivement. Les gardes fournies sont conservées avec seulement une adaptation syntaxique des accès Record en crochets pour `noPropertyAccessFromIndexSignature`; l’original exact est conservé dans `COPILOT_CONTRACT_ORIGINAL.ts.txt`. Aucun type, champ ou validation métier ajouté.
Attente bornée à 15 secondes pour détection/lecture, événement pywebviewready et service déjà prêt. Verrou synchrone, aucune requête concurrente ni retry automatique. IDs, disponibilités et contexte copiés tels que reçus. `ok:true` affiche « Processus lancé. », jamais fenêtre prête. Réponse invalide/refus/rejet de transport explicites ; pas de route plugin dans la fenêtre native.
L’entrée statique force le mode natif dès le premier affichage, même avant injection du pont. L’accueil web garde les liens existants hors hôte.

## Ressources et impact commun
`src/suite/assets/asc.svg` est une copie exacte de l’icône originale fournie, réservée à ToolsHome. Les autres icônes sont les imports locaux existants. Polices système et drapeaux SVG incorporés, aucune dépendance au service d’images. Favicon local et six images de cases référencées par le CSS partagé sont copiés seulement dans la sortie locale.
`src/styles.css`, composants partagés, configuration Vite principale, routes web et fichiers des plugins restent inchangés. Seule la règle documentaire AGENTS.md évolue ; le nouveau script de construction dédié n’affecte pas le build principal. Le dossier `home/` servi ne contient que l’entrée, ses ressources et `home-manifest.json`.

## Vérifications
- 35 tests ciblés réussis, trois fichiers : tools-home-native (15 nouveaux), tools-home (3), suite (17). Détection immédiate/retardée, 15 secondes, pas de fallback local, marqueur invalide, disponibilité, quatre arguments exacts avec chaînes vides, concurrence, succès/refus/réponse invalide/rejet et navigation web.
- TypeScript et construction de l’application : contrôles automatiques de la plateforme. Construction statique dédiée : Vite sans SSR, commande et journal inclus.
- Chromium sur artefacts statiques : hôte SYNTHÉTIQUE, double clic = une requête, contexte exact, attente, succès processus, erreur explicite, liste réactivée, thème/À propos et images chargées. Aucun appel distant pour l’accueil, aucune erreur JavaScript. Parcours web `/` → `/information-manager` conservé. Captures inspectées ; elles ne prouvent pas une ouverture native.
- Inventaire exhaustif et SHA256 de chaque fichier servi hors manifeste, absence de liens symboliques vérifiées avant empaquetage.

## Reste
Copilot doit raccorder explicitement `show_home(context, directory, expected_revision, timeout=15)` dans le profil de test isolé : `directory` désigne uniquement le dossier `home/`, placé hors de la candidate AIM. L’intégrateur fixe `expected_revision` depuis REVISION.txt, pas depuis le manifeste. Le PythonPart actif et selector.html ne sont pas remplacés ici.
Recette réelle Python/WebView/Allplan, création de processus et fenêtre de chaque plugin, précontrôle AIM, fermeture native et confinement réseau réel restent à effectuer côté Copilot. Aucun plugin réel n’a été lancé par ces tests.