# Complément ciblé AIM : Hors présentation et Reset

Le lot `81d09588` reste la référence figée. La correction sera un delta frontend distinct, sans build, publication, assemblage ni changement de contrat/capacité.

## Constat et branchement manquant
- V1 et V2 ont déjà un menu Hors présentation qui appelle `onAddOccurrence(number, destination)`, puis `addOrganizedOccurrence` → `addOccurrence` → mise à jour de configuration confirmée par Python. Il ne modifie pas la valeur.
- **La poignée de déplacement Hors présentation n’est pas raccordée aujourd’hui.** Les poignées existantes déplacent une occurrence déjà configurée ; Hors présentation n’en possède pas encore. Ne pas envoyer son numéro à `moveLayout`/`moveTree` comme un identifiant d’occurrence.
- Le menu V1 propose les groupes ; V2 propose les catégories sans groupe et leurs groupes. Le menu des lignes configurées V2 possède aussi des créations de destinations : ne pas prétendre que ces branches sont déjà disponibles pour Hors présentation. Leur réutilisation doit conserver le parcours de création de configuration, sans nouvelle commande Python.
- L’état Python fournit déjà `work.source.data.attributes` (source initiale) et la valeur de travail confirmée. Aucun contrat Python supplémentaire n’est nécessaire pour Reset.

## Delta proposé
1. **Structure V1/V2** : réutiliser les classes de cellules, emplacements de poignée, icônes Saisie libre/STR et icône Déplacer des lignes ordinaires. Éditer/Supprimer visibles mais réellement désactivés, dans un support focalisable fournissant l’aide « Non disponible » au survol et au clavier. Actions dans Donnée, ou dans Valeur quand Donnée est masquée.
2. **Déplacement** : mutualiser les choix de destinations compatibles ; le menu et la nouvelle poignée Hors présentation appellent le même `onAddOccurrence`. Réutiliser les destinations, protections, représentation transportée et repères de dépôt existants. Une occurrence extérieure est ajoutée à la configuration, jamais déplacée par un faux identifiant ni supprimée du projet.
3. **Reset** : transmettre à `InlineWorkingValue` la source correspondante reçue dans l’état Python, avec présence explicite (une source absente n’est pas `null`). Afficher Reset uniquement si la valeur confirmée diffère exactement de cette source. Envoyer sa valeur exacte par `work.value.set` révisionné et adopter la réponse. Bloquer la validation du brouillon lors du clic Reset pour éviter un envoi parasite au blur. Conserver ∅ séparément et les protections lecture seule/requête en cours.

## Fichiers concernés
- `src/modules/information_manager/AimEditor.tsx` : source du Reset et cellule de valeur.
- `src/modules/information_manager/components/organized-presentation.tsx` : lignes Hors présentation V1.
- `src/modules/information_manager/components/tree-presentation.tsx` : lignes Hors présentation V2.
- Un petit composant partagé uniquement si nécessaire pour les actions désactivées ou les destinations communes.
- Tests AIM ciblés existants, règles locales et suivi de ce delta ; aucun autre plugin.

## Tests ciblés
- V1/V2 : poignée et menu raccordés à l’ajout d’occurrence vers une destination autorisée ; annulation sans mutation, busy indisponible et configuration seule modifiée.
- Éditer/Supprimer désactivés, aide accessible au focus ; actions toujours dans Valeur si Donnée est masquée.
- Reset absent à la source, présent après une modification confirmée, absent après retour confirmé ; source Python conservée après changement de vue.
- Restauration exacte des trois sources `null`, `""`, `"0"` ; Reset avec brouillon ne transmet que la source une fois, et reste distinct de ∅.
- Lecture seule et requête en cours bloquent Reset et les mutations.
- Conserver et rejouer les tests d’édition directe validés ; aucune assertion affaiblie, aucune campagne globale ou de captures.

## Limites
Les conventions STR et les métadonnées de présentation ne prouvent aucune autorisation d’écriture native Allplan. Les tests restent simulés ; aucune application finale au projet Allplan. Présenter ensuite le delta et les résultats ciblés, sans fabrication de package natif.
