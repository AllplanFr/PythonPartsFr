# Preparation AIM isolee

`prepare_aim_delivery.py` utilise les sources centralisees et l'assembleur
existant : sources, overlays, puis les seuls 11 fichiers AIM epingles du lot
fourni. Il ne remplace aucune source commune et ne lance aucune application.
Le bundle d'accueil `artifacts\home-5dd43513` doit deja etre disponible.

Toutes les entrees sont explicites et absolues :

```powershell
& <python.exe> -I -B .\allplan_tools\tools\prepare_aim_delivery.py --out <CANDIDATE_ABSENTE> --profile <PROFIL_ABSENT> --pinned-candidate <DOSSIER_ARCHIVE_EPINGLEE> --aim-application <LOT_CONFORME\python\application> --python <python.exe>
```

Depuis `Allplan_Tools`, valider sans aucune destination :

```powershell
& <python.exe> -I -B .\allplan_tools\tools\prepare_aim_delivery.py --validate-only --pinned-candidate <DOSSIER_ARCHIVE_EPINGLEE> --aim-application <LOT_CONFORME\python\application> --python <python.exe>
```

Le chemin d'archive est exclusivement
`pinnedCandidate\AIM_candidate_0b05206.zip`. Aucun parametre ne remplace
l'archive, sa revision, ses empreintes ou ses controles. Le validateur complet
est importe dans un processus `-I -B` avec ses dependances et constantes.
Le ZIP et le lot sont verifies avant toute creation de destination.

Les destinations, meme vides, doivent etre absentes, disjointes et hors des
sources/entrees protegees. Les remplacements (overlay puis AIM, SHA avant/apres)
sont consignes dans `work-manifest.json`, calcule sur les fichiers finaux.
Le Python final doit satisfaire `verify_work_copy`, `verify_python`, le
confinement des modules et les chemins effectifs de lancement. Le descripteur
exact est ensuite ecrit exclusivement dans le nouveau profil, relu par
`installed_resources`, puis controle par le preflight existant. Un echec
supprime les deux arbres exclusivement crees par cette execution, pas des
destinations preexistantes. Les repertoires parents nouvellement crees peuvent
rester vides. Les erreurs et tracebacks sont propages, sans repli.

Les controles de preparation ne valident pas le fonctionnement complet AIM,
ses donnees metier ou sa fermeture dans Allplan. Les essais d'integration
restent distincts. L'interpreteur et ses dependances doivent deja etre
disponibles ; aucune installation, entree Allplan ou copie de profil
utilisateur n'est effectuee. VOB et SmartCatalog ne sont pas corriges.

## Tests cibles

Depuis `Allplan_Tools`, avec le meme interpreteur et uniquement des destinations
temporaires :

```powershell
$env:AIM_TEST_PINNED_CANDIDATE = '<DOSSIER_ARCHIVE_EPINGLEE>'
$env:AIM_TEST_APPLICATION = '<LOT_CONFORME\python\application>'
& <python.exe> -B -m unittest discover -s .\allplan_tools\tests -p test_prepare_aim_delivery.py
```

Les deux variables designent des entrees lues seulement, jamais des sorties.
Sans elles, seuls les tests unitaires sont executes ; les tests avec le ZIP
epingle et le lot reel sont ignores explicitement. Le test de ressource
alteree simule uniquement l'empreinte de l'enveloppe dans son processus de
test pour atteindre le controle interne ; aucune epingle sur disque ni
protection de production n'est modifiee.

## Recette depuis Allplan - 2026-11-13

L'utilisateur confirme le parcours visuel depuis l'entree
`AllplanToolsAimRecipe` : ouverture de l'accueil, lancement AIM, puis fermeture.
Candidate : `C:\Users\jmauger\Documents\AllplanLocal\AllplanTools\home-aim-0b05206-candidate`.
Profil : `C:\Users\jmauger\Documents\AllplanLocal\AllplanTools\home-aim-0b05206-profile`.
Provenance composite : socle centralise
`d3a41573981b03c4be0a193fac095f034258a3b2`, bundle frontend
`5dd43513ec8f170c8e8bc138f5fd2e0c82ae31ee`, lot AIM epingle
`0b05206ba6c1ce6d7ef9fcc9e6df7879601bfc65`, preparateur local non commite.
La candidate n'est pas un etat Git propre du seul commit du socle.

Collecte en lecture seule sous le profil, dans `AllplanWebLauncher` :

- `home-test\preflight-3f95afaffc6d44f284d5574a1de06a3e.json` :
  `verified`, revision et SHA d'archive epingles, 28 ressources, 36 modules,
  racine Python de la candidate et profil attendus ; journal `.log` vide.
- `logs\allplan-entry-48b3b702096d4dccbe6bc20dc307bad9.json` :
  `accepted` (demarrage seulement), journal `.log` vide.
- `logs\session-37916-1794567217322510700-704ad063.log` :
  enfant AIM 33900 lance ; `AIM child_exit`, code 0 a 11:53:58.
- `logs\session-37512-1794567225996039600-30a866ee.log` :
  `AIM_WINDOW_CLOSED`, puis `AIM_HOST_RETURN` avec `windowClosed:true`,
  `bootstrapFailure:null`, `hostExceptionType:null`.

Aucune occurrence de `_presentation_save`, traceback, niveau ERROR ou echec
de mise a jour de l'inventaire dans les journaux collectes. Des avertissements
restent presents : decouverte d'installations/chemins TMP et langues non
resolus, installation Allplan 99 ignoree faute de contexte accessible, types
de definitions d'attributs non pris en charge (synthese AIM : 91 avertissements,
dont 22 de decouverte, 1 de contexte incomplet et 68 de types non pris en charge).
Ces avertissements ne sont pas corriges par cette recette.

A 11:58:40, PID 37916, 37512 et 33900 absents ; aucun processus residuel
identifiable par ces PID, leur parentage disponible ou les chemins
candidate/profil. Les processus de collecte eux-memes sont exclus.
Sans arbre initial des processus, l'absence de descendants detaches n'est
pas certifiable. Aucun arret force ni relancement effectue. Le code de sortie
du runner d'accueil n'a pas ete recueilli ; sa disparition ne le prouve pas.
Le journal ne trace pas explicitement l'appel `close_home()` de l'accueil.

Cette recette confirme uniquement le parcours visuel rapporte par
l'utilisateur et les preuves ci-dessus. Les fonctions metier AIM, les
modifications/enregistrements et leurs parcours d'annulation ne sont pas
testes dans cet essai.
