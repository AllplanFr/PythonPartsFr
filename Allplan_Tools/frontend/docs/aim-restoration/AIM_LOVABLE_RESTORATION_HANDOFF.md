# AIM — guide de raccordement Lovable

Document consolidé : appartenance au PRJ d'installation, classement exclusif du
gestionnaire, présentation et brouillon en mémoire. Il décrit les extensions Python
préparées ; il ne crée aucune architecture de découverte. La révision frontend
doit être vérifiée et autorisée par le dépôt avant tout déploiement. Aucun déploiement
n'est inclus dans cette demande.

Le paquet transmissible inclut `types/AIM_PROJECT_MANAGER_CONTRACT.ts` et ses
dépendances exactes sous `types/` : `aim-project-contract.ts`,
`aim-presentation-contract.ts`, `presentation-tree.ts`. Utilisez directement ces
sources TypeScript, sans reconstituer les types depuis les exemples du guide.

## 1. Détection stricte de disponibilité

Utiliser uniquement le transport natif existant : `get_app_info()`,
`get_initial_data()`, `call(command, payload)`. Ne pas ajouter de transport réseau,
de stockage navigateur pour les données métier, ni d'accès direct aux fichiers.

Le profil de travail est disponible si et seulement si :

```ts
info.id === "information_manager" &&
info.project_contract === 2 &&
info.working_state_contract === 1
```

Le marqueur est un entier littéral `1`, pas `true`. Pour ce profil,
`info.read_only === false` signifie que l'interface peut éditer ses valeurs en
mémoire ; cela n'autorise aucune écriture de fichier. Le snapshot source conserve
`read_only: true`. Le modèle de présentation de travail porte `readOnly: false`.
Ne pas confondre ces deux propriétés.

Les contrats existants restent indépendants et stricts : présentation V1/V2,
historique, gestionnaire, menu et couleur d'aperçu. Ne pas élargir les listes de
capacités historiques. Si le marqueur mémoire est absent ou invalide, ne pas envoyer
de commande `work.*` et ne pas activer l'édition de valeurs sous prétexte que
`presentation.update` existe.

L'extension d'appartenance au PRJ est séparée et facultative :
`info.project_manager_assignment_contract === 1` (entier strict). Son absence
signifie que l'hôte ne fournit pas cette relation ; il est interdit d'assimiler
`source.status/source.version` à l'appartenance du projet. Sans ce marqueur,
l'interface ne peut pas classer les projets par installation de façon fiable.
Cette extension n'ajoute aucune commande ni découverte : elle ajoute un champ
au contrat du gestionnaire derrière un marqueur séparé afin de préserver les
validateurs stricts existants.

## 2. Gestionnaire : classement exclusif d'après le PRJ lu par Python

`project.manager.list {}` retourne uniquement l'inventaire persistant des projets
ajoutés explicitement au gestionnaire. Son schéma reste strict :

```ts
type ManagerEntry = {
  path: string;
  name: string;
  source:
    | { status: "resolved"; version: string; verificationVersion: boolean; reason: null }
    | { status: "unresolved"; version: null; verificationVersion: null;
        reason: "definitions_not_loaded" };
  sourceFreshness: "last_read";
};
type ProjectInstallation =
  | { status: "associated"; version: string; verificationVersion: boolean; prjPath: string }
  | { status: "unassociated" }
  | { status: "unknown";
      reason: "legacy_entry" | "ambiguous" | "association_unavailable" | "no_installations" };
type AssignedManagerEntry = ManagerEntry & { projectInstallation: ProjectInstallation };
```

Chaque projet visible apparaît **une seule fois** :

- si `projectInstallation.status === "associated"`, le classer uniquement sous
  `projectInstallation.version`, en distinguant l'installation via
  `verificationVersion`/`prjPath` si nécessaire ;
- si `projectInstallation.status === "unassociated"`, le classer uniquement dans
  « Ajoutés par l’utilisateur » ;
- si `projectInstallation.status === "unknown"`, le classer une seule fois dans
  « Ajoutés par l’utilisateur », en signalant l'appartenance inconnue ; ne pas
  inventer une version ni traiter le projet comme externe confirmé ;
- ne pas afficher de groupe « Version non résolue » supplémentaire, ni répéter
  sous « Ajoutés par l’utilisateur » un projet déjà classé par version.

Les autres formes `source` sont invalides au regard du contrat strict : signaler
l'erreur de validation, ne pas inventer de version et ne pas traiter la réponse
invalide comme une entrée résolue.

