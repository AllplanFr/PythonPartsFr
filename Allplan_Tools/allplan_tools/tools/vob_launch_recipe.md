# Raccordement VOB protege

## Selection des livraisons avec affichage des versions

Le Home `78977bcdaf02f3066e0c428378b6f62445c61258`, SHA-256 exact
`bfb133009787e819d67d1be168f461b886fa05b530ecd5dc848a87d9f4c34292`,
est aussi autorise explicitement sans `SHA256SUMS.txt`. Son manifeste,
revision, entree, chemins, inventaire exhaustif et empreintes individuelles
restent controles. Si le sidecar est present, il est verifie ; cette exception
ne concerne ni les autres Home ni les paquets VOB/SmartCatalog.

`assemble_package.py --home-local-package <Home.zip>` selectionne explicitement
le Home `ccdaa3a932ffe23629decc2fabfeed8ac6e39935`, SHA-256
`b8b150c1a1c877fbb5ea6583a8c6d35df2c0c4257e52cf26adb1d1ac60c2ddb3`.
Le ZIP est valide avant extraction : chemins, identite `allplan-tools-home/1`,
inventaire et `SHA256SUMS.txt`. Le sidecar est conserve dans le ZIP interne
`home-local-package.zip`, mais pas extrait parmi les ressources servies.
La revision choisie est inscrite dans `runtime.json` et controlee par le
runtime Home. Sans cette option, le bundle Home anterieur est conserve.

Les options VOB et SmartCatalog acceptent aussi les paquets `ccdaa3a...`
explicitement epingles, respectivement SHA-256
`4b5f47be334638dc7194096aecca587e8957f34d7c684bb59ef88290ca3bf1ad`
et `6aa1f2d9a39f247f29be85182fb863b7f1b19a6b8eed5a790f471a8f650f1fc1`.
Les anciennes livraisons restent acceptees, sans deduire une identite du nom
du ZIP. Les controles de revision, compatibilite et ressources restent actifs.
Le VOB de fermeture corrigee `a9963364ea9c88fe42bf1e07931cd4f152771998`
est egalement epingle au SHA-256
`fc1e0333c6928bdb8fb8e8be3d73d943ac2f743da7a84a2b8d3b50a2a069a87f`,
avec les memes controles obligatoires, dont `SHA256SUMS.txt`.
Seuls les nouveaux assemblages recoivent cette selection et les versions
produit Python ; ne pas modifier les candidates fonctionnelles.

AIM conserve le statut « interface modifiee, livraison locale non actualisee ».
Cette selection ne fabrique pas de livraison AIM ni de descripteur et ne
remplace pas son lot Python epingle. Le profil de recette est neuf ; la
verification visuelle vise 0.1.0 dans le footer, les cartes et les fenetres
A propos de Home/VOB/SmartCatalog, sans annoncer AIM actualise.

## Versions produit transmises aux interfaces

La version de reference Allplan Tools est definie uniquement par
`application.core.product_version.ALLPLAN_TOOLS_VERSION`.
Les versions AIM (`information_manager`), SmartCatalog (`smartcatalog`) et
VOB Editor (`vob_editor`) sont definies par le champ `version` de leur
`plugin.json`, avec la meme valeur dans les metadonnees surchargees.
Ces quatre versions produit sont `0.1.0`, decision utilisateur ; elles ne
sont ni la version du launcher ni une revision de fabrication.

Contrat frontend additif, sans nouvelle methode ni capacite requise :
`window.pywebview.api.get_home_info()` conserve sa reponse directe existante
(`home_launch_contract`, `plugin_inventory_contract`, `context`, `plugins`)
et ajoute le champ facultatif `version: string`, version produit de la suite.
Chaque element `plugins` conserve `id` et `installedVersion: string | null`,
issus des metadonnees locales. Exemple partiel :
`{"version":"0.1.0","plugins":[{"id":"vob_editor","installedVersion":"0.1.0"}]}`.
Les autres champs existants restent presents et inchanges. Une ancienne
livraison Python peut ne pas fournir la version de suite : l'interface doit
alors indiquer une version inconnue, sans deduire de valeur d'un hash.

`window.pywebview.api.get_app_info()` conserve sa reponse directe existante
et transmet `version: string | null` depuis les memes metadonnees.
AIM conserve `id: "information_manager"` et ses contrats specifiques ;
SmartCatalog et VOB conservent `app_id: "smartcatalog"` ou `"vob_editor"`,
`bridge_version`, `capabilities` et `unavailable_capabilities`.
Exemples partiels : `{"id":"information_manager","version":"0.1.0"}`,
`{"app_id":"smartcatalog","version":"0.1.0"}` et
`{"app_id":"vob_editor","version":"0.1.0"}`.
Aucune modification de `get_initial_data()`, des commandes ou des evenements.
Respecter l'identification et les capacites natives deja annoncees ; aucun
bouton Update ajoute. Ces modifications concernent les sources uniquement :
les candidates et installations existantes ne sont pas mises a jour.

