# Release candidate commune 2.0.0-rc.1

Statut : artefacts de preparation, pas activation d'un hote 2.0.
Version transport : `2.0`. Version de release : `2.0.0-rc.1`.
Une modification de ces artefacts apres transmission impose une nouvelle
release ; synchroniser schema.json, fixtures.json, manifest.json et ce README
dans les trois frontends, sans reecrire les lecteurs ni changer les endpoints.
Les empreintes SHA256 portent sur les octets UTF-8 exacts des deux fichiers JSON.
Conserver les fins de ligne lors de la copie.

## Couverture exacte

`schema.json` est un JSON Schema Draft 2020-12 autonome, sans reference distante.
Son identifiant est un URN, pas une adresse a contacter.
Racine : messages request/response/event **uniquement pour les six commandes
entierement definies** :
host.handshake, host.capabilities, host.context,
diagnostic.get, diagnostic.set, diagnostic.open_logs.
Tous les champs des payloads/resultats de ces commandes sont verifies.
Evenement couvert : diagnostic.state.
Toutes ces commandes sont independantes de l'epoque des referentiels :
context_id et generation null dans leur enveloppe ; host.context contient
le vrai contexte dans son resultat. Session obligatoire partout.
operation_id null car ces commandes ne sont pas des ecritures suivies.
L'annulation n'est permise ici que pour diagnostic.open_logs.

Les definitions reutilisables couvrent bootstrap, contexte, capacites, erreurs,
diagnostics, propositions, valeurs typees et rapport d'ecriture portable.
Pour les erreurs autres que partial_write, details est un objet vide :
les futurs details propres aux erreurs devront avoir un schema dans une
release suivante, pas un objet libre pretendument valide.
Le rapport partial_write est defini comme modele, pas comme service AIM actif.

Hors couverture executable : resource.load, host.refresh, settings et documents
metier, app.open, AIM save/close/values, registre d'operations et evenements
contexte/operations. Le catalogue du contrat explique leurs intentions et leur
statut reserve, mais ce schema les rejette volontairement. Il n'existe pas de
schema generique permissif qui leur accorderait une fausse conformite.
Le schema n'est pas un dispatcher runtime : une future frontiere doit distinguer
une commande inconnue et un payload invalide sans perdre la correlation.

## Consommation Python et TypeScript

Python : installer l'extra de test declare dans pyproject.toml :
`.\venv\Scripts\python.exe -m pip install -e ".[contract-tests]"`.
Puis `.\venv\Scripts\python.exe -m unittest discover -s tests -p test_protocol_release.py`.
Le validateur utilise FormatChecker pour verifier les dates calendaires.
Aucune dependance jsonschema n'est ajoutee aux applications installees normales.

TypeScript : utiliser un validateur Draft 2020-12 (par exemple Ajv2020 avec
ajv-formats pour date), strict, sans coercion, sans suppression de proprietes
inconnues et sans injection de defaults. Ne pas utiliser Ajv draft-07 pour ce
schema : unevaluatedProperties doit etre applique.
Charger schema.json une seule fois et selectionner une definition via $ref
local `#/$defs/<target>` pour les fixtures de modeles.
Ne pas generer des variantes manuelles de Proposal/TransportValue :
generer les types depuis ce schema ou tester les types locaux contre cette release.
Les regles semantiques suivantes restent obligatoires en plus du schema.

Le parseur de transport doit rejeter les cles dupliquees AVANT JSON.parse ou
equivalent : un schema ne les voit plus apres parsing.
Refuser NaN/Infinity, y compris nombres depassant la plage JSON finie.
La taille maximale se mesure en octets UTF-8, pas en caracteres JS.

## Fixtures portables

fixtures.json contient :

- valid : objets complets, nom et target de definition a valider.
- invalid : copie profonde de la fixture base ; supprimer les cles remove,
  puis appliquer set. Les chemins set separes par un point descendent dans
  des objets, sans index de tableau. Le resultat DOIT echouer au schema.
- semantic_invalid : meme construction ; le schema DOIT accepter la forme,
  puis la regle relationnelle rule DOIT la refuser.
- invalid_json : texte a rejeter par decodage strict avant validation.
- scenarios : donnees d'entree/sortie pour les tests de comportement frontend.

Regles relationnelles non couvertes par JSON Schema :

| rule | Verification obligatoire |
|---|---|
| session_correlation | Session du bootstrap actif identique au message AVANT lookup request_id |
| handshake_identity | result.session_id et result.app_id identiques a enveloppe et bootstrap |
| unique_capability | Une seule entree par commande |
| snapshot_confirmation | Identite document/revision/snapshot et chaque valeur confirmee identiques au snapshot envoye |
| disjoint_report | Numeros uniques, listes confirme/echec/non confirme disjointes et union couvrant le snapshot demande |

Comparer ensuite commande, app, epoque et requete attendues ; refuser les
doublons/tardifs selon le contrat. Le schema ne peut prouver ces relations.
Le test Python contient des oracles purs pour ces exemples, pas une
implementation runtime ni une verification du HostClient TypeScript distant.

advanceBaseline : initialiser a baseline_before ; pour chaque confirmation
verifiee copier snapshot.values[numero], jamais current[numero].
Les echecs/non confirmes gardent leur ancienne baseline ; comparer current au
resultat pour dirty. Un document confirme pendant que current change reste dirty.
Une presentation non confirmee ne fait pas avancer sa revision.

typedValue : si parsing complet et exact impossible, produire unknown/raw
original/value null ; ne jamais String(undefined), arrondir un entier, reparer
une date ou remplacer par zero/false. Aucun typage depuis la truthiness.
Options historiques texte : combo avec key null ; enum seulement si mapping
de source unique demontre, sinon unknown conserve. Pas de cle par position.

## Limites de validation

Tests Python des artefacts uniquement. Les scenarios frontend sont un corpus
a reprendre dans chaque suite TypeScript ; leur presence n'est pas la preuve
qu'advanceBaseline ou typedValue distants les passent.
Pas de tests Ajv/TypeScript executes ici, ni de transport natif, fermeture ou
ecriture Allplan/prjtool. Les services sont encore absents ; ne pas les annoncer.

## Resultats executes dans le depot Python

Le 25 octobre 2026 :

- `python -m unittest discover -s tests -p test_protocol_release.py` :
  7 tests reussis, incluant 30 fixtures valides, 28 invalides structurelles,
  8 invalides relationnelles, 3 textes JSON invalides, le scenario baseline,
  les exemples JSON du contrat et les empreintes.
- `python -m unittest discover -s tests -p "test_*contract*.py"` :
  55 tests existants reussis, contrats du launcher et des plugins legacy.
- Inspection IDE du nouveau test : aucun avertissement/erreur.
  Build IDE reussi, avec collecte des diagnostics limitee pour Python.

Les 5 scenarios partages sont disponibles pour les suites frontend ;
seul le scenario baseline est execute comme oracle comportemental ici.
Les tests frontend Lovable (39 tests annonces) ne sont pas executes ici.
Les traces d'erreur des 55 tests legacy correspondent a leurs cas d'echec simules.