Appliquer la recherche et les filtres choisis avant le classement et le calcul des
compteurs. Ainsi, un seul projet associé à Allplan 2026 donne « Allplan 2026 (1) » et
« Ajoutés par l’utilisateur (0) ». Un projet non résolu donne
« Ajoutés par l’utilisateur (1) » et aucun compteur de version. Les sections
contiennent des ensembles disjoints ; leurs compteurs totalisent les lignes uniques
visibles.

`source.status/source.version` décrivent exclusivement l'installation dont les
définitions ont servi à lire les attributs ; ce n'est pas l'appartenance du chemin
projet au PRJ. Un projet externe peut avoir `source.status:"resolved"` avec une
version de définitions choisie par repli, tout en étant
`projectInstallation.status:"unassociated"`.

Le backend réutilise la vérification réelle de `AimProjectApp._associated(project,
context, issues)`, qui compare le parent du `.prj` au chemin `PRJ` des installations.
Le résultat est exposé sous `projectInstallation` dans chaque entrée de
`project.manager.list {}` ; il est également inclus dans le projet renvoyé par
`project.manager.add {}` et `project.manager.preview {path}`. Le champ n'est présent
que lorsque `info.project_manager_assignment_contract === 1`.

`project.manager.list {}` ne rouvre pas les PRJ au redémarrage, ne vérifie pas si
leur contenu ou leur emplacement a changé et ne lance aucun scan.
`sourceFreshness:"last_read"` signifie que source et appartenance sont mémorisées
à la dernière lecture Python. Une entrée antérieure à cette extension est
`{status:"unknown",reason:"legacy_entry"}` ; ne jamais déduire son appartenance de
`source`. `project.manager.add {}` lit le PRJ choisi et établit l'appartenance.
`project.manager.preview {path}` relit uniquement un chemin déjà inscrit et
actualise l'information persistée après succès ; un échec est explicite et ne
devient pas une résolution réussie. L'aperçu n'ajoute aucun chemin absent de
l'inventaire.

Une correspondance multiple renvoie `unknown/ambiguous`, un échec de comparaison
`unknown/association_unavailable`, et l'absence d'installations comparables
`unknown/no_installations`. Dans ces cas, afficher une seule fois sous « Ajoutés
par l’utilisateur » avec l'appartenance inconnue ; ne pas inventer d'année. Ne
jamais déduire la version du nom du dossier, du projet actif ou des récents.

Exemples complets de `project.manager.list {}` (chemins synthétiques) :

```json
{
  "ok": true,
  "projects": [
    {
      "path": "C:\\Allplan\\PRJ\\Bureau\\Bureau.prj",
      "name": "Bureau.prj",
      "source": {
        "status": "resolved",
        "version": "2026",
        "verificationVersion": false,
        "reason": null
      },
      "sourceFreshness": "last_read",
      "projectInstallation": {
        "status": "associated",
        "version": "2026",
        "verificationVersion": false,
        "prjPath": "C:\\Allplan\\PRJ"
      }
    },
    {
      "path": "D:\\Clients\\Externe\\Externe.prj",
      "name": "Externe.prj",
      "source": {
        "status": "resolved",
        "version": "2026",
        "verificationVersion": false,
        "reason": null
      },
      "sourceFreshness": "last_read",
      "projectInstallation": {
        "status": "unassociated"
      }
    }
  ]
}
```

Le premier projet est affiché une seule fois sous Allplan 2026 ; le second une
seule fois sous « Ajoutés par l’utilisateur », bien que ses définitions aient
été lues avec la source 2026. Pour une entrée historique non encore relue,
remplacer `projectInstallation` par
`{"status":"unknown","reason":"legacy_entry"}` ; elle reste sous « Ajoutés par
l’utilisateur » avec l'incertitude signalée.

## 3. Édition de présentation, infobulles, couleurs et icône

Réutiliser `presentation.update {configuration}` pour chaque modification de
présentation, en envoyant la configuration complète V1 ou V2. Les validateurs Python
restent autoritaires ; sur succès, remplacer localement la configuration et le modèle
par la réponse. Sur erreur, conserver la dernière version confirmée. Ne jamais envoyer
dans la configuration `value`, `valueState`, `definition` ou des données projet.

L'infobulle de ligne reprend les informations disponibles, dans cet ordre : nom
Allplan (`definition.label`/`label`), numéro (formaté pour l'affichage, sans changer
la clé canonique), titre de l'occurrence uniquement s'il diffère du nom, widget,
type de donnée sauf checkbox, groupe s'il existe, valeur courante si elle n'est pas
vide. Omettre les informations absentes/vides ; ne pas fabriquer de définition ni
de métadonnée. Les occurrences d'un même numéro partagent la valeur du brouillon,
mais gardent leur titre, groupe et propriétés de présentation propres. Sans
présentation, utiliser les attributs de `work.data` et ne pas inventer de propriétés
d'occurrence.

