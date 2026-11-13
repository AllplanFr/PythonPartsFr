# Suite Allplan — ajustements du launcher Python (pour Copilot / Perplexity)

Statut : variante frontend non publiée. URL de travail fournie par Lovable : `https://id-preview-2--297630a7-1565-46a1-be88-827e783d171d.lovable.app` (aperçu de la variante). Site publié actuel : `https://allplan-smartcatalog-editor.lovable.app`, où `/` reste SmartCatalog tant que la variante n’est pas acceptée puis publiée. Aucun domaine définitif.

## 1. Routes et identités
| app_id | Route | Transport normal | Fenêtre |
|---|---|---|---|
| `smartcatalog` | `/smartcatalog` | legacy pywebview (`pywebview.api.call`, `window.allplanLauncher`, `allplanHost.receive`) | pywebview |
| `vob_editor` | `/vob-editor` (inchangée) | legacy pywebview identique | pywebview |
| `information_manager` | `/information-manager` | `aim_legacy` WebView2 (`chrome.webview.postMessage` / `hostObjects.bridge`, messages ready/load/save/quit/pickIcon/project.result) | WebView2 sans pywebview |
| — | `/` | aucun | accueil neutre, ne doit pas être la cible d’un plugin |

## 2. Catalogue des plugins et `resolve_url`
- Construire l’URL par `base + route(app_id)` ; ne jamais ouvrir `/` pour un plugin.
- Transition : tant que le site publié n’a pas basculé, SmartCatalog = `base + "/"`. Après acceptation et publication explicites : `base + "/smartcatalog"`. Prévoir un paramètre de configuration (ex. `smartcatalog_route`) plutôt qu’un remplacement en dur ; VOB ne change pas.
- Toujours définir `window.allplanLauncher.appId` avec l’`app_id` de la fenêtre avant `allplan-launcher-ready` : le frontend refuse un module différent (écran « indisponible », aucun message). Sans `appId`, le comportement historique SC/VOB est conservé, mais AIM est refusé.

## 3. Politiques par module (pas d’autorisation globale de l’origine)
- Une fenêtre ne change jamais d’`app_id` par navigation. Ouvrir un autre module exige un service launcher dédié et autorisé — **non implémenté** ; à défaut l’autre module est indisponible.
- Les capacités Python restent par plugin : partager l’origine n’ouvre aucune commande d’un autre module.
- AIM : les handlers pywebview AIM n’existent pas ; ne pas charger `/information-manager` dans une fenêtre pywebview. La fenêtre AIM ne doit pas exposer `window.pywebview`.

## 4. Enregistrement et fermeture
- VOB : `vob.save` doit répondre `{ ok: true, data: { file: { id, name, path } } }` après écriture réelle ; toute autre réponse, délai ou annulation bloque la sortie. Pas de retry côté interface.
- SmartCatalog : aucune commande catalogue open/save n’est encore branchée ; seuls `settings.load/save` le sont.
- AIM : le message `save` n’inclut plus `quit: true`. Python ne doit pas fermer la fenêtre sur réception de `save`. Ajouter un accusé corrélé (ex. `save.result` avec `requestId` et `ok` booléen) avant toute fermeture automatique ; à intégrer côté frontend lorsque disponible. La mise à jour `prjtool.exe … -updateattr` (shell=True selon consigne utilisateur) reste entièrement côté Python ; aucun writer frontend.
- `quit` reste envoyé seulement sur action explicite Quitter.

## 5. Protocole 2.0.0-rc.1
Un seul corpus frontend (artefacts et empreintes exacts, CRLF rétabli). Inactif : aucun bootstrap lu au démarrage, aucun handshake, aucune commande réservée ou métier. Noms officiels réservés : `window.__allplanProtocolHost`, `window.__allplanProtocolClient.receive_message`, événement `allplan-protocol-host-ready`.

## 6. Recette RC1 SmartCatalog (variante distincte)
Non modifiée, non absorbée. Elle conserve sa propre URL d’aperçu et ses ressources réseau (voir son rapport `smartcatalog_rc1_remote_readiness.md` lorsqu’il sera produit) ; ses routes restent celles du main (`/` pour SmartCatalog). Ne pas pointer la recette vers `/smartcatalog` de cette variante.

## 7. Prérequis avant bascule et retour arrière
1. Fournir les images AIM manquantes ; valider l’AIM regroupé dans WebView2 réel.
2. Ajouter `appId` au launcher pour chaque fenêtre ; configurer `smartcatalog_route`.
3. Tester en natif : ouverture directe des trois modules, refus croisé, Save VOB confirmé/échoué, Save AIM sans fermeture.
4. Accepter puis publier la variante sur demande explicite ; basculer ensuite `smartcatalog_route` vers `/smartcatalog`.
Retour arrière : remettre `smartcatalog_route = "/"` et republier la version précédente ; les projets d’origine (SmartCatalog/VOB main, AIM) restent intacts.