Le wrapper `vob_launcher.py` provient d'un fichier de travail non suivi retrouve
dans l'ancien depot `smartcatalog-editor-web`, sans commit historique attribue.
SHA-256 du fichier avant adaptation :
`24038042d393146b7b01e9714f270f3a88675230a0ed257f625a770a58b21723`.
La copie centralisee adapte explicitement l'appel a la signature importee :
sources centrales avec `register_location=False`, surcharge sans ce parametre
avec `entrypoint()`. Aucune exception TypeError n'est interceptee. La surcharge
n'inscrit pas le launcher et conserve son controle `verify_work_copy()`.

L'assembleur copie le wrapper dans `python\vob_launcher.py`, l'inventorie et
configure `vobEntrypoint` vers cette copie. Aucune dependance de lancement ne
designe l'ancien depot. Sans choix local explicite, le dispatch VOB utilise `vob_online.run`
avec revision coordonnee `58a9c1f6047015778ccddb6fb40e98e19008b56d`.
Les branches AIM et SmartCatalog et les icones natives restent inchangees.
Les candidates deja preparees ne sont pas mises a jour par ce raccordement.

## Livraison locale explicite

Le parcours local utilise `application.launcher.vob_local_delivery`, schema
`vob-editor-local/1`, compatibilite `vob-editor-host/1`, revision
`aba4fc0db2ea21ee47fef6100782b38e53ff3a56`, entree `index.html`.
SHA-256 du ZIP autorise :
`ab91dbd36b8acb4e50a9d0212cf53f6d72a16485b5b692e9b8f49f264a30cb17`.
Ce paquet est une interface fabriquee, distincte de l'archive historique de sources.
Les chemins ZIP, inventaires `vob-manifest.json` et `SHA256SUMS.txt`, empreintes,
identite et marqueurs VOB sont verifies sans extraction. Toutes les ressources
sont interceptees sous `https://vob-editor.localhost/`, dont `/index.html`,
`/aim-assets/` et la route `/vob-editor`. Cette origine logique ne necessite
aucun serveur ni acces Lovable : les requetes absentes du paquet sont refusees.
Les ponts, API identifiee, fermeture correlee, restauration des backups, CSP,
permissions et blocages de navigation, popups et frames restent en place.
La revision online historique n'est pas imposee au manifeste local.

Depuis `Allplan_Tools`, lancement source explicite (pas une commande de preparation) :

```powershell
& '<python.exe>' -I .\vob_launcher.py --vob-local-package '<livraison.zip>' --allplan-version 2026 --country FRA
```

Preparation future uniquement, dans une nouvelle destination isolee :

```powershell
& '<python.exe>' -B -m allplan_tools.assemble_package --out '<nouvelle-candidate>' --profile '<nouveau-profil>' --pinned-candidate '<racine-AIM-existante>' --vob-local-package '<livraisons>\vob-editor-local-aba4fc0.zip'
```

L'option `--vob-local-package` valide le ZIP avant copie et sa copie interne
`python\vob-local-package.zip`, puis cree `python\vob-local-delivery.json`.
Le wrapper assemble lit ce choix et transmet le chemin interne au dispatch :
aucune dependance persistante au dossier Downloads. Les deux fichiers sont
inventories apres overlays. Une livraison absente, alteree ou incompatible
echoue sans repli online. Sans configuration locale ni option CLI, le parcours
online reste inchange. L'option locale est refusee pour les autres plugins et
les modes de controle RC1. Aucun changement de Home, AIM ou SmartCatalog.

La preparation ne cree pas de profil VOB et ne met a jour aucune installation.
Les prerequis Allplan ci-dessous restent necessaires ; le launcher enfant
initialise les dossiers du profil neuf, sans preparation manuelle de `data`.
Relancer le processus Python VOB pour charger ces changements ; Allplan n'a
pas besoin d'etre redemarre tant que son processus Python d'entree n'est pas
conserve avec des modules deja importes. La recette reelle dans l'hote et les
fonctions metier restent a valider ; les tests locaux ne les certifient pas.

## Ajout SmartCatalog local dans une nouvelle candidate seulement

