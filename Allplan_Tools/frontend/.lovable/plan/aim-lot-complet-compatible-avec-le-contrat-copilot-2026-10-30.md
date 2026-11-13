# AIM — lot complet compatible avec le contrat Copilot

## Résultat attendu
Conserver les corrections de la candidate `2bd4fbb…`, terminer les interactions AIM et intégrer **Project Information manager** dans la même application, sans changer le launcher, Python ni les valeurs Allplan.

## Présentation et interactions
- Prendre en charge l’ordre commun lignes/groupes et les lignes directement sous catégorie ; conserver chaque ID, répétition et position.
- Compléter les déplacements et leurs emplacements en pointillés occupant de l’espace, les poignées sans saut et le survol continu de 600 ms.
- Restaurer les propriétés et actions de présentation, le tooltip détaillé et le menu « Déplacer vers » selon la capture.
- Confirmer la suppression des conteneurs avec les comptes exacts ; retirer leurs enfants, sans transfert automatique et sans toucher aux valeurs Allplan.
- Garder les cinq colonnes, les valeurs absentes distinctes de 0/false, les icônes corrigées et l’import natif avec sa seule confirmation Écraser/Annuler.
- Limiter le footer à Projet (menu récent existant) et Allplan Data (source réellement fournie par Python).

## Gestionnaire de projets
- Réutiliser les composants, la disposition et l’animation du gestionnaire VOB, sans dupliquer son système de fichiers ou son historique.
- Ajouter et lister les projets explicitement via l’hôte ; recherche et filtre sur ces seules entrées, aucun scan automatique ni stockage concurrent.
- Afficher l’aperçu Python dans un ensemble en-tête/tableau N° / Titre / Valeur, avec ordre conservé, groupes non vides et lignes renseignées dont 0/false.
- Recharger sans changer le projet actif ; ouvrir par double-clic avec protection de la présentation courante et traitement des refus.
- Désactiver Enregistrer sans modification ; ignorer les réponses tardives et invalider un aperçu dont le rechargement échoue.

## Compatibilité et détails techniques
- Détection exacte dans l’identité native : `presentation_tree_contract === 1` et `project_manager_contract === 1` ; historique inchangé sous `project_history_contract === 1`.
- Étendre séparément les validateurs V2 de configuration et modèle ; garder les validateurs V1 et les profils exacts de cinq/six capacités de présentation. Ne jamais envoyer V2 à un hôte ancien ni convertir silencieusement son contenu.
- Utiliser uniquement les commandes et réponses du ZIP vérifié, via le transport existant ; configuration et modèle confirmés adoptés atomiquement après succès.
- Garder les styles partagés et la protection de sélection du texte dans CustomToolbar ; aucune refonte VOB/SmartCatalog.

## Tests et livraison unique
- Tests synthétiques ciblés : contrats V1/V2, ordre/IDs/répétitions, déplacements/suppression/refus, import, valeurs, source/historique, gestionnaire et recherches partagées.
- Parcours navigateur avec hôte simulé et captures du tableau, tooltip/menu et gestionnaire ; vérifier les contrôles automatiques et conserver leurs journaux.
- Un seul ZIP reconstructible : sources complètes, ressources locales, dépendances verrouillées, commandes/outils, identification exacte (révision ou état non committé explicite), inventaire SHA256, tests et captures.
- Aucune publication ni modification Python. Activation du profil V2 exact et recette Python/WebView réalisées ensuite par Copilot.