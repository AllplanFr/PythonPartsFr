# Suite Allplan — rapport de réorganisation frontend

Date : 26 octobre 2026 · Variante « Suite Allplan — regroupement des trois applications » · Non publiée, non acceptée.

## 1. Sources et révisions
| Source | Révision | Usage |
|---|---|---|
| SmartCatalog/VOB, projet `297630a7-1565-46a1-be88-827e783d171d` | HEAD local `d70f3530521c697c1b51973674740d89839936a4` au début du travail (le `0a3f54f` annoncé n’a pas été observé) | Base d’intégration, routeur TanStack conservé |
| Allplan Information Manager, projet `3dd96c97-fb88-4d2d-8a0b-af87035cbf10` | Checkout complet `39011c34`, 123 fichiers | Sources AIM complètes reprises (pas de reconstruction visuelle) |
| Archive utilisateur `allplan-lovable-handoff-2.0.0-rc.1.zip` | 2.0.0-rc.1 | Octets officiels RC1 rétablis |

Les dépendances déclarées des deux projets sont identiques : aucune dépendance ou framework ajouté. Projets d’origine non modifiés. La variante de recette RC1 SmartCatalog (`drft_01m5vg04qrf11s2mvyxgee8feg`) n’a été ni lue en écriture, ni absorbée, ni activée.

## 2. Architecture
```text
src/routes/index.tsx               accueil neutre (catalogue déclaratif seul)
src/routes/smartcatalog.tsx        SmartCatalog  (app_id smartcatalog)
src/routes/vob-editor.tsx          VOB Editor    (app_id vob_editor)
src/routes/information-manager.tsx AIM           (app_id information_manager) + feuille aim.css de la route
src/suite/catalog.ts               nom de travail « Suite Allplan », modules, routes, transport legacy
src/suite/ModuleGate.tsx           liaison fenêtre → module autorisé ou écran « indisponible »
src/suite/leave-guard.ts           garde commune de sortie (Enregistrer / Quitter / Annuler)
src/shared/transport/native-binding.ts  détection pywebview / WebView2 / navigateur, règles d’accès
src/modules/smartcatalog/SmartCatalogApp.tsx   ancien écran « / » inchangé
src/modules/vob_editor/VobEditorModule.tsx     éditeur VOB inchangé + garde de tous les fichiers modifiés
src/modules/information_manager/               AIM complet (AimEditor, composants, lib, aim.css)
```
Socle partagé réel : composants UI (`src/components/ui`, variante `native` ajoutée au bouton, voile de dialogue en jeton), jetons de thème, diagnostics d’erreur existants (`__root`, `error-capture`, `lovable-error-reporting`), catalogue/navigation, interface d’accès aux transports, corpus RC1 unique (`src/lib/host-protocol*`, `docs/integration/protocol/2.0.0-rc.1/`). Stores et ressources métier restent dans leurs modules ; chaque route est découpée par le routeur et l’accueil n’importe que `@tanstack/react-router` et `src/suite/catalog.ts` (test automatisé).

## 3. Fonctions préservées et modifications volontaires
- **SmartCatalog** : écran, stores, menus, réglages Python (`settings.load/save`) inchangés ; déplacé de `/` vers `/smartcatalog`.
- **VOB** : éditeur, ressources, sessions et historiques par fichier inchangés. Quitter dans la suite renvoie à l’accueil via la garde commune ; dans une fenêtre ouverte séparément, l’ancienne confirmation est conservée. Les réglages reçus de Python ne sont appliqués qu’aux sections VOB autorisées.
- **AIM** : présentation, catégories, groupes, contrôles, valeurs, sauvegardes, diagnostics, langues, barre personnalisable, À propos repris depuis les sources. Changements limités : (1) Save n’envoie plus `quit: true` — aucune fermeture native sur transmission non confirmée ; (2) adaptateur `aim_legacy` actif seulement si la fenêtre l’autorise ; (3) préférences navigateur préfixées ; (4) parseur legacy extrait dans `aim-legacy.ts`, sans recopier le second corpus RC1 d’AIM ; (5) script de thème avant affichage de l’ancien `__root` AIM non repris (le thème s’applique au montage, léger flash possible).
- **Passerelle SC/VOB** : `connectHost` ignore les données initiales tardives après sortie du module et retire son propre récepteur `window.allplanHost`.