L'assembleur accepte aussi `--smartcatalog-local-package <zip>` en complement
de `--vob-local-package`. Le ZIP SmartCatalog autorise a pour SHA-256
`38c0dbb920d852e9b50ccdae10b3f560e6c931b9d6f177cf242a00b54ea35a1c`,
revision `797db6f668543175220f5d8da5b81653b100e1e6`, schema
`smartcatalog-local/1`, compatibilite `smartcatalog-host/1`, entree `index.html`.
Les validations ZIP et inventaires sont partagees avec VOB. Les images
`externalAssets` doivent etre presentes avec taille et empreinte conformes ;
aucune recuperation distante n'est effectuee. Les SVG SmartCatalog autorisent
les clipping paths a fragments internes uniquement, sans modifier la
validation AIM ou VOB.

La copie `python\smartcatalog-local-package.zip` et son choix explicite
`python\smartcatalog-local-delivery.json` sont inventories apres overlays.
Le dispatch central et surcharge lit ce choix dans la candidate, y compris
pour l'enfant lance par le selecteur existant de l'accueil. L'option CLI
`--smartcatalog-local-package` permet le meme choix explicite en sources.
Le parcours online reste selectionne uniquement en l'absence de choix local ;
une erreur locale n'entraine jamais de repli.

Le moteur confine sert toutes les ressources a la racine
`https://smartcatalog.localhost/`, dont `/aim-assets/`, avec identification
`smartcatalog`, pont commun et pont SmartCatalog, API et evenements existants.
Les capacites Python sont transmises sans ajout ; aucune fonction metier
n'est simulee. La fermeture correlee VOB n'est pas imposee a SmartCatalog.
La candidate VOB deja installee reste independante et ne doit pas etre
reconstruite. Une nouvelle candidate et un profil neuf necessitent une
autorisation distincte ; ne pas recopier les catalogues ni les reglages.

## Profil futur et conditions avant lancement

Le launcher enfant initialise lui-meme `data` et `profile` dans
`<profil>\AllplanWebLauncher\vob_editor\<annee>\<standard|verification>`.
L'accueil ne bloque plus la creation du processus si `data` est absent :
ce controle empechait justement le premier lancement. Aucune reprise de profil,
reglages, fichiers VOB ou backups anciens n'est effectuee. Les echecs de creation
restent des exceptions du launcher enfant ; l'acceptation de l'accueil confirme
uniquement la creation du processus, pas son initialisation ni sa fenetre.

Points distincts non corriges : l'erreur VOB est globale dans l'accueil et peut
apparaitre dans une autre fiche selectionnee ; le footer affiche la version
hote `0.1.0`, dont le statut produit reste a clarifier avec l'utilisateur,
sans la renommer ni la supprimer.

Le lancement transmet le contexte Allplan, l'interpreteur
configure et LOCALAPPDATA du profil isole. L'application initialise ensuite
ses reglages via les services existants ; ne pas fabriquer de reglages ou de
descripteur pour contourner une validation.

Verifier separement le contexte et les ressources accessibles : pour 2026,
ETC doit etre un dossier accessible ; pour 2027+, pays resolu et au moins une
racine ETC, STD ou catalogue utilisateur accessible. Les racines utilisees
doivent respecter les controles de chemins (absolus, sans liens/points de
reanalyse) du fournisseur VOB. PRJ est requis pour les parcours de selection
de projets ; les fichiers VOB selectionnes doivent satisfaire les lecteurs
existants. Les referentiels sont partiels : conserver les diagnostics de
sources indisponibles, sans inventer de valeurs ni migrer d'anciens fichiers.
Les reglages et backups restent geres par les services VOB existants.

Les ponts `application\core\resources\bridge.js` et
`application\plugins\vob_editor\resources\bridge.js`, les modules coordonnes,
pywebview/pythonnet et les DLL/loader/runtime WebView2 sont requis.
Conserver les controles natifs, le confinement des imports et de l'API,
l'origine exacte du parcours selectionne, la CSP et le
blocage des frames/popups. Aucun repli HTTPS generique n'est autorise.

La publication distante n'a pas ete verifiee dans ce lot. Pour le parcours online seulement,
le service doit accepter le manifeste `build-identity/1` avec
`vobEditorCompatibility: vob-editor-host/1`, build Git propre, revision
coordonnee exacte, assets declares et empreintes conformes, marqueurs VOB et
manifeste stable pendant la recuperation. Aucun controle n'est desactive.

Les tests de raccordement utilisent seulement des candidates/profils
temporaires et des doubles, sans fenetre graphique ni recuperation reseau.
Ils ne prouvent ni le fonctionnement metier VOB complet ni la publication.
