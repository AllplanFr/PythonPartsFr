# Contrôle RC1 — complément du 25 octobre 2026

Ce complément applique `rc1_lovable_control_clarifications.md`. Il ne modifie pas la release `2.0.0-rc.1`, son README original, ses schémas, fixtures ou manifestes. Il remplace les intentions de basculement des anciens rapports d’alignement, pas les échanges actuellement utilisés.

## Conventions officielles pour une future fenêtre isolée

- Hôte : `window.__allplanProtocolHost`.
- Client : `window.__allplanProtocolClient`.
- Réception : `window.__allplanProtocolClient.receive_message(envelope)`.
- Événement : `allplan-protocol-host-ready` ; `detail` contient le descripteur.
- Requête pywebview future : `window.pywebview.api.dispatch(envelope)`.
- Contrôle initial : `host.handshake`, corrélation `session_id` / `request_id`.

Les doubles underscores font partie des noms officiels. Aucun alias sans underscores n’est installé. Les helpers actuels reçoivent un descripteur comme argument ; aucun global RC1 ni client n’est installé. `window.allplanHost` et `window.allplanLauncher` restent les globals legacy, sans remplacement.

## Intégrité vérifiée

L’archive originale reçue `allplan-lovable-handoff-2.0.0-rc.1.zip` a pour SHA256 calculé :

`4d40c385ae565d483bb909f9f36cbc3ffd549a646837aba96e16ff82c5efb7cb`

Cette valeur correspond exactement à la référence fournie dans la clarification. Cela lève la limite « empreinte ZIP non comparée » des rapports précédents ; ce n’est pas une preuve cryptographique de l’identité de l’expéditeur.

Le contrôle a détecté une normalisation CRLF → LF des deux JSON locaux. Leurs octets originaux ont été rétablis depuis l’archive vérifiée, sans changement sémantique ni changement du manifeste. Les deux tests d’empreintes passent désormais avec les valeurs originales.

## Provenance et portée des preuves

Les rapports SmartCatalog et VOB décrivent le **même dépôt, la même exécution Vitest et le même corpus** `src/test/host-protocol.test.ts`. Les 84 tests RC1 et 380 tests globaux précédemment rapportés ne constituent pas deux suites indépendantes à additionner. Les 7 tests Python antérieurement exécutés sont les oracles de l’archive, pas un essai du transport natif.

Le corpus commun exécute ses cinq scénarios, dont `vob-leading-zeros` ; son utilisation dans le rapport SmartCatalog est générique, pas un test de sauvegarde catalogue. Les validateurs du schéma original restent en place en plus des types générés.

Information Manager n’est pas présent dans ce projet : aucune exécution de sa suite, migration `project-attrs-v2`, saisie décimale locale ou sauvegarde/fermeture/persistance AIM n’est revendiquée. La conservation des raw ambigus testée ici ne valide pas un parseur de saisie décimale locale AIM.

## Transition non branchée

Un futur essai Python exige une demande explicite et une fenêtre isolée, avec une session propre. Aucun client RC1 partageant implicitement une session legacy, aucune délégation automatique au legacy, aucune activation sur les pages actuelles.

La présence de dispatch ou un handshake réussi ne permet jamais de faire passer les opérations métier au dispatcher. Les six commandes de contrôle couvertes ne valident pas `vob.*`, `catalog.*`, `aim.*`, refresh ou `operation.status`. L’absence de bootstrap ne prouve pas un mode legacy ; le chemin actuel est connu par sa configuration et son code, pas déduit de cette absence.

Les essais natifs des pages, la disponibilité des services métier et le plan Python restent soumis à livraison et validation distinctes. Aucune publication.

## Vérifications de ce complément

- Suite commune RC1 : **92 tests réussis** (84 antérieurs + 8 protections : bootstrap absent, et refus de sept commandes hors périmètre malgré un handshake valide).
- Suite ciblée RC1/bridge/settings/en-têtes/démarrage vide : **121 tests réussis**.
- Suite globale : **388 tests réussis**, 49 fichiers ; une seule exécution commune aux deux applications.
- Dernier contrôle automatique disponible : **build OK**.
- Aucun essai Python natif ni nouvelle exécution des oracles Python dans ce complément.