# Allplan Tools : lanceurs PythonPart directs (demarrage automatique)

Sources reproductibles du lot valide dans Allplan 2026 : accueil Allplan Tools,
AIM, SmartCatalog et VOB ouverts directement depuis quatre PythonParts, en
Standard par defaut, avec icones locales, sans console et memorisation unique
du projet d'origine. Reference fonctionnelle : copie de test
`pythonpart-autostart-test-20261102`.

**Statut : lot incomplet, non autonome.** Il construit un package de test
isole, avec les protections de copie de travail (`work-manifest.json`,
`verify_work_copy`), et non le launcher de production. Il depend de travaux
AIM non versionnes (voir « Blocages »). Aucune validation native n'est
revendiquee pour un package reconstruit depuis le depot : la validation
Allplan porte sur la copie de test `pythonpart-autostart-test-20261102`.

Ce dossier ne modifie ni `application/` ni le launcher de production. Il
contient des fichiers propres au lot et un assembleur qui produit, dans un
nouveau dossier, un package identique a la reference valide.

## Contenu

| Dossier / fichier | Role |
|---|---|
| `overlay/python/` | Fichiers Python et ressources propres au lot, superposes a `application/` lors de l'assemblage (26 fichiers). |
| `runtime/` | `runner.py`, `preflight.py`, `home_host.py` : hote de l'accueil et enfant lance par les PythonParts. |
| `pythonparts/AllplanToolsTest/` | `entry.py` et les quatre wrappers. `entry-config.example.json` montre la configuration attendue. |
| `library/` | Quatre `.pyp` et leurs 12 PNG compagnons (`_24`, `_128`, copie sans suffixe). |
| `template/` | Modele de nouveau lanceur et sa notice. |
| `home/` | Bundle de l'accueil, revision `980fff2`, empreintes dans `home-manifest.json`. Livre par Lovable : ne pas modifier. |
| `tools/` | Preparation et normalisation des icones. |
| `tests/` | Tests du lot et sondes natives (`native_*_probe.py`, hors suite automatique). |
| `palette-normalization.json`, `validated-icons-reference.json` | Donnees de reference lues par les tests. |
| `assemble_package.py` | Construit le package de test. |

## Dependances

- Windows, Python 3.14 du venv du depot, pywebview (WebView2), `requirements.txt` du depot.
- `application/` du depot. Le lot suppose des travaux AIM non versionnes
  (voir « Blocages »).
- Une candidate AIM epinglee et son profil de donnees, fournis a l'assemblage
  (artefact externe local, non reconstructible depuis les sources).
- Les ressources AIM epinglees ne sont jamais modifiees.

## Blocages (distincts)

1. **Dependances Python AIM absentes du lot.** `origin_project.py`
   (memorisation du projet) importe `AimProjectApp` et `ProjectManager`
   (`information_manager/project.py` modifie, `project_manager.py`,
   `presentation_structure.py`, non suivis). Sur une copie exacte HEAD + index,
   la memorisation echoue sans bloquer le lancement et
   `test_bad_store_logs_without_raising`,
   `test_case_normalization_and_missing_project` et
   `test_inventory_preserves_metadata_history_and_favorites`
   (`test_finishing.py`) sont en erreur : **32 tests reussis, 3 erreurs sur 35**.
2. **Ensemble AIM epingle et candidate externe.** Le preflight reel
   (`runtime/preflight.py`) exige l'archive `AIM_candidate_0b05206.zip`, le
   profil avec `local-delivery.json` et `aim_local_delivery.delivery_pin`, qui
   epingle les SHA de 11 fichiers Python du travail AIM
   (`WORKING_PYTHON_FILES`). Ces fichiers ne sont pas dans le lot : **le
   preflight reel n'est pas valide pour ce lot**. Aucun controle n'est
   desactive et aucun SHA attendu n'est modifie.

## Assembler

Depuis la racine du depot :

```
venv\Scripts\python.exe allplan_tools\assemble_package.py --out <DOSSIER_NEUF> --profile <PROFIL_AIM> --pinned-candidate <CANDIDATE_AIM> --python venv\Scripts\python.exe
```

Le dossier de destination doit etre vide ou absent. L'assembleur copie
`application/` et les scripts racine necessaires, superpose `overlay/`, genere
`entry-config.json`, `runtime.json` et `work-manifest.json` (empreintes
SHA-256 verifiees au demarrage de chaque enfant). Aucun chemin personnel n'est
versionne. Rien n'est installe dans Allplan.

## Tester

Dans le package assemble :

```
cd <DOSSIER_NEUF>
<python> -m unittest discover -s tests -p "test_*.py"
```

Ne pas lancer ces tests depuis le depot : ils attendent la disposition du
package (`python/`, `runtime.json`). 35 tests, aucune ouverture de plugin ;
sur la copie HEAD + index : 32 reussis, 3 erreurs (blocage 1).
Les messages « Echec du lancement du plugin » affiches pendant la suite sont
les refus simules attendus.

## Installer dans Allplan (manuel, apres autorisation)

Preparer d'abord un plan : chemins source/destination, empreintes SHA-256 et
suffixe de sauvegarde datant l'operation. Aucun script ne copie dans Allplan.

1. Allplan ferme normalement.
2. Bibliotheque : copier les 16 fichiers de `library/` dans
   `...\Std\Library\ALLPLAN FRANCE\AllplanToolsTest\` (les `.pyp` et PNG).
3. Scripts : copier les six fichiers de `pythonparts\AllplanToolsTest\`
   (`entry.py`, quatre wrappers, `entry-config.json` genere) dans
   `...\Std\PythonPartsScripts\AllplanToolsTest\`. `__init__.py` y est deja.
4. Avant chaque remplacement : sauvegarder l'existant sous un suffixe dedie,
   sans ecraser une sauvegarde, et arreter si une empreinte differe du plan.
5. Verifier les empreintes apres copie, puis redemarrer Allplan (les modules
   sont recharges au demarrage).

`entry-config.json` selectionne le package assemble via `testRoot` : changer
de package ne demande que ce fichier. Les icones se remplacent sans toucher
au code (voir `tools/`), puis regenerer `work-manifest.json` par un nouvel
assemblage.

Retour arriere : restaurer les sauvegardes, verifier leurs empreintes
originales, redemarrer Allplan.

## Limites connues

- Les fichiers `aim-icon-32.png` et `aim-icon.ico` de la copie de reference
  ne sont references par aucun code ni manifeste de plugin et ne sont pas
  repris ici.
- `validated-icons-reference.json` ne controle que les fichiers propres au lot
  et le bundle d'accueil ; le reste de `python/` est couvert par
  `work-manifest.json`.
- Les sondes natives et la recette Allplan restent manuelles.