La propriété couleur existante est `backgroundColor` du groupe de présentation :
`categories[].groups[]` en V1, ou `categories[].children[]` pour les éléments
`kind: "group"` en V2. La conserver exactement au format hexadécimal `#RRGGBB`.
Elle colore le groupe et son indication visuelle dans la liste de groupes ; les
lignes conservent les styles normaux du tableau. Il n'existe pas de propriété de
couleur propre à chaque ligne. Ne pas propager le fond du groupe dans les données de
ligne et ne pas inventer de palette ou de couleur à partir du titre.

Pour le bouton **Parcourir** d'icône de catégorie, réutiliser le choix local d'image
du navigateur et la propriété déjà existante `category.icon`. Convertir l'image
sélectionnée en URL `data:image/...;base64,...` en mémoire, remplacer uniquement
l'icône de la catégorie visée et appeler `presentation.update` avec la configuration
complète. Une annulation ou une erreur de lecture ne modifie rien. Ne transmettre ni
chemin local ni objet fichier au Python, ne pas faire de requête réseau. Il n'y a pas
de commande Python dédiée au choix d'icône.

## 4. Contrat du brouillon de valeurs en mémoire

Après identification et `get_initial_data()`, appeler `work.get {}` pour initialiser
l'interface depuis le backend. Source de vérité :

- `work.source` : snapshot Python d'origine, inchangé ;
- `work.data` : attributs effectifs pour la vue sans présentation ;
- `work.presentation` : présentation et modèle recalculé si présents ;
- `work.draftValues` : seules les valeurs modifiées en mémoire, indexées par numéro ;
- `work.dirty` : indicateurs de modifications non enregistrées ;
- `work.revision` : révision courante obligatoire dans les commandes mutantes.

La configuration de présentation reste modifiable en mémoire via
`presentation.update`; une modification de vue, une lecture `presentation.get`,
l'ouverture du gestionnaire ou un recalcul ne doit pas effacer le brouillon.
Toutes les occurrences d'un même `number` affichent la même valeur. Les propriétés
de présentation (identifiants d'occurrence, titre, catégorie/groupe, widget, options,
position, couleur de groupe) demeurent propres à chaque occurrence.

### Requêtes et réponses typées

Les champs sont stricts : aucun champ supplémentaire. `number` est une chaîne
décimale ASCII canonique (`"7"`, pas `"007"`), connue dans le snapshot projet.
`value` est une chaîne, y compris `""`, `"0"` ou `"false"`, ou `null` pour rendre la
valeur absente dans le brouillon. Une valeur égale à la source retire l'entrée du
brouillon. Ne pas convertir les valeurs en nombres ou booléens.

`work.get` retourne `ok:true`, `status:"current"` et un `work` conforme à
`WorkingState`. Les définitions intégrales utilisées sont dans
`types/AIM_PROJECT_MANAGER_CONTRACT.ts` : `WorkingState`, `WorkingRequests`,
`WorkingReply`, `WorkingResponses`, `WorkingProfileResponses` et les dépendances
nécessaires sont présents et reliés entre eux. Ce fichier est la référence pour
les formes exactes ; les types abrégés de versions antérieures de ce guide sont
retirés. Les sources exactes dépendantes sont également incluses dans `types/`.

Exemple : source numéro 7 = `"0"`, payload initial :

```json
{"revision":0,"number":"7","value":"Valeur de travail"}
```

Réponse `work.value.set` : `ok:true`, `status:"updated"`,
`work.revision:1`, `draftValues:{"7":"Valeur de travail"}`,
`dirty:{"values":true,"presentation":false,"any":true}`. Le snapshot `source`
garde `"0"` ; `work.data` et toutes les occurrences du numéro 7 montrent
`"Valeur de travail"`. Après chaque mutation ou `presentation.update`, relire
`work.get` et utiliser la révision retournée.

`work.discard {revision}` abandonne toutes les valeurs et modifications de
présentation en mémoire, restaure la présentation de référence et annule l'import
en attente. Il ne modifie aucun fichier.

`work.close {revision,discard}` ferme par le parcours natif normal si aucune
modification ne serait perdue, ou après `discard:true`. Quand il y a perte,
demander explicitement « Annuler » ou « Abandonner les modifications » ; aucune
option « Enregistrer ». Ne pas appeler avec une ancienne révision.

