# VOB — coordination Copilot : refus et fermeture

## Contrat conservé
- Erreur commune : `{ok:false,error:{code:string,message:string}}`. La vue conserve le message reçu ; aucun nouveau code, champ ou événement n'est supposé.
- Une sauvegarde n'est confirmée que par `{ok:true,data:{file:{id,name,path,...}}}` ; `data:null` annule le sélecteur.
- Après refus, le parcours de fermeture propose explicitement `vob.save_as` existant, sans réessayer l'écriture originale. Annulation/échec annulent la fermeture et conservent les brouillons. Un résultat incertain n'est pas classé comme refus avant écriture.
- Les générations locales du coordinateur invalident les continuations après interruption des capacités/écouteurs ; elles ne changent pas le requestId hôte ni les payloads.

## Éléments demandés à Copilot
1. Pour `vob.close.cancel` à 09:31:58 et `vob.close.authorize` à 09:32:05 : requestId de chaque commande, événement initiateur, réponses complètes (`cancelled`, `authorized` ou `ignored/not_current_request`) et état pending/idle/authorized autour des deux appels. Préciser si l'autorisation native a été consommée et la fenêtre effectivement fermée.
2. Enveloppe ETC établie le 10/11 à 08:59 UTC : `reply.error.confirmation` ; le helper doit conserver cette donnée structurée dans HostError, et non l'extraire du message.
3. Confirmer que `vob.save_as` renvoie les métadonnées du fichier réellement écrit seulement après réussite et `null` sur annulation, et qu'un échec laisse les modifications disponibles.

## Décision fonctionnelle ETC — 10 novembre, 08:51 UTC
L'écriture VOB dans ETC doit être possible après confirmation explicite, sans élévation UAC imposée. L'interdiction actuelle est une politique du nouvel hôte, pas une restriction Windows démontrée. Une éventuelle erreur réelle d'accès ne doit pas être contournée ni convertie en réussite.

Afficher le chemin exact de la cible, sans troncature de sa valeur, et le texte :

> Ce fichier se trouve dans le dossier ETC d’Allplan.
> Voulez-vous remplacer ce fichier ?

Choix : **Remplacer**, **Enregistrer sous…**, **Annuler**.

Le choix Remplacer n'autorise que la cible et l'opération confirmées, selon le contrat convenu avec Python. Aucune autorisation globale mémorisée. Toute autre cible ou opération nécessite sa propre confirmation.

À la fermeture : Annuler conserve le document modifié en édition ; Enregistrer sous annulé ou échoué fait de même. La réussite ne permet de poursuivre que lorsque tous les documents sont sauvegardés et qu'aucune nouvelle modification n'est apparue. Les continuations périmées restent invalidées.

### Contrat établi et raccordé — 08:59 UTC
- `vob.save` / `vob.save_as` renvoient `{ok:false,error:{code:"write_confirmation_required",message,confirmation:{confirmationId,operation,path}}}` ; aucun data/requestId ajouté.
- Le frontend affiche le dialogue unique après validation du code et des champs structurés (opération correspondant à la demande). Python conserve le document et la cible ; le frontend ne renvoie pas le document avec le jeton.
- Remplacer appelle `vob.write.confirm` avec `{confirmationId,accept:true}` ; Annuler/fermeture du dialogue avec `{confirmationId,accept:false}`.
- Enregistrer sous refuse et attend l'acquittement `data:null` de l'ancien jeton avant d'appeler `vob.save_as` avec le document modifié actuel ; une nouvelle cible ETC ouvre sa propre confirmation.
- `ok:true,data:null` n'est jamais une sauvegarde ; `ok:true,data:{file,header}` confirme l'écriture ; `ok:false,error` conserve les modifications. Le frontend marque seulement le snapshot envoyé lors de l'opération effectivement acceptée.
- Aucune autorisation globale, aucune élévation demandée par le frontend, aucune interprétation de messages traduits. Réponses après interruption ignorées pour l'état enregistré et la fermeture ; un jeton reçu après interruption est refusé si sa structure est valide.
- Ancien hôte : pas de confirmation inventée ni de levée de politique. Refus génériques restent affichés ; une commande absente ne simule aucune réussite.

Limite transport : un appel confirm interrompu/incertain ne prouve ni écriture ni absence d'écriture ; aucune relance automatique du jeton, le document reste modifié et la fermeture bloquée. Python garde la validation/consommation des jetons à usage unique. Aucune publication.

## Limites de l'identification
La seule émission frontend de `vob.close.authorize` se trouve dans `VobCloseCoordinator.finish` après garde levée (état propre, sauvegarde confirmée/revérifiée ou abandon explicite). Une annulation confirmée efface la demande locale et déduplique son identifiant. Les horaires seuls ne permettent donc pas d'attribuer la seconde commande à cette même demande ni d'établir son effet. Les traces horaires demandées ne sont pas présentes dans l'environnement Lovable.

Tests réalisés avec des réponses synthétiques : ils ne prouvent pas la recette Python/WebView2/Allplan. Aucune publication autorisée pour ce correctif.