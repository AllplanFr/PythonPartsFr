# Suite Allplan — examen préalable des sources

Date : 26 octobre 2026. Cet examen est documentaire et en lecture seule : aucune intégration applicative, exécution de tests ou validation native effectuée ici.

## Sources et point de retour

- SmartCatalog/VOB : projet `297630a7-1565-46a1-be88-827e783d171d`, HEAD observé `0a3f54f` avant les notes de ce tour. Routes actuelles `/` et `/vob-editor`.
- Information Manager : projet `3dd96c97-fb88-4d2d-8a0b-af87035cbf10`, snapshot complet en lecture seule au commit `39011c34`, 123 fichiers. Même famille TanStack Start, React 19 et Tailwind 4 ; pas de changement de framework nécessaire identifié.
- Dépôt d'intégration retenu : SmartCatalog/VOB, dans le nouveau draft `drft_01m5vhrehqf1y9epkqtas5wj8g`, thread `thr_9jlg59gq2a8j` (« Suite Allplan — regroupement des trois applications »). La demande complète y a été transmise ; son agent doit examiner ses propres sources puis présenter le plan avant fusion importante.
- Main et projet AIM conservés intacts comme références applicatives. Le draft de recette RC1 `drft_01m5vg04qrf11s2mvyxgee8feg` reste distinct ; il était prêt lors de l'inventaire, sans inspection de son contenu dans cet examen.
- Le draft de regroupement part de la dernière version sauvegardée, pas des notes ajoutées durant ce tour ; les exigences nouvelles lui ont donc été données explicitement dans son instruction initiale.

## Constats utiles au plan du draft

### SmartCatalog/VOB

- `src/routes/index.tsx` monte SmartCatalog ; `src/routes/vob-editor.tsx` monte VOB. Le retour VOB dans `VobEditorPage.tsx` utilise actuellement `/`, donc le passage à un accueil neutre exige une transition explicite.
- UI déjà commune sous `src/components/editor` et `src/components/ui`, thème dans `src/styles.css`. VOB utilise encore `useCatalog` pour langue/thème : cette dépendance n'est pas une isolation des stores métier.
- VOB conserve les documents/historiques par chemin et utilise `vobSwitch` pour changer de fichier. La sauvegarde ne valide que le snapshot réellement acquitté. Pas de protection générale de navigation route/back identifiée ; SmartCatalog a `dirty` sans garde générale.
- `connectHost` possède une protection locale par appel, pas une ownership globale du transport. SmartCatalog connecte ses settings ; VOB connecte settings et données. Le cycle montage/démontage doit être examiné, sans activation simultanée des bridges.

### AIM

- L'interface complète se trouve principalement dans `src/routes/index.tsx` (environ 1 409 lignes), avec `aim-interface`, `attribute-catalog`, `aim-host-state`, traductions et composants dédiés.
- Le legacy AIM utilise WebView2 et des messages `ready/load/save/quit`, distincts du `pywebview.api.call` SmartCatalog/VOB.
- La sauvegarde legacy transmet présentation et valeurs, avec `quit: true`, sans acquittement. La fusion ne doit pas transformer cette transmission en réussite, avance de baseline ou fermeture native confirmée. C'est une limite de coordination Python à traiter explicitement.
- Les 11 pointeurs d'assets sont propres à l'origine AIM : réimporter les médias nécessaires par le flux assets, jamais copier leurs pointeurs et les utiliser sur l'origine cible.

## Inventaire initial des stockages

À compléter et vérifier dans le draft avant intégration ; cette liste ne constitue pas une autorisation de migration.

| Ensemble | Clés observées | Risque / préservation |
| --- | --- | --- |
| SmartCatalog | `smartcatalog-dialog-layouts`, `smartcatalog-model-settings`, `smartcatalog-formula-settings`, `smartcatalog-folder-icons`, `smartcatalog-attr-favorites`, `smartcatalog-attr-order` | Les dialogues sont déjà partagés avec VOB ; préserver les clés et distinguer les nouveaux espaces par module. |
| Settings hôte | Sections de `app-settings.ts`, sous-ensemble autorisé VOB | Le connecteur suit plusieurs stores ; préciser ownership et abonnements, ne pas renommer le contrat sans coordination. |
| AIM préférences | `theme`, `lang`, `aim-toolbar-layout`, `aim-columns`, `show-name`, `show-colors`, `group-colors`, `group-collapsed` | Clés génériques à inventorier contre la cible ; pas de purge ni transfert automatique entre origines. |
| AIM projet/session | `project-attrs-v2`, `project-groups`, `project-cats`, `project-groupcat`, `cat-icons` | Ne pas prendre le stockage navigateur pour des données natives autoritaires ; préserver les valeurs et prévoir reprise volontaire export/import. |

IndexedDB, cookies, sessionStorage et accès indirects restent à inventorier exhaustivement dans le draft.

## RC1 et limites

- Artefacts SmartCatalog/VOB : `docs/integration/protocol/2.0.0-rc.1`, modèles/validateurs sous `src/lib/host-protocol*`, corpus `src/test/host-protocol.test.ts`.
- AIM possède ses propres artefacts sous `src/protocol/2.0.0-rc.1` et helpers `host-protocol`/`protocol-release` ; comparer les empreintes avant consolidation, conserver les octets CRLF/LF exacts.
- Aucun protocole 2.0 activé par cette demande. Aucun handshake ne donne une autorisation métier. Les preuves historiques communes ne sont pas deux exécutions indépendantes.
- Sources accessibles : pas de blocage d'accès AIM identifié. Limites réelles : acquittement legacy AIM absent, transports/capacités natives à coordonner, ressources AIM à réimporter, transition launcher `/` vers `/smartcatalog` à préparer.
- Aucune publication, modification de domaine, suppression de projet, migration automatique de données ni connexion native effectuée.

## Suite attendue

Le draft fournit son plan puis réalise l'intégration approuvée, les tests des quatre routes, l'isolation/dirty/transport et les rapports `suite_frontend_reorganization_report.md` et `suite_python_launcher_adjustments.md`. Ces rapports finaux ne sont pas encore produits ; cet examen ne les remplace pas.