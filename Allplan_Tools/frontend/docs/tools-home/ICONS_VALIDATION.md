# Accueil — icônes locales, 02/11/2026

## Périmètre
Paquet Copilot AllplanTools_home_icons_Lovable_20261102.zip vérifié :
`c582524a44f25b036b7b285dc2ef5099689595136ae4f94d37a5a8315515dbf3`.
Le contrat ajoute uniquement `HomePlugin.iconUrl?: string | null`.
En natif, seule `/plugin-icons/${plugin.id}.png` est acceptée, puis résolue
par `new URL(iconUrl, location.origin)`. Aucun service ni ressource distante.
Le visuel intégré existant est conservé pour une valeur absente/null/invalide
ou un échec de chargement ; son propre échec ne déclenche aucune tentative.
Les URL de l'hôte restent stables et les PNG peuvent être remplacés sans
reconstruction du frontend ; recharger/rouvrir l'accueil, pas de promesse
de mise à jour à chaud.

## Impact
ToolsHome et son nouveau composant d'image uniquement, plus le champ optionnel
du contrat de l'accueil, tests et documentation. Aucun changement de
use-home-host, launch, verrou, disponibilités, messages, routes, CSS,
gardes communes ou frontend AIM/VOB/SmartCatalog. Images de 32 pixels,
alignement et classes inchangés. L'aperçu Copilot est une planche de
ressources, pas une capture Allplan ou ActionBar, et n'est pas utilisé
à la place des URL fournies par l'hôte.

## Validation
49 tests ciblés : tools-home-icons 14, tools-home-native 15,
tools-home 3, suite 17. Ancien hôte, null/type invalide/URL incorrecte,
trois URL exactes, échec image/repli sans boucle, plugin indisponible
avec image valide et lancement/contextes/verrou préservés.
Construction statique dédiée Vite réussie ; contrôle principal automatique
de la plateforme réussi (journal inclus). Aucun build principal manuel.
Chromium sur artefacts statiques avec hôte SYNTHÉTIQUE : normal, champ
absent, HTTP 404, repli lui-même en échec. Une demande d'image hôte maximum,
un passage au repli maximum après connexion, aucun retour à l'image hôte
après lancement, double clic = un seul appel avec quatre arguments exacts.
Dimensions de ligne inchangées : 960 × 80 au viewport 1280 × 1800.
Aucune erreur JavaScript ; aucun appel distant ; lien web conservé.
Captures inspectées. Une image de test est servie par interception locale,
et n'est ni une ressource de production ni une preuve d'ouverture native.

## Livraison / reste
Servir uniquement home/, index.html et home-manifest.json schema
allplan-tools-home/1, inventaire exhaustif hors manifeste. Fixer
expected_revision depuis REVISION.txt indépendamment du manifeste.
Sources complètes et bundle autonomes, commandes, versions, journaux,
captures, inventaire et SHA256 inclus. Aucun changement entry-config.json,
copie Allplan, activation, publication ou validation ActionBar.
La recette réelle Python/WebView/Allplan et le plan final de copie avant
installation restent à effectuer côté Copilot ; les tests simulés ne
valident pas le runtime natif.