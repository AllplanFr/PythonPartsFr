# Plugin Manager : contrat du premier lot source

Statut : prepare dans les sources, non deploye. Le bundle accueil existant
`980fff2` reste intact. Il n'est pas encore une vue Plugin Manager extensible :
Le rendu source consomme maintenant les lignes de l'inventaire, avec une
categorie construction desactivee. Lovable doit livrer le bundle compile
correspondant avant toute activation de cette nouvelle presentation.
Le contrat TypeScript source est dans
`frontend\src\suite\contracts\ALLPLAN_TOOLS_HOME_CONTRACT.ts`.

## Pont natif exact pour Lovable

Appels directs `window.pywebview.api`, pas `allplanHost.request`, pas de
commande generique ou de payload contenant un executable, chemin ou URL.
Les exemples ci-dessous utilisent des valeurs fictives.

### get_home_info() : aucune enveloppe ok/data

```json
{
  "home_launch_contract": 1,
  "plugin_inventory_contract": 1,
  "context": {"year": "2026", "verification": false, "country": "FRA"},
  "plugins": [
    {
      "id": "local_tool",
      "name": "Local tool",
      "description": "Exemple uniquement",
      "installedVersion": null,
      "lifecycle": "ready",
      "launchable": true,
      "available": true,
      "reason": null,
      "reasonCode": null,
      "iconUrl": "/plugin-icons/local_tool.png"
    }
  ]
}
```

- `id` : identifiant local unique `[a-z][a-z0-9_]*`, provenant du manifeste
  installe, jamais une commande. Zero, une ou plusieurs entrees sont valides.
- `name`, `description` : textes du manifeste local.
- `installedVersion` : texte non vide ou `null`, issu de `plugin.json.version`.
  Aucun numero n'est deduit d'un SHA ou de la version du launcher.
  Une chaine non SemVer reste affichee, mais sa comparaison sera inconnue.
  La presentation source affiche `Version ?` si la version est inconnue.
- `lifecycle` : `ready` ou `construction`. Champ optionnel du manifeste,
  valeur historique par defaut `ready` pour ne pas reclasser arbitrairement
  les plugins existants. Cela ne certifie pas leur completude metier.
- `launchable` : controles preliminaires locaux uniquement ; ne promet pas
  que l'initialisation reussira. `available` est son alias historique.
- `reasonCode` : `null` si lancement permis, `construction` si en construction,
  `unavailable` si une ressource requise est indisponible.
- `reason` : `null` si lancement permis, texte non vide sinon.
  Ne pas prendre de decision a partir du texte traduit.
- `iconUrl` : route locale d'icone ; un 404 doit garder une icone de presentation
  de repli, pas modifier la capacite de lancement.
- `context` : retourner les valeurs telles quelles au lancement ; `year` et
  `country` peuvent etre `""`, `verification` est un booleen strict.

Les manifestes anciens restent valides : `version=null`, `lifecycle=ready`.
Aucune version produit ni classification nouvelle des trois plugins actuels
n'est inventee. Les declarations invalides sont exclues par le catalogue
Python existant et journalisees, pas transformees en plugins lancables.

La construction doit etre rendue dans une categorie distincte, sans action
de lancement. Python refuse aussi le lancement, y compris via le service
commun et l'entree directe. L'absence du catalogue ou d'URL de release ne
change pas `launchable`. L'URL de vue historique d'un manifeste webview
reste obligatoire dans le schema actuel : elle n'est pas l'URL de release.
Le support d'un autre type de lanceur sans URL de vue n'est pas ajoute ici.

### launch(id, year, verification, country)

Signature existante conservee, exactement quatre arguments positionnels :

```javascript
await window.pywebview.api.launch("local_tool", "2026", false, "FRA");
```

Reponse apres creation du processus :

```json
{"ok": true}
```

Refus (le texte comprend actuellement le chemin du journal local) :

```json
{"ok": false, "error": "Motif du refus\nJournal : <dossier local des journaux>"}
```

`ok=true` signifie **processus cree, fenetre non confirmee**, pas plugin pret.
Ne pas fabriquer de `ready` metier. Erreur de transport : etat inconnu,
pas de nouvelle tentative automatique.