`work.transition` ne permet que les transitions ci-dessous. L'interface doit
demander confirmation des éléments indiqués avant d'envoyer `discard:true`.
Un refus ou `discard:false` avec une perte requise donne
`work_confirmation_required`.

| Transition | Payload interne | Protection et résultat |
|---|---|---|
| `project.select` | `{}` ou `{path}` exact du contrat projet | Confirmer la perte du brouillon et de la présentation. Le même projet relu abandonne les valeurs et conserve la présentation ; un autre projet accepté réinitialise les valeurs et la présentation. Le projet actif ne change qu'après chargement réussi. Annulation/erreur conserve l'état courant. |
| `project.manager.open` | `{path, discardPresentation:boolean}` | Même protection de brouillon ; le backend fait autorité sur `discardPresentation` à partir du booléen externe `discard`. N'ouvrir que les projets ajoutés au gestionnaire. |
| `presentation.import.apply` | `{token}` exact reçu de `presentation.import.prepare` | Confirmer seulement la perte d'une présentation modifiée. Les valeurs du brouillon sont conservées. À succès, la présentation importée devient la nouvelle référence non modifiée. |

Une annulation de sélecteur peut retourner `ok:true,status:"cancelled"` ; conserver
l'état en mémoire et ne pas annoncer un changement. Une préparation d'import rendue
obsolète par une modification du contexte retourne `project_changed` ; relire l'état
et préparer de nouveau, sans effacer le brouillon. Après `presentation.update` ou une
commande d'import, relire `work.get` pour synchroniser modèle, révision, indicateurs
et `pendingImport`.

Pour le gestionnaire, conserver aussi ses enveloppes existantes : `project.manager.list
{}` répond `{ok:true,projects:ManagerEntry[]}` ; l'aperçu répond
`{ok:true,status:"preview",preview:Preview}` ou `{ok:false,error:{code,message}}`.
Quand `project_manager_preview_color_contract === 1`, une ligne de groupe d'aperçu
contient exactement `kind/id/title/rows/backgroundColor`, où la couleur est la valeur
hexadécimale exacte de la présentation ; sans ce marqueur, le schéma historique sans
couleur reste strict.

Réponses de `presentation.update` et `presentation.import.apply` conservent leurs
formes existantes : succès `{ok:true,status:"updated"|"applied",
presentation:{configuration,report,model}}`, erreurs `{ok:false,error:{code,message}}`.
Après un `presentation.update`, appeler `work.get` pour rafraîchir la révision et les
indicateurs `dirty`. `presentation.export` est interdit dans ce profil.

## 5. Erreurs, sauvegarde et indépendance de l'aperçu

Les refus mémoire sont des réponses `ok:false,error:{code,message}`. Traiter au
minimum les codes :

- `invalid_payload` : payload ou type non conforme, ne pas réessayer inchangé ;
- `stale_work` : révision périmée, appeler `work.get` puis réconcilier l'interface ;
- `project_required` : aucun projet accepté ;
- `unknown_attribute` : numéro absent du snapshot chargé ;
- `work_confirmation_required` : afficher Annuler/Abandonner, ne pas contourner ;
- `window_unavailable` : fermeture native indisponible ;
- `file_write_forbidden` : écriture/export métier interdits dans ce profil.
- `presentation.update` conserve aussi `invalid_payload`,
  `unsupported_presentation_version`, `invalid_presentation` et
  `model_unavailable` selon le payload ou la configuration.
- Le gestionnaire conserve notamment `project_not_added`, `project_read_error`,
  `manager_unavailable` et ses erreurs de lecture/aperçu.

Propager aussi les erreurs normales du projet, du gestionnaire et de la validation
de présentation ; un échec ne doit jamais être converti en succès vide ni effacer le
dernier état valide.

**Aucun enregistrement/export métier de fichier ni lancement de prjtools.**
`presentation.export` est refusé avant tout dialogue ou ouverture de destination.
Ne pas proposer un bouton Enregistrer, de sauvegarde ou de validation fictive.
L'import de présentation reste une lecture. Les écritures techniques préexistantes
du gestionnaire (inventaire explicite, favoris, informations rafraîchies) restent
distinctes du métier.

L'aperçu gestionnaire reste `readOnly:true`, utilise le lecteur isolé et les valeurs
du PRJ relu ; il ne lit ni ne modifie le brouillon de l'éditeur. Ne pas lui appliquer
les valeurs de `work.draftValues`, même si l'aperçu concerne le projet actif.

Le brouillon est propre à la fenêtre et n'est pas restauré au redémarrage. Cette
spécification ne déclare pas de recette native frontend terminée : le dialogue
frontend, les transitions WebView et le comportement de fermeture restent à vérifier
après livraison exacte.
