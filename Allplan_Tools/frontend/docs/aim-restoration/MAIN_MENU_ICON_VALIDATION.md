# AIM — icône du bouton de menu principal, 2 novembre 2026

## Delta exact
- Base de cette correction : `dc08dc0d84e28c73d3bc61f1250193ac011180ef`. La référence native épinglée `0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65` n'est ni remplacée ni modifiée en place.
- Seul fichier d'interface modifié : `src/modules/information_manager/components/suite-menu.tsx` ; suppression de l'import AimBrandIcon et remplacement de sa seule occurrence dans le déclencheur par le motif Allplan déjà présent dans `src/components/editor/MainMenu.tsx` (cadre border-current et Λ). Aucun import du menu SmartCatalog ou de son store.
- Dimension conservée : 20 × 20 px (`size-5`), contraste hérité `currentColor`, symbole décoratif `aria-hidden`. Classes du bouton, texte Information Manager et aria-label inchangés.
- Aucun fichier image ajouté, aucun service distant requis : le motif existant est rendu localement en HTML/CSS. Aucun autre usage d'AimBrandIcon, aucune ressource AIM/ActionBar/accueil/fenêtre/bibliothèque, aucun frontend SmartCatalog/VOB, bridge, contrat, lancement ou logique métier modifié.
- Fichiers de contrôle ajoutés : `src/test/information_manager/aim-suite-menu.test.tsx`, ce document ; suivi ciblé dans `roadmap.md`. Le diff complet livré identifie aussi le suivi documentaire.

## TESTÉ
- Paquet de consigne `AIM_menu_Allplan_demande_Lovable_20261102.zip` : SHA-256 `b1a8fbcccf6ca4bb5c3191e3eaaf39093fb9e0ed47081ae4df02d794cb90e7e1`, contenu `LOVABLE_AIM_MAIN_MENU_ICON.md` lu. Aucune empreinte attendue n'était fournie pour ce paquet.
- Contrôles automatiques de compilation/construction de la plateforme : `build OK` après correction ; journaux copiés dans evidence. Pas de construction manuelle concurrente.
- Commande exécutée : `bunx vitest run src/test/information_manager/aim-suite-menu.test.tsx src/test/information_manager/aim-interface.test.ts` — 10 tests réussis, 0 échec/ignoré (4 menu + 6 interface). Les tests du menu vérifient import/À propos/Quitter et absence d'appel aux opérations indisponibles ; aucune assertion de style ou snapshot.
- Chromium sur `/information-manager`, mode navigateur sans hôte : captures du bouton et du menu en clair/sombre, puis À propos montrant l'identité AIM inchangée. Captures toutes inspectées ; aucune erreur JavaScript. Nom accessible du bouton observé : Allplan Information Manager. Cette vérification visuelle ne nécessite pas de projet Allplan et ne constitue pas une recette native.
- Ressource AimBrandIcon et autres usages inchangés, vérifiés dans le diff de la base.

## Livraison et limites
- Même mécanisme que la livraison AIM de référence : archive autonome contenant toutes les sources de la révision, bundle Git complet, commandes de reconstruction, versions d'outils, révision/arbre, inventaire et SHA-256, journaux et captures. Pas de dépendances installées ou de sortie de construction générée dans sources.
- Reconstruction par Copilot : `bun install --frozen-lockfile`, `bun run build`. Les commandes exactes de tests figurent dans COMMANDS.sh. La nouvelle livraison doit être vérifiée avant intégration ; elle n'est pas déjà installée dans le bundle natif actif.
- Aucune publication, activation RC1, écriture métier, export de fichier utilisateur ou prjtools. Python/WebView/Allplan/ActionBar réels non testés ; leur intégration reste à Copilot. MCP demeure hors de ce lot.