L'identifiant doit appartenir a l'inventaire Python installe ; contexte
identique a celui de l'accueil ; controles de ressources et de construction
reappliques a chaque demande. Le precontrole AIM reste propre a son lancement.
Les wrappers PythonPart existants restent les quatre wrappers livres ; aucune
nouvelle palette ou commande arbitraire n'est generee.

### get_catalog() : etat reel de ce lot

```json
{
  "ok": true,
  "data": {
    "schema": "allplan-tools-catalog/1",
    "status": "not_configured",
    "entries": [],
    "error": null
  }
}
```

Aucun acces reseau, aucune URL GitHub active, aucun cache cree. L'echec du
catalogue ne doit jamais devenir un echec de l'inventaire local.

### update(id) : un seul argument, aucun lien fourni par la vue

```javascript
await window.pywebview.api.update("local_tool");
```

Plugin installe connu, catalogue non configure :

```json
{
  "ok": false,
  "error": {
    "code": "catalog_not_configured",
    "message": "Aucun catalogue de mises a jour configure."
  }
}
```

Identifiant absent de l'installation ou argument invalide :

```json
{"ok": false, "error": {"code": "unknown_plugin", "message": "Plugin local inconnu."}}
```

Ce lot n'ouvre aucun lien et n'effectue ni telechargement ni installation.
Les methodes publiques existantes et leurs enveloppes ne sont pas unifiees
artificiellement : `launch.error` reste un texte, `update.error` est un objet.

## Evolution catalogue /2 preparee dans les sources (non deployee)

Cette section remplace le cadrage reserve precedent ci-dessous pour le
prochain lot. Le contrat /1 installe reste non configure et inchange.
`application/core/plugin_updates.py` porte le modele et la selection ;
`HomeApi` possede une instance `CatalogSession` par fenetre.

### Fermeture facultative de l'accueil

`close_home()` ne prend aucun argument. `show_home()` associe uniquement sa
fenetre native a cette instance du pont. La methode appelle `window.destroy()`,
sans arreter de processus ni toucher aux fenetres des plugins.
La reponse `{"ok": true, "status": "requested"}` indique seulement que la demande
native a ete emise, pas que la fenetre ou le runner est deja termine.
Une fenetre non associee ou un echec de destruction est une erreur explicite ;
les erreurs attendues sont journalisees et renvoyees avec `ok: false`.
Le frontend doit detecter cette methode facultative apres confirmation,
preserver Annuler et son repli navigateur/ancien hote, et afficher tout echec
sans annoncer une fermeture confirmee.

- Les appels restent `get_catalog()` et `update(id)`, directs pywebview.
  Inventaire et lancement ne consultent jamais ce service.
- La nouvelle projection est identifiee par `allplan-tools-catalog/2` :
  elle n'est pas identique a /1. Un frontend sur ancien hote (methodes
  absentes ou schema /1) conserve le lancement et desactive Update.
- Statuts : `not_configured|available|unavailable`. Sources :
  `none|embedded|cache|remote`. `verifiedAt` est la date UTC de la derniere
  verification distante reussie du document, jamais celle de sa relecture ;
  `lastAttemptAt` est celle de la tentative de cette demande, ou null.
- Aucune attente avant affichage de l'inventaire. Appel catalogue facultatif
  apres affichage, sans scrutation periodique. Aucun appel dans launch/update.
  Le chargeur injecte recoit un budget total de 3 secondes qu'il doit faire
  respecter. Aucun adaptateur reseau reel ni URL n'est active ici.
- Format distant strict : `{schema:"allplan-tools-release-catalog/1",
  plugins:[{id,name,releases:[{version,releaseUrl,lifecycle,compatibility}]}]}`.
  `version` est une SemVer stricte ; lien texte non vide ou null ; lifecycle
  `ready|construction` ; compatibility contient homeContract entier positif,
  allplanMin/Max entiers positifs ou null, bornes inclusives. Identites
  dupliquees et releases de meme precedence (meme avec metadata differentes)
  rejetees. Aucune restriction implicite aux versions stables.
- `latestKnownVersion` est le maximum SemVer toutes releases comprises,
  meme incompatibles/en construction. `proposedVersion` est le maximum
  compatible et ready, ou null. Une release incompatible superieure ne masque
  jamais une release compatible. `catalogLifecycle` decrit la derniere
  release toutes compatibilites ; la proposition est toujours ready.
- `comparison` compare uniquement proposedVersion a installedVersion :
  `newer|equal|older|unknown`. Les versions locales nulles ou non SemVer
  restent inconnues/non comparables ; aucune version actuelle inventee.
- `canUpdate` n'est vrai que pour available + remote, une proposition
  compatible strictement superieure, un plugin installe ready et un lien
  autorise. Cache/embarque restent informatifs (`informative_source`) ;
  un echec de consultation donne `catalog_unavailable`, pas "a jour".
- `requestId` entier croissant par fenetre, `superseded` booleen : chaque
  nouvelle demande invalide immediatement les propositions precedentes.
  Une reponse tardive ne remplace ni proposition ni cache recents, porte
  superseded=true et canUpdate=false (`catalog_superseded`). Le frontend
  doit aussi ignorer une reponse superseded ou d'une demande UI anterieure.
- Update retrouve uniquement la proposition de cette fenetre, revalide
  installation/compatibilite/lien, sans reseau ni substitution. Succes :
  `{ok:true,data:{id,version,status:"link_open_requested"}}`. Cela ne
  confirme ni chargement de page, ni telechargement, ni installation.
- Aucun stockage persistant ni lecteur de cache disque ajoute : les
  snapshots embarques/cache sont injectables et la derniere reponse distante
  valide est conservee seulement en memoire dans cette fenetre.
- Adaptateur d'ouverture et domaines autorises desactives par defaut.
  Les tests injectent chargeur et ouverture simules. L'UI frontend finale
  reconciliee avec Lovable n'est pas remplacee par la variante locale.

### Transport public prepare, activation explicite uniquement

Dans le runtime de l'hote, `productionCatalogEnabled` absent ou `false`
conserve `not_configured` sans processus de transport ni reseau.
Seul le booleen `true` injecte le chargeur. Une valeur mal typee ou un
interpreteur configure invalide produit une erreur catalogue explicite
`catalog_internal_error`, journalisee, sans bloquer inventaire/lancement.
Aucun `runtime.json` existant n'est active par ce lot.

URL fixe (emplacement cible, sans publication dans ce lot) :
`https://raw.githubusercontent.com/AllplanFr/PythonPartsFr/main/Allplan_Tools/plugin-catalog.json`.
Le document initial autorise est
`{"schema":"allplan-tools-release-catalog/1","plugins":[]}`.
Il reste un artefact de preparation, pas un snapshot embarque.

Le chargeur lance explicitement `pythonExecutable` configure, absolu et
existant (`python.exe` sous Windows), jamais `sys.executable` de l'hote.
La commande utilise `-I -B` et le fichier de transport local en mode worker,
sans shell ni dependance ajoutee. La reponse identifie l'interpreteur
effectivement utilise ; une identite differente est refusee.

Le parent mesure un budget monotone unique de 3 secondes avant creation
du processus : attente du verrou de transport, demarrage, DNS, connexion,
TLS, lecture et decodage/controle du protocole parent sont inclus.
Un resultat traite apres l'echeance est refuse. La reception stdout est
progressive, sans thread : sous Windows, PeekNamedPipe precede chaque
lecture des seuls octets disponibles. L'accumulation est limitee a 8 Mio
plus un octet de detection ; le depassement arrete immediatement la lecture.
stdin/stderr vont vers DEVNULL, sans accumulation ni fichier temporaire.

Le nettoyage dispose d'un budget distinct de 0,5 seconde. Le parent tente
kill si necessaire puis wait avec le temps de nettoyage restant, jamais
communicate ni attente sans delai. La course entre kill et une sortie deja
effective est acceptee si l'arret est confirme. Un echec reel de kill,
une expiration/erreur de collecte ou de fermeture de pipe est journalise
et remonte comme erreur interne explicite, pas comme simple timeout reseau.
La fermeture de chaque pipe est tentee, meme si une autre echoue.
Si wait echoue ou expire mais que le poll final renvoie un code de sortie,
l'arret et la collecte sont suffisamment confirmes pour autoriser les
creations suivantes ; l'erreur de wait reste journalisee et remontee.
Sous CPython Windows, poll utilise WaitForSingleObject(handle, 0) puis
GetExitCodeProcess, comme wait sans attente ; il n'y a pas de zombie POSIX
a recolter. Le handle Popen reste gere par sa duree de vie normale.
Sous CPython POSIX, poll recolte normalement l'enfant par waitpid(WNOHANG)
et memorise son code de sortie. Cela suppose que cet enfant reste gere
par Popen, sans recolteur externe ni modification de SIGCHLD.
Si l'arret ne peut pas
etre confirme, la reference du processus est conservee et tout nouveau
worker du meme processus hote est refuse, meme depuis une autre fenetre.
Un appel ulterieur ne leve ce blocage qu'apres confirmation et collecte.
Le transport est serialise dans le processus hote ; aucune relance
automatique, redirection ou thread de lecture n'est ajoute.

Les operations systeme de creation, arret, verification et fermeture ne
sont pas preemptibles : les budgets ne garantissent pas une duree murale
absolue de retour ni l'arret face a un echec du systeme. Le delai de
nettoyage s'ajoute au budget de transport ; aucun succes n'est rendu si
l'arret ou le traitement du resultat n'est pas confirme dans ces conditions.
TLS et verification du nom sont conserves ; aucun proxy herite ni
authentification n'est utilise. Corps limite a 1 Mio, sans compression,
UTF-8 et JSON stricts (cles dupliquees/nombres non finis refuses).

Le cache reste uniquement en memoire par fenetre : un echec conserve
le dernier document valide comme information, sans Update. Aucun snapshot
embarque ni cache disque n'est livre. Les domaines restent vides et
l'ouverture desactivee (`allowed_hosts=()`, `open_link=None`), meme si une
future reponse distante contient des liens. Aucun rattachement a la version
globale du depot n'est effectue. Les tests de transport n'utilisent pas Internet.

### Cadrage /1 anterieur, historique non actif

Document a convenir avec la future URL GitHub :

```json
{
  "schema": "allplan-tools-release-catalog/1",
  "entries": [
    {
      "id": "local_tool",
      "name": "Local tool",
      "latestVersion": "1.2.3",
      "releaseUrl": null,
      "lifecycle": "ready",
      "compatibility": {
        "homeContract": 1,
        "allplanMin": 2022,
        "allplanMax": null
      }
    }
  ]
}
```

`latestVersion` et `releaseUrl` : texte non vide ou null ; `lifecycle` :
`ready|construction`. `allplanMin/Max` : entier ou null (borne absente).
`homeContract` : entier positif. Un catalogue invalide ne doit pas etre accepte.
Cette enveloppe est documentee seulement : aucun lecteur distant ni
comparateur SemVer n'est active dans ce lot.

Etats reserves de `get_catalog().data` : `available` avec ces entrees et
`error=null`, `unavailable` avec `entries=[]` et `error={code,message}`.
Codes reserves : `catalog_unavailable`, `catalog_invalid`.
`not_configured` est le seul etat emis actuellement.

La jointure se fera par `id`, sans remplacer les donnees installees :

- Version installee absente, version distante absente ou SemVer invalide :
  comparaison `unknown`, jamais version zero ou comparaison lexicographique.
- Plugin absent du catalogue : local/non reference, lancement inchange.
- Catalogue absent/hors ligne/invalide : lancement local inchange.
- URL de release absente/inexploitable : pas de bouton Update.
- Incompatibilite de la version proposee : pas d'Update applicable ;
  ne pas assimiler a une erreur du plugin installe.
- Entree catalogue sans installation locale : ligne de decouverte distincte,
  `installed=false`, aucune fleche de lancement et aucun Update dans ce lot.
  Ne jamais l'ajouter a `get_home_info().plugins` ni inventer de point d'entree.

Apres activation future autorisee seulement : comparaison SemVer stricte
(prerelease comparee selon SemVer, build metadata sans effet sur la precedence).
Update visible avant la fleche uniquement si version plus recente connue,
compatibilite et lien valides ; Python revalide l'id et le lien du catalogue
avant ouverture dans le navigateur externe. Aucun basculement de frontend
en cours de session, aucun telechargement ou installation par cette action.

## Routes effectivement servies par l'accueil local

Origine du serveur existant : `http://127.0.0.1:<port attribue par pywebview>`.
Ne pas coder son port en dur ; utiliser les chemins relatifs.

| Route GET | Comportement |
|---|---|
| `/` | `index.html` du bundle accueil verifie |
| `/index.html` | Meme fichier, s'il est dans le manifeste |
| `/<nom present dans home-manifest.files>` | Fichier du bundle verifie, dont `/assets/...` et `/favicon.png` |
| `/plugin-icons/<id installe>.png` | Icone locale du plugin ou repli existant ; sinon 404 |
| Toute autre route | 404 |

`/vob-editor`, `/smartcatalog`, `/information-manager` ne sont **pas** des
routes de plugins servies par cet hote local. En mode natif, utiliser
`api.launch`, pas des liens vers ces chemins. Aucun endpoint HTTP
`/api/catalog`, `/api/update` ou `/api/launch` n'est ajoute.
Les routes publiques des plugins restent inchangees pour leurs hotes propres.

Le transport conserve Bottle/pywebview, le profil `home-test\profile` et
`private_mode=False`. Aucun mappage de dossier, serveur additionnel, changement
d'origine configuree, migration de stockage ou modification du bundle livre.

## Plan d'assemblage hors ligne reproductible (non execute)

1. Figer un etat source complet approuve (travaux locaux tries), le frontend
   accueil compile et son manifeste, puis les versions produit declarees.
   L'accueil extensible exige un nouveau bundle Lovable verifie : le bundle
   actuel valide encore une liste de trois identifiants. Aucun asset ancien
   n'est retouche et aucune route de ressource n'est reecrite.
2. Construire depuis un Python Windows x64 propre, pas en copiant le venv
   personnel. Base de recette constatee : CPython 3.14.7 x64. Produire un
   runtime distribuable approuve et une installation de dependances depuis
   un wheelhouse preconstitue, versionne par inventaire SHA-256, avec
   `--no-index --require-hashes` et sans resolution en ligne chez l'utilisateur.
3. Versions presentes servant de base a figer et revalider dans cet
   environnement propre :

   | Dependances d'execution Python | Version constatee |
   |---|---|
   | pywebview | 6.2.1 |
   | bottle | 0.13.4 |
   | proxy_tools | 0.1.0 |
   | typing_extensions | 4.16.0 |
   | pythonnet | 3.2.1 |
   | clr_loader | 0.3.1 |
   | cffi | 2.1.1 |
   | pycparser | 3.11 |
   | defusedxml | 0.7.1 |

   Ce releve n'est pas un lockfile ni une certification de redistribution :
   obtenir toutes les roues compatibles CPython/Windows/architecture et leurs
   hashes avant construction. Setuptools/wheel sont des outils de build ;
   jsonschema et ses dependances servent aux tests de contrats, pas a imposer
   une installation en ligne au lancement.
4. Livrer les DLL WebView2 Core/WinForms, le loader natif de l'architecture et
   les composants pywebview/.NET necessaires. Prerequis : Windows compatible,
   CLR .NET Framework compatible pythonnet/WinForms (minimum 4.7.2 pour ce
   parcours), runtime Microsoft Edge WebView2 installe hors ligne.
   Sa version exacte et les autres redistribuables natifs requis doivent etre
   releves et figes sur la machine de construction propre avant validation.
   Le controle actuel refuse un runtime absent : aucun bootstrap Internet.
   En mode Allplan : installation compatible (2022+ ou mode 99), contexte et
   API PythonPart disponibles ; validation manuelle ciblee reste a faire.
5. Assembler sources Python + overlay + runtime + accueil + icones +
   wrappers/configuration. Generer le manifeste depuis les octets livres ;
   garder `.gitattributes` et les epingles. `assemble_package.py` actuel
   prepare une copie de test, reference encore un Python externe, un profil
   et une candidate AIM : il ne constitue pas un paquet utilisateur autonome.
   Ne pas embarquer les profils personnels, settings ni fichiers metier.
6. Dans un repertoire neuf, verifier inventaire/empreintes et imports sans
   plugin ; ensuite, apres accord distinct, verifier un premier lancement
   accueil sans reseau et sans build. Documenter architecture, runtime,
   versions, licences et provenance des dependances. Pas de revendication
   d'autonomie avant cette verification sur environnement propre.

Les plugins ne deviennent pas hors ligne dans ce lot : VOB/SmartCatalog
conservent leurs parcours actuels ; AIM n'est ni remis en coherence ni
republie. Leurs futurs frontends locaux seront des livraisons completes,
verifiees et fixes pour la session via l'interception protegee existante.
Les fichiers sur partages reseau restent dependants de ces partages.