## 4. Inventaire des stockages
| Origine | Clés | Traitement |
|---|---|---|
| SC/VOB localStorage | `smartcatalog-model-settings`, `smartcatalog-formula-settings`, `smartcatalog-dialog-layouts` | Inchangées |
| AIM localStorage (ancienne origine) | `project-attrs-v2`, `project-groups`, `project-cats`, `project-groupcat`, `cat-icons`, `group-colors`, `group-collapsed`, `show-name`, `show-colors`, `lang`, `theme`, `aim-columns`, `aim-toolbar-layout` | Dans la suite : `information_manager:<clé>`. Les clés génériques (`lang`, `theme`) ne peuvent plus entrer en collision. Aucune lecture, migration ni purge de l’ancienne origine |
| Cookie | `sidebar_state` (bibliothèque sidebar, non montée) | Inchangé |
| sessionStorage / IndexedDB | aucun usage applicatif | — |

Documents SC, sessions VOB et état AIM restent en mémoire de l’onglet. **Reprise AIM volontaire** : exporter la présentation et une sauvegarde projet depuis l’ancien AIM, puis les importer ici. Limites de l’export d’origine : la présentation n’inclut ni valeurs ni cache d’icônes ; la sauvegarde projet n’inclut pas les réglages d’affichage, colonnes et barre d’outils. Valeurs inconnues/hors liste, associations non résolues, UID et indices VOB bruts restent conservés par les modules (comportement source inchangé).

## 5. Navigation et fermeture
- Navigateur : vraies routes ; garde de sortie avant changement de module, retour arrière et fermeture d’onglet si modifications.
- SmartCatalog : aucune sauvegarde native n’existe ; seuls « Quitter sans enregistrer » (données gardées en mémoire de l’onglet) ou Annuler sont proposés. Le téléchargement JSON n’est jamais présenté comme sauvegarde native.
- VOB : avec hôte, « Enregistrer » sauvegarde tous les fichiers modifiés par `vob.save` ; sortie seulement si chaque réponse est un succès et qu’aucune modification ne reste ; échec, annulation ou délai incertain bloque, sans nouvelle tentative.
- AIM : la sauvegarde legacy n’a pas d’accusé de réception ; quitter avec des modifications exige une confirmation d’abandon.
- Fenêtre native : `ModuleGate` refuse tout module différent de l’`app_id` lié ; AIM n’est jamais disponible via pywebview sans handlers ; SC/VOB jamais via le WebView2 AIM.

## 6. Tests exécutés
- `bunx vitest run` : **54 fichiers, 415 tests réussis**, dont le corpus RC1 unique (92 tests, compté une fois) et 5 fichiers AIM repris (tests adaptés aux clés préfixées).
- Avant intervention : 2 échecs d’empreinte RC1 (`schema.json`, `fixtures.json` normalisés en LF) ; octets rétablis depuis l’archive (et `manifest.json`), empreintes conformes.
- Nouveau `src/test/suite.test.tsx` : ouverture directe des 4 routes, app_id stables, accueil sans import métier, règles de liaison native, garde de sortie (annulation, abandon, échec, exception, modifications pendant Save), isolation des clés AIM.
- Navigateur (Playwright, aperçu local) : 4 routes sans erreur ; accueil sans global de passerelle ; AIM en WebView2 simulé envoie `ready` ; SC dans fenêtre AIM simulée, AIM/SC dans fenêtre VOB pywebview simulée → écran indisponible, aucun message envoyé ; SmartCatalog modifié → retour bloqué, Annuler conserve la page, Quitter conserve le catalogue en mémoire au retour.
- En développement, React StrictMode monte deux fois l’effet AIM (`ready` envoyé deux fois, désinscription intermédiaire) ; comportement identique à la source, unique en production.

## 7. Limites et blocages
- **Images AIM** : les 11 ressources source répondent 403. Huit utilisent les icônes SmartCatalog locales de même nom, type et taille (identité d’octets non prouvée). `aim-icon.png` (menu, À propos) est remplacé par un espace vide signalé `data-missing-asset` ; `vob_open_catalog.svg` et `vob_save_as.svg` ne sont pas utilisés par le code AIM. Fournir ces fichiers pour finaliser.
- Extraction langue/thème hors du store catalogue non réalisée : SC et VOB partagent encore cette préférence via `useCatalog` ; AIM garde ses propres préférences.
- L’état AIM n’est pas conservé après un abandon confirmé (état de composant).
- Aucune validation native/distante : les hôtes ont été simulés. RC1 2.0 inactif, aucune commande réservée ou métier ajoutée.
