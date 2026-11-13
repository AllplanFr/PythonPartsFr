## Intégration progressive après approbation
1. **Créer le parent neutre et les quatre routes.** Extraire l’écran SmartCatalog existant, conserver VOB et intégrer tout AIM depuis les sources. Ajouter une navigation commune discrète sans refonte des écrans. Chaque module lourd sera chargé à la demande ; les pages auront leurs propres métadonnées.
2. **Séparer les responsabilités utiles.** `src/suite` : catalogue/navigation ; `src/shared` : thème/UI, diagnostics et interfaces de transport ; `src/modules/{smartcatalog,vob_editor,information_manager}` : entrées métier. Préserver/réexporter les fonctions historiques. Ne recopier ni router, ni bootstrap serveur, ni bibliothèque UI entière AIM.
3. **Isoler état/réglages.** Extraire langue/thème du store catalogue ; séparer les registres SC/VOB couplés par `app-settings.ts`, garder les sections Python. Préserver l’état AIM et toutes les sessions/historiques VOB.
4. **Adaptateurs legacy explicites.** Un propriétaire actif des listeners/globals, nettoyage et réponses tardives protégées. SC/VOB : `host-bridge` ; AIM : `aim_legacy` WebView2. Extraire le parseur legacy AIM de son module RC1 ; un unique corpus et les types/validateurs communs, sans activation ni handshake.
5. **Protéger changement et fermeture.** Enregistrer / Abandonner confirmé / Annuler couvre retour navigateur et tous les brouillons. Recontrôler instantané confirmé et état courant après Save ; échec/incertitude bloque, sans retry. Téléchargement ≠ save native. Retirer `quit:true` du simple envoi Save AIM ; aucune fermeture sur transmission seule. Sans handler, fonction native indisponible.
6. **Vérifier/documenter.** Tests existants/nouveaux et parcours avec fichiers de test ; simulation signalée. Rapports : `docs/integration/suite_frontend_reorganization_report.md` et `suite_python_launcher_adjustments.md`.

## Inventaire de stockage et conservation
- **SC/VOB localStorage :** `smartcatalog-model-settings`, `smartcatalog-formula-settings`, `smartcatalog-dialog-layouts`. Les autres stores/documents et sessions VOB sont en mémoire ; les réglages natifs sont échangés via `settings.load/save`.
- **AIM localStorage :** `project-attrs-v2`, `project-groups`, `project-cats`, `project-groupcat`, `cat-icons`, `group-colors`, `group-collapsed`, `show-name`, `show-colors`, `lang`, `theme`, `aim-columns`, `aim-toolbar-layout`.
- **Cookie :** `sidebar_state` dans les deux bibliothèques sidebar, portée `/`, sans usage métier identifié. Pas de sessionStorage/IndexedDB applicatif repéré. Inventaire source uniquement, pas lecture de l’ancienne origine.
- Clés anciennes intactes, nouvelles écritures séparées suite/module/document. Reprise AIM uniquement volontaire : sa présentation exportée exclut valeurs/cache d’icônes, sa sauvegarde ne reprend pas tous les réglages. Documenter ces limites, préserver la session et les valeurs inconnues/hors liste, associations non résolues, UID et indices VOB bruts. Aucun import automatique ou effacement.
- Risques traités : langue/thème globaux écrasés par un autre écran, réglages SC appliqués à VOB, initialisation tardive après changement, état AIM perdu au démontage, sauvegarde tardive appliquée au mauvais fichier, brouillons VOB non actifs oubliés lors de Quitter.

## Navigation native et transition launcher
En navigateur : routes internes. En natif : application liée et capacités explicites, jamais une autorisation par origine ou un changement implicite d’`app_id`. Autre module uniquement via service launcher existant et autorisé ; sinon indisponible.

Document Python : routes/`app_id`, catalogue plugins / `resolve_url`, confirmations Save et handlers absents. **L’ancien `/` publié reste SmartCatalog avant alignement explicite.** URL de travail fournie, non publiée : `https://id-preview-2--297630a7-1565-46a1-be88-827e783d171d.lovable.app`. Aucun domaine définitif choisi.

Recette RC1 distincte : inventorier URL/contexte/réseau depuis son rapport, sans modification ni import d’effets. Aucun essai natif/distant. Rollback : main/AIM intacts ; acceptation uniquement sur demande.

## Critères de vérification
- Quatre routes directement ouvrables ; accueil sans montage/import métier actif ni message Python.
- Chaque module complet sans hôte, puis hôte simulé ; identité native et adaptateur unique, refus des routes incompatibles.
- Navigation sale : Save confirmé, nouvelles modifications pendant Save, échec/incertitude, abandon confirmé et annulation ; conservation AIM et de toutes les sessions VOB. Les réponses tardives et événements de chargement ne peuvent remplacer un document modifié sans garde.
- Isolation réglages/stores, anciennes clés intactes, reprise AIM volontaire et valeurs brutes préservées.
- Fonctions SC/VOB/AIM existantes, ressources réelles visibles (ou blocages nommés), RC1 commun exécuté une seule fois, recette inactive par défaut.
- Tests comportement exécutés et derniers diagnostics de compilation consultés ; aucun lancement manuel de build/typecheck. Limites Python, ressources indisponibles et contrôles natifs non réalisés seront explicitement rapportés.