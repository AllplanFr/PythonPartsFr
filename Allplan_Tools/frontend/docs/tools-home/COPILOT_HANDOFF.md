# Allplan Tools : raccordement de l'accueil existant

## Livraison et statut exact

Ce paquet est reserve au test, distinct de la candidate AIM epinglee.
Il ne remplace ni son launcher, ni son backend, ni son frontend.
L'accueil vise est le composant ToolsHome existant, route `/`, et non le
selecteur technique `selector.html`. Ne pas redesigner l'accueil.

Le service de lancement existant est `SelectorApi.launch()`, qui delegue a
`application.core.launching.launch_plugin()`. L'adaptateur de test HomeApi
reutilise cette methode, sa signature et ses reponses. Aucun app.open,
commande systeme ou executable choisi par le navigateur n'est ajoute.

Python prepare : `home_host.py`, methode `show_home(context, directory,
expected_revision, timeout=15)`. Cette fonction est un point de raccordement
de test explicite, pas un nouveau launcher CLI et pas l'accueil actif.
Elle exige le package de la candidate et le profil isole, sans modifier
LOCALAPPDATA. Elle reutilise pywebview / WebView2 et son serveur de fichiers
locaux. Les plugins restent lances par les services hote existants.

Les ressources d'accueil raccordees ne sont PAS encore livrees. Le
PythonPart actuel n'est PAS bascule vers cet accueil. Pas de nouvelle
recette utilisateur avant livraison, verification et raccordement complet.

## Transport et detection

Transport : pont pywebview natif, appels asynchrones :

- `window.pywebview.api.get_home_info()`
- `window.pywebview.api.launch(plugin_id, year, verification, country)`

Attendre `pywebviewready`, ou detecter immediatement les deux fonctions si
le pont est deja pret. Borner cette attente a 15 secondes cote frontend.
Lire get_home_info une fois pret et valider sa reponse avec les types et
gardes fournis dans ALLPLAN_TOOLS_HOME_CONTRACT.ts.
Le marqueur exact est `home_launch_contract === 1`.

En navigateur sans pont, conserver les liens navigateur existants. Si un
hote natif est detecte mais que le service manque, echoue ou donne une
reponse invalide, afficher l'indisponibilite : ne pas naviguer vers un plugin
dans la fenetre d'accueil et ne pas basculer silencieusement en navigateur.
Ce marqueur n'est ni une identite plugin ni une capacite AIM. Il ne faut
pas changer les gardes d'identite des modules pour le prendre en charge.

## Donnees completes

Types, signatures et gardes : fichier TypeScript joint, sans dependance.
Exemple de get_home_info :

```json
{
  "home_launch_contract": 1,
  "context": {"year": "2026", "verification": false, "country": ""},
  "plugins": [
    {"id": "smartcatalog", "available": true, "reason": null},
    {"id": "vob_editor", "available": true, "reason": null},
    {"id": "information_manager", "available": true, "reason": null}
  ]
}
```

Les identifiants sont exactement smartcatalog (SmartCatalog Editor),
vob_editor (VOB Editor), information_manager (Information Manager).
Les autres lignes de l'accueil restent indisponibles.
available signifie ressources locales declarees presentes, pas
initialisation reussie, projet valide ou fenetre prete.
Exemple indisponible :
`{"id":"vob_editor","available":false,"reason":"Ressource livree manquante."}`.

Les quatre arguments positionnels sont obligatoires et stricts :
plugin_id dans l'enumeration ; year et country chaines ; verification booleen.
Recopier les trois valeurs de context SANS transformation. L'accueil
n'offre pas de changement d'installation dans ce lot. Un ecart est refuse.
Une annee/pays vide est legitime quand le contexte est non renseigne.
Les chemins et le projet courant restent conserves dans l'objet Python ;
ils ne sont ni exposes ni reconstruits par le frontend.

Exemple d'appel, apres validation du service et de HomeInfo :

```ts
const context = info.context;
const reply: unknown = await api.launch(
  "information_manager", context.year, context.verification, context.country,
);
if (!isLaunchReply(reply)) throw new Error("Reponse hote invalide");
if (!reply.ok) {
  // Afficher reply.error dans l'accueil, conserver la liste utilisable.
} else {
  // Afficher « Processus lance », pas « Application prete ».
}
```

## Reponses et erreurs

Succes exact : `{"ok":true}`. Le service existant est revenu apres creation
du processus plugin. Cela ne prouve NI que la fenetre est prete NI que le
chargement du plugin a reussi. Aucun evenement ready n'est fourni par ce lot.
Le precontrole AIM est une condition prealable, pas une preuve d'ouverture.

Echec exact : `{"ok":false,"error":"message explicite"}`. Aucun champ code
n'est fourni ; ne pas analyser les textes pour inventer des codes.
Causes : arguments invalides, contexte different, ressources indisponibles,
demande simultanee, AIM deja ouvert, precontrole refuse/expire/invalide,
validation hote ou erreur de creation de processus. Les erreurs existantes
de SelectorApi sont conservees. Les rejets du transport (Promise rejetee)
doivent etre affiches separement, jamais interpretes comme un succes.

Les details techniques sont journalises cote Python ; les tracebacks du
precontrole enfant sont conserves sous le profil isole, dossier home-test.
Le precontrole est borne a 60 secondes ; le service existant utilise son
timeout de resolution (15 secondes par defaut). Ce n'est pas une garantie
de duree totale jusqu'a une fenetre prete.

## Clics et cycle de vie

Mettre un verrou frontend SYNCHRONE avant await ; desactiver toutes les
actions d'ouverture pendant la requete. Une seule requete doit partir pour
un double clic. L'hote refuse aussi les appels concurrents, mais ne deduplique
pas deux demandes successives apres le retour de la premiere.
Apres succes ou erreur, liberer le verrou et reactiver les seuls plugins
disponibles. Pas de retry automatique ni de relancement a un timeout UI :
la demande precedente peut avoir cree un processus.
AIM conserve sa protection d'instance existante ; aucune nouvelle politique
mono-instance n'est imposee aux autres plugins.

L'accueil reste ouvert. Chaque plugin obtient sa propre fenetre et son
identite propre ; aucun module ne monte dans la fenetre d'accueil native.
Le contexte Allplan et le profil isole sont transmis par les services
existants, jamais par une commande fournie par le frontend.

## Ressources a fournir par Lovable

Remettre une livraison locale autonome de l'accueil EXISTANT raccorde :
sources, revision exacte, commandes de construction/tests, index.html et
ses ressources locales, sans inclusion du document protege AIM comme accueil.
Le frontend AIM et les autres modules ne sont pas a modifier.
Construction prevue pour un hebergement statique local, sans serveur SSR.
Aucun script, police ou ressource distante requis ; aucune navigation native
vers les routes plugins a la place des appels launch.

Inventaire de l'accueil dans son propre dossier, independant de l'archive AIM :

```json
{
  "schema": "allplan-tools-home/1",
  "revision": "<revision exacte de la livraison accueil>",
  "entry": "index.html",
  "files": {
    "index.html": "<sha256 des octets>",
    "assets/entry.js": "<sha256 des octets>"
  }
}
```

Nom : home-manifest.json. Les cles files utilisent des chemins relatifs
avec `/` ; inclure TOUT fichier servi sauf le manifeste lui-meme. Aucun
fichier supplementaire dans ce dossier. Livrer aussi le SHA256 du paquet
par un canal de livraison identifie ; les empreintes n'authentifient pas
a elles seules une provenance. La revision attendue est fixee par
l'integrateur, pas adoptee automatiquement depuis le manifeste.

L'hebergement prepare verifie inventaire, revision, empreintes et absence
de liens avant creation de fenetre. La qualification des navigations,
ressources reseau et fermeture reste a faire avec les vrais artefacts ;
ne pas confondre ce precontrole statique avec un confinement reseau prouve.

## Verification ciblee et reste

Statut de cette livraison : adaptateur Python et point d'hebergement
IMPLEMENTES, 11 tests cibles reussis hors Allplan. Import du vrai SelectorApi
de la candidate et execution reelle du precontrole enfant reussis :
33 modules applicatifs de la candidate, 28 ressources verifiees.
Aucun plugin ni manager ouvert par ces verifications.
La compilation TypeScript de ce fichier de contrat n'a pas ete executee ici.

Les tests Python joints couvrent delegation, marqueur, contexte fixe,
rejets, concurrence, precontrole avant AIM et hebergement local simule.
Ils n'ouvrent aucune fenetre ni plugin. Execution depuis le depot :

```powershell
.\venv\Scripts\python.exe -m unittest discover -s tests\allplan_tools_home -p test_home_host.py
```

Reste : adaptation de ToolsHome par Lovable, build local identifie et
verifie, raccordement explicite de show_home dans un environnement de test
trace (sans modification en place de la candidate), puis seulement recette
native. Le service prepare n'est pas declare deploye ni valide dans Allplan.
