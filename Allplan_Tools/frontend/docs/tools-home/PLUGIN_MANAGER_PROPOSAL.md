# Proposition Plugin Manager — versions et mises à jour (non raccordée)

Statut : proposition uniquement. Aucun code modifié. Raccordement après contrat convenu avec Copilot.
Le contrat actuel `home_launch_contract: 1` (`get_home_info`, `launch`) reste inchangé.

## Ligne plugin (ordre visuel)
`[icône] Nom · Version installée · Dernière version (si connue) · [Update] · [flèche bleue]`

- Version installée : toujours affichée, source Python uniquement. Absente → « Version inconnue ». Jamais déduite du catalogue.
- Dernière version : affichée seulement si le catalogue GitHub la fournit.
- Bouton Update : juste avant la flèche bleue, visible seulement si `état = mise_à_jour_disponible` ET lien présent. Il ouvre le lien uniquement (aucun téléchargement ni installation automatique).
- Flèche bleue : lancement via le mécanisme existant, selon la capacité de lancement Python.

## États distincts (jamais confondus avec « À jour »)
| État | Condition | Affichage |
|---|---|---|
| À jour | versions installée et distante connues, comparaison établie égale | « À jour » |
| Mise à jour disponible | distante > installée, lien présent | Update visible |
| Mise à jour sans lien | distante > installée, pas de lien | texte seul, pas de bouton |
| Inconnu | version installée absente ou comparaison impossible | « État inconnu » |
| Non référencé | plugin local absent du catalogue | « Non référencé », reste lançable |
| Hors ligne | catalogue inaccessible | « Catalogue hors ligne », versions installées conservées |

## Catégorie « En construction »
Visible, grisée, non lançable, sans Update ; motif en infobulle.

## Décisions de principe fixées (10 nov. 2026)
1. `installedVersion: string | null` et `launchable: boolean` viennent de Python.
2. Python lit le catalogue GitHub et retourne un état normalisé ; aucune requête GitHub depuis le frontend.
3. Comparaison SemVer côté Python ; le frontend ne compare jamais les versions (aucune comparaison lexicographique).
4. Correspondance local ↔ catalogue par `id` stable.
5. Update transmet uniquement l'`id` à une action hôte contrôlée ; pas d'URL ouverte par le frontend.
6. `lifecycle` local pour les plugins installés ; statut catalogue pour les entrées distantes non installées. « En construction » et panne de lancement restent deux états distincts.

Invariants conservés : Update juste avant la flèche bleue ; absence de version, d'URL ou de catalogue ne bloque jamais le lancement local ; catégorie « En construction » inaccessible ; aucune version locale déduite d'un SHA ou du catalogue.

## En attente
Contrat exact du pont (noms de commande, enveloppe, valeurs de `lifecycle` et du statut catalogue), fourni par Copilot après correction du défaut du lanceur. Aucun raccordement sur une enveloppe supposée.

## Distribution locale hors ligne — obstacles frontend relevés (10 nov. 2026)
Direction : frontend compilé local chargé par l'hôte Python ; GitHub limité au catalogue et aux liens Update ; aucune bascule d'interface pendant l'édition ; aucun changement de favoris ou de stockage implicite. Le mécanisme local WebView2 (fichier, hôte virtuel, localhost…) reste à vérifier par Copilot : rien ici ne suppose localhost.

| Point | Constat | Correction frontend à prévoir (après choix du mécanisme) |
|---|---|---|
| Rendu | Application principale construite pour un rendu serveur (worker) ; seule l'accueil isolé `tooling/build-tools-home.ts` produit déjà un paquet statique `base: "./"`. | Paquet statique complet (suite + 3 plugins), sans serveur. |
| Routes | `/smartcatalog`, `/vob-editor`, `/information-manager` sont des chemins absolus ; sous `file://` ou sans repli serveur, l'actualisation ou l'ouverture directe échoue. | Routage par hash ou repli `index.html` fourni par l'hôte, selon le mécanisme retenu. |
| Ressources | Chemins absolus `/aim-assets/checkbox/*` dans `styles.css` et `aim.css` ; liens `href="/"` (404, page d'erreur). | Chemins relatifs ou importés par le bundler. |
| Polices / scripts externes | Aucun CDN, police distante ni script externe détecté. | — |
| Appels réseau | Seul `fetch` : bibliothèque externe par URL saisie (SmartCatalog), action explicite. Liens d'aide Allplan, Google Traduction (VOB) et validation de lien AIM ouvrent une page externe à la demande. | Aucun requis au démarrage ; afficher l'indisponibilité hors ligne au moment de l'action. |
| Stockage lié à l'origine | `localStorage` (réglages app-settings, modèles, favoris formules, géométrie des dialogues, aimStorage). Changer d'origine (web publié → local) rend ces données invisibles, sans perte. | Aucune migration implicite ; la reprise éventuelle passe par un contrat Python explicite. Les données détenues par Python ne sont pas concernées. |
| Identité et empreintes | `build-identity.ts` (manifeste `build-identity/1`, SHA Git, empreintes) et `build-tools-home.ts` existent ; le manifeste est servi par le site publié. | Générer le manifeste dans le paquet local avec les mêmes empreintes, vérifiable par Python avant chargement. |
| Catalogue | Le frontend n'interroge pas GitHub (décision 2). | Afficher l'état normalisé Python : catalogue embarqué/en cache, « dernière version connue » avec date si fournie, hors ligne distinct de « À jour » ; lancement local jamais bloqué. |

Aucune modification de code effectuée pour ce relevé.

## Mécanisme local décidé (10 nov. 2026)
- Accueil : bundle local vérifié servi par Bottle/pywebview existants.
- Plugins (lots suivants) : interception protégée de ressources locales vérifiées, origine logique existante conservée.
- Pas de nouveau mappage de dossier ni bascule globale vers `#`. Les routes absolues ne sont pas converties systématiquement : les URL réellement desservies sont à vérifier avec Copilot. Les obstacles relevés ci-dessus sont des points à tester, non des défauts confirmés.

## Premier lot : accueil / Plugin Manager uniquement
À préparer après réception du contrat exact Copilot (inventaire extensible, catalogue facultatif, action Update) : raccordement frontend et bundle local de l'accueil.
- Version installée issue de Python uniquement ; états inconnue / non référencée / catalogue indisponible distincts.
- Update avant la flèche bleue, selon la capacité fournie par Python.
- Catégorie « En construction » inaccessible.
- Aucune dépendance GitHub pour afficher l'inventaire installé ou demander un lancement local.
- Aucun plugin annoncé prêt sur la seule création de son processus.
- Aucun changement favoris/profils/stockages, ni VOB/AIM/SmartCatalog hors besoin explicite du lot ; aucune publication.
- Bilan séparant tests simulés et essais hôte.

## Hors périmètre
SmartCatalog suspendu, favoris, publication, migration, téléchargement/installation.
