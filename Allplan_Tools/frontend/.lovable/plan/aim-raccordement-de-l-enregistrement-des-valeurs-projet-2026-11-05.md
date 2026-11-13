# AIM — Raccordement de l’enregistrement des valeurs projet

## Base et périmètre
- Dépôt Allplan Tools, projet `297630a7-1565-46a1-be88-827e783d171d`.
- Copie ouverte : branche `edit/edt-c7432b1a-096a-49cf-beee-7efc96f997be`, révision `f997b8a9a7a5b7732907d4635b000338863472bf`, arbre `23b0594126f6dcbf4d8f797eeb78d99f9c4ebd11` ; checkout initial propre.
- Candidate `7767f56fec9d75300d488e543af49c8474008e01` disponible et ancêtre. Le delta déjà présent ne touche que les consignes AGENTS AIM ; le code fonctionnel reste celui de cette candidate.
- Appliquer le contrat joint du 5 novembre, sections 1–10, dans cette copie de développement uniquement, après confirmation du périmètre.

## Comportement prévu
1. Garder WorkV1 strict et ses parcours historiques. Reconnaître séparément WorkV2, et autoriser l’enregistrement seulement avec l’identité vérifiée, les deux marqueurs, la liste exacte de capacités, les protections et la disponibilité confirmée par Python.
2. Avant l’envoi, terminer la saisie par son parcours normal et attendre les mutations/synchronisations concernées. Une saisie invalide ou refusée interdit l’envoi. Capturer ensemble les trois identifiants/révisions Python ; aucun attribut, valeur ou chemin ne part avec save.
3. Bloquer les doubles clics avant l’envoi puis suivre l’opération acceptée avec un seul appel status en vol. Une acceptation perdue entraîne une relecture WorkV2 et un suivi de `save.request`, jamais une retransmission de save. Une perte de suivi ou not_found reste un résultat inconnu ; aucun timeout ne fabrique un échec d’écriture.
4. Geler les mutations concernées, import/application, configuration et changement/fermeture normale pendant l’opération. Une reprise obligatoire ou une incertitude conserve les protections ; aucun mécanisme de récupération non documenté.
5. Afficher saved, partial et failed selon les effets réellement rapportés. Préciser fichier écrit et outil échoué/incertain ; code outil zéro ne signifie pas validation des valeurs dans Allplan. Signaler avant le clic l’outil associé absent, sans confondre avec un projet externe.
6. Adopter seulement un état Python compatible avec la session et les révisions courantes. Ne pas effacer des éditions plus récentes ; relire work.get si nécessaire. Préserver les brouillons après échec/partial, le dirty de présentation et null/vide/zéro. Le refus null est explicite, sans conversion.

## Fichiers prévus
- `src/modules/information_manager/contracts/AIM_PROJECT_MANAGER_CONTRACT.ts` : types WorkV2 et save/status séparés, sans altérer les types WorkV1.
- `src/modules/information_manager/lib/aim-working-contract.ts` : négociation, parseur WorkV2 fermé, validation des réponses et transport AIM direct save/status ; parseur WorkV1 inchangé.
- `src/modules/information_manager/AimEditor.tsx` : commande existante Enregistrer, fin de saisie, capture atomique, suivi, protections, résultats et adoption monotone. Réutiliser les contrôles existants, sans nouvelle géométrie.
- `src/test/information_manager/aim-project-save.test.tsx` : couverture spécifique du contrat et des interactions. Adapter les seuls tests historiques directement concernés si indispensable, sans affaiblir leurs assertions.
- Consignes AGENTS AIM et roadmap : documenter la nouvelle frontière négociée ; conserver les contrats historiques comme références.
- Aucun changement prévu dans les composants de tableau, `host-bridge.ts`, `native-binding.ts`, `suite/leave-guard`, Python, dépendances ou lockfile.

## Tests et livraison après accord
- Tester profils historiques/incompatibles, liste de capacités, schémas fermés, requête exacte, double clic, saisie invalide/en vol, acceptation immédiate/perdue, suivi perdu/not_found, états running et terminaux, ancienne session, réponse tardive, dirty indépendant, conservation des brouillons/null et absence de nouvelle tentative save.
- Relancer seulement les tests save et les régressions directement concernées : working-restoration, finalization, inline-value et first-selection.
- Exécuter TypeScript avec l’outil réel et consigner commandes, versions/runtime et résultats, sans campagne globale ni build manuel.
- Présenter référence frontend exacte, delta/fichiers, journaux, limites et exigences du profil backend coordonné. Les simulations ne prouvent aucune écriture native.

## Exclusions
Préserver la candidate 7767f56 et les autres plugins. Aucun projet réel, prjtool, installation/lancement natif, assemblage, publication ou activation d’allowlist. Aucun changement get_initial_data, aucune sauvegarde optimiste et aucune promesse de restauration des brouillons après redémarrage Python